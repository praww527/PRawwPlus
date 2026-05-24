/**
 * A-leg Manager — per-call caller-side lifecycle tracking, pre-call source
 * validation, and A-leg session disconnect detection.
 *
 * Terminology
 *   A-leg  = caller's channel (the Verto/SIP UA that initiated the call)
 *   B-leg  = callee's channel (originated by FreeSWITCH)
 *
 * This module is intentionally in-memory and never touches MongoDB — it is a
 * short-lived coordination layer whose state lives only as long as the call.
 *
 * Key lifecycle hooks
 *   1. POST /api/calls               → recordALegInit()
 *   2. ringingCall() in orchestrator → recordALegRinging()
 *   3. answerCall() in orchestrator  → recordALegAnswered()
 *   4. bridgeCall() in orchestrator  → recordALegBridged()
 *   5. CHANNEL_HANGUP_COMPLETE       → recordALegHangup()
 *   6. finalizeCall()                → cleanupALeg()
 *   7. Verto WS client disconnect    → notifyALegSessionDropped()
 */

import { logger } from "./logger";
import {
  getVertoSession,
  getSipSession,
} from "./callSession";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ALegStatus =
  | "initiating"    // POST /calls created the DB record; A-leg not yet in FS
  | "ringing"       // CHANNEL_ORIGINATE confirmed — B-leg being rung
  | "early_media"   // SIP 183 / CHANNEL_PROGRESS_MEDIA received on A-leg
  | "answered"      // CHANNEL_ANSWER fired — media flowing
  | "bridged"       // CHANNEL_BRIDGE fired — two-way audio confirmed
  | "ended"         // normal call completion
  | "failed"        // network/FS error
  | "cancelled"     // caller cancelled before answer
  | "missed"        // callee did not answer
  | "rejected"      // callee explicitly declined
  | "cleaned_up";   // TTL cleanup done; state removed

/** Pre-call validation snapshot for the caller's session liveness */
export interface ALegValidation {
  checkedAt:       number;
  alive:           boolean;
  transport:       "verto" | "sip" | null;
  vertoPingAgeMs?: number;
  sipRegAgeMs?:    number;
  sipExpiresInMs?: number;
  sipExpired?:     boolean;
  reason:          string;
}

export interface ALegState {
  callId:           string;
  /** FreeSWITCH 4-digit extension of the caller (internal calls only). */
  callerExtension?: number;
  callerUserId?:    string;
  /** Transport confirmed at call-init time (verto/sip) or "unknown" for external/REST-only. */
  transport:        "verto" | "sip" | "unknown";
  /** A-leg UUID as seen by FreeSWITCH — populated once CHANNEL_ORIGINATE fires. */
  fsCallId?:        string;
  /** B-leg UUID — populated once ringingCall() succeeds. */
  bLegUuid?:        string;
  initAt:           number;
  ringingAt?:       number;
  answeredAt?:      number;
  bridgedAt?:       number;
  endedAt?:         number;
  hangupCause?:     string;
  status:           ALegStatus;
  /** Pre-call validation result for the caller's Verto/SIP session. */
  preflightResult?: ALegValidation;
  /** Active disconnect-watchdog timer — cancelled when call reaches terminal state. */
  disconnectWatchdogActive: boolean;
}

// ── ESL command injection ────────────────────────────────────────────────────
// Follows the same pattern as callOrchestrator.ts (setEslCommandFn).
// freeswitchESL.ts injects this at startup after authentication.

let eslCommandFn: ((cmd: string) => void) | null = null;

export function setALegEslCommandFn(fn: (cmd: string) => void): void {
  eslCommandFn = fn;
}

function sendEslCmd(cmd: string): void {
  if (eslCommandFn) {
    eslCommandFn(cmd);
  } else {
    logger.warn({ cmd }, "[ALeg] ESL command fn not set — command dropped");
  }
}

// ── Disconnect grace period ───────────────────────────────────────────────────
// After the caller's Verto WS closes, we wait this long before issuing uuid_kill.
// This prevents false positives from brief browser reconnects / tab focus changes.
// FreeSWITCH's own Verto heartbeat (15 s) means it may not detect the drop for
// 30–45 s; this watchdog fires much sooner and cleans up zombie calls.
const DISCONNECT_GRACE_MS = parseInt(process.env.ALEG_DISCONNECT_GRACE_MS ?? "8000", 10);

// In-flight disconnect watchdog timers: callId → timer handle
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ── State stores ──────────────────────────────────────────────────────────────

/** Per-call state keyed by callId (MongoDB _id). */
const aLegStore = new Map<string, ALegState>();

/**
 * Index: callerExtension → callId.
 * Allows notifyALegSessionDropped() to find active calls by extension number
 * without scanning the full store on every Verto disconnect.
 */
const extensionToCallId = new Map<number, string>();

// ── TERMINAL status set ───────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set<ALegStatus>([
  "ended", "failed", "cancelled", "missed", "rejected", "cleaned_up",
]);

function isTerminal(status: ALegStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called by POST /api/calls once the DB record is created.
 * Records the initial A-leg state so the rest of the pipeline can track it.
 *
 * @param callId         MongoDB Call._id
 * @param callerExtension 4-digit FS extension of the caller (internal calls)
 * @param callerUserId   MongoDB User._id of the caller
 * @param fsCallId       Verto/SIP UUID supplied by the client (may be undefined
 *                       for legacy clients; filled in later via recordALegFsCallId)
 */
export function recordALegInit(
  callId:           string,
  callerExtension?: number,
  callerUserId?:    string,
  fsCallId?:        string,
): void {
  // Derive transport from session maps at init time — best-effort.
  const transport = resolveTransport(callerExtension);

  const state: ALegState = {
    callId,
    callerExtension,
    callerUserId,
    transport,
    fsCallId,
    initAt:                   Date.now(),
    status:                   "initiating",
    disconnectWatchdogActive: false,
  };

  aLegStore.set(callId, state);
  if (callerExtension != null) {
    extensionToCallId.set(callerExtension, callId);
  }

  logger.debug({ callId, callerExtension, transport, fsCallId }, "[ALeg] init recorded");
}

/**
 * Pre-call source validation — checks whether the caller's extension is
 * currently reachable via Verto (WebRTC) or SIP.
 *
 * Returns an ALegValidation object.  The result is stored on the ALegState so
 * the admin panel can show exactly what the caller's connectivity looked like
 * at call-initiation time.
 *
 * This does NOT block or throw — callers use the `alive` field to decide.
 * A missing/stale session is only a warning, not a hard block, because the
 * session map may be empty right after a server restart (sessions present but
 * not yet tracked since no login/REGISTER has been seen since restart).
 */
export function validateALegSource(
  callId:    string,
  extension: number,
): ALegValidation {
  const now = Date.now();

  const verto = getVertoSession(extension);
  const sip   = getSipSession(extension);

  const vertoPingAgeMs  = verto ? now - verto.lastPingAt : undefined;
  const vertoAlive      = verto != null && vertoPingAgeMs != null && vertoPingAgeMs < 45_000;

  const sipRegAgeMs     = sip ? now - sip.registeredAt : undefined;
  const sipExpiresInMs  = sip ? sip.expiresAt - now    : undefined;
  const sipAlive        = sip != null && sipExpiresInMs != null && sipExpiresInMs > 0;
  const sipExpired      = sip != null && !sipAlive;

  let transport: "verto" | "sip" | null = null;
  let alive = false;
  let reason: string;

  if (vertoAlive) {
    transport = "verto";
    alive     = true;
    reason    = `Verto WebSocket active (ping ${vertoPingAgeMs} ms ago)`;
  } else if (sipAlive) {
    transport = "sip";
    alive     = true;
    reason    = `SIP registered (expires in ${Math.round((sipExpiresInMs ?? 0) / 1000)} s)`;
  } else if (verto && !vertoAlive) {
    reason = `Verto session stale (last ping ${vertoPingAgeMs} ms ago — max 45000 ms)`;
  } else if (sipExpired) {
    reason = `SIP registration expired ${Math.round(Math.abs(sipExpiresInMs ?? 0) / 1000)} s ago`;
  } else {
    reason = "No Verto or SIP session found — caller may not be registered";
  }

  const result: ALegValidation = {
    checkedAt:    now,
    alive,
    transport,
    vertoPingAgeMs,
    sipRegAgeMs,
    sipExpiresInMs: sipExpiresInMs ?? undefined,
    sipExpired:     sipExpired || undefined,
    reason,
  };

  const state = aLegStore.get(callId);
  if (state) state.preflightResult = result;

  logger.info(
    { callId, extension, alive, transport, reason },
    "[ALeg] pre-call source validation",
  );

  return result;
}

/**
 * Called from the orchestrator's ringingCall() to record the A-leg UUID
 * once it is confirmed by FreeSWITCH.  This is the UUID that subsequent
 * ESL events (CHANNEL_ANSWER, CHANNEL_BRIDGE, CHANNEL_HANGUP_COMPLETE) will
 * carry in their Unique-ID or Other-Leg-Unique-ID fields.
 */
export function recordALegFsCallId(callId: string, fsCallId: string): void {
  const state = aLegStore.get(callId);
  if (!state) return;
  if (!state.fsCallId && fsCallId) {
    state.fsCallId = fsCallId;
    logger.debug({ callId, fsCallId }, "[ALeg] A-leg FS UUID recorded");
  }
}

/**
 * Called from ringingCall() in callOrchestrator when the call transitions to
 * "ringing" (CHANNEL_ORIGINATE confirmed). Stores the B-leg UUID and arms
 * the disconnect watchdog if the caller is on Verto.
 */
export function recordALegRinging(callId: string, bLegUuid?: string): void {
  const state = aLegStore.get(callId);
  if (!state || isTerminal(state.status)) return;

  state.status    = "ringing";
  state.ringingAt = Date.now();
  if (bLegUuid) state.bLegUuid = bLegUuid;

  logger.info(
    { callId, callerExtension: state.callerExtension, bLegUuid, transport: state.transport },
    "[ALeg] A-leg ringing",
  );
}

/**
 * Called from answerCall() in callOrchestrator when CHANNEL_ANSWER fires.
 */
export function recordALegAnswered(callId: string): void {
  const state = aLegStore.get(callId);
  if (!state || isTerminal(state.status)) return;

  state.status     = "answered";
  state.answeredAt = Date.now();

  const setupMs = state.ringingAt ? state.answeredAt - state.ringingAt : null;
  logger.info(
    { callId, callerExtension: state.callerExtension, setupMs, transport: state.transport },
    "[ALeg] A-leg answered",
  );
}

/**
 * Called from bridgeCall() in callOrchestrator when CHANNEL_BRIDGE fires.
 * Stores the B-leg UUID if not already set.
 */
export function recordALegBridged(callId: string, bLegUuid?: string): void {
  const state = aLegStore.get(callId);
  if (!state || isTerminal(state.status)) return;

  state.status   = "bridged";
  state.bridgedAt = Date.now();
  if (bLegUuid && !state.bLegUuid) state.bLegUuid = bLegUuid;

  const ringToAnswerMs = state.ringingAt && state.answeredAt
    ? state.answeredAt - state.ringingAt : null;
  const answerToBridgeMs = state.answeredAt && state.bridgedAt
    ? state.bridgedAt - state.answeredAt : null;

  logger.info(
    { callId, callerExtension: state.callerExtension, bLegUuid: state.bLegUuid, ringToAnswerMs, answerToBridgeMs },
    "[ALeg] A-leg bridged — two-way audio",
  );
}

/**
 * Called from finalizeCall() in callOrchestrator when CHANNEL_HANGUP_COMPLETE
 * fires.  Cancels any in-flight disconnect watchdog and records the terminal state.
 */
export function recordALegHangup(callId: string, hangupCause: string): void {
  cancelDisconnectWatchdog(callId);

  const state = aLegStore.get(callId);
  if (!state) return;
  if (isTerminal(state.status)) {
    logger.debug({ callId, hangupCause }, "[ALeg] recordALegHangup — already terminal, skipping");
    return;
  }

  // Map hangup cause to terminal status (mirrors the pattern in callStateMachine)
  let terminalStatus: ALegStatus;
  switch (hangupCause) {
    case "ORIGINATOR_CANCEL":
      terminalStatus = "cancelled"; break;
    case "NO_ANSWER":
    case "RECOVERY_ON_TIMER_EXPIRE":
    case "RECOVERY_ON_TIMER_EXPIRY":
    case "ALLOTTED_TIMEOUT":
    case "NO_PICKUP":
      terminalStatus = "missed"; break;
    case "USER_BUSY":
    case "CALL_REJECTED":
    case "LOSE_RACE":
      terminalStatus = "rejected"; break;
    case "NORMAL_CLEARING":
    case "NORMAL_UNSPECIFIED":
    case "ATTENDED_TRANSFER":
      terminalStatus = "ended"; break;
    default:
      terminalStatus = "failed"; break;
  }

  const now = Date.now();
  state.status      = terminalStatus;
  state.endedAt     = now;
  state.hangupCause = hangupCause;

  const totalDurationMs = now - state.initAt;
  const activeMs = state.answeredAt ? now - state.answeredAt : null;

  logger.info(
    {
      callId,
      callerExtension:  state.callerExtension,
      transport:        state.transport,
      terminalStatus,
      hangupCause,
      totalDurationMs,
      activeMs,
      ringingAt:        state.ringingAt ?? null,
      answeredAt:       state.answeredAt ?? null,
      bridgedAt:        state.bridgedAt ?? null,
      preflightAlive:   state.preflightResult?.alive ?? null,
    },
    "[ALeg] A-leg hung up",
  );
}

/**
 * Remove the state after a call ends cleanly (or after an admin cleanup).
 * Scheduled via a 5-min TTL to keep the state available for post-call diagnostics.
 * Same pattern as cleanupBLeg() in bLegManager.ts.
 */
export function cleanupALeg(callId: string, delayMs = 5 * 60_000): void {
  cancelDisconnectWatchdog(callId);
  setTimeout(() => {
    const state = aLegStore.get(callId);
    if (state?.callerExtension != null) {
      // Only remove the extension index if it still points to this call.
      if (extensionToCallId.get(state.callerExtension) === callId) {
        extensionToCallId.delete(state.callerExtension);
      }
    }
    aLegStore.delete(callId);
    logger.debug({ callId }, "[ALeg] state cleaned up");
  }, delayMs);
}

// ── Disconnect watchdog ───────────────────────────────────────────────────────

/**
 * Called by vertoProxy when a Verto client WebSocket closes.
 *
 * Finds any active call associated with the given extension and, after a short
 * grace period (ALEG_DISCONNECT_GRACE_MS), issues uuid_kill on the A-leg channel
 * if the call is still in a non-terminal state.
 *
 * This prevents zombie calls when the caller's browser tab closes or loses
 * connectivity without sending a proper Verto bye / SIP BYE.
 * FreeSWITCH's own Verto heartbeat timeout takes 30–45 s; this fires much sooner.
 *
 * A grace period is applied before killing to handle:
 *   - Brief WebSocket reconnects (tab refreshes, focus changes)
 *   - Network blips where the WS reconnects within a few seconds
 *   - A-leg already sending CHANNEL_HANGUP_COMPLETE before the watchdog fires
 */
export function notifyALegSessionDropped(extension: number): void {
  const callId = extensionToCallId.get(extension);
  if (!callId) {
    // No active call tracked for this extension — nothing to do.
    return;
  }

  const state = aLegStore.get(callId);
  if (!state) {
    extensionToCallId.delete(extension);
    return;
  }

  // If already terminal, nothing to do.
  if (isTerminal(state.status)) {
    logger.debug({ callId, extension, status: state.status }, "[ALeg] session dropped but call already terminal — no action");
    return;
  }

  // If no FS UUID yet (call still initiating), FreeSWITCH may never get to
  // CHANNEL_ORIGINATE — the INITIATED watchdog (in callOrchestrator) covers this.
  if (!state.fsCallId) {
    logger.info(
      { callId, extension, status: state.status },
      "[ALeg] session dropped with no fsCallId yet — INITIATED watchdog will handle",
    );
    return;
  }

  // Don't arm a second watchdog if one is already running.
  if (disconnectTimers.has(callId)) {
    logger.debug({ callId, extension }, "[ALeg] disconnect watchdog already armed — ignoring duplicate");
    return;
  }

  logger.warn(
    {
      callId,
      extension,
      status:       state.status,
      fsCallId:     state.fsCallId,
      graceMs:      DISCONNECT_GRACE_MS,
      transport:    state.transport,
    },
    "[ALeg] Caller Verto session dropped — arming disconnect watchdog",
  );

  state.disconnectWatchdogActive = true;

  const timer = setTimeout(() => {
    disconnectTimers.delete(callId);

    const current = aLegStore.get(callId);
    if (!current) return;

    // Re-check — call may have ended naturally during the grace period.
    if (isTerminal(current.status)) {
      logger.debug(
        { callId, extension, status: current.status },
        "[ALeg] Disconnect watchdog fired but call already ended — no action",
      );
      current.disconnectWatchdogActive = false;
      return;
    }

    // Re-check the session — caller may have reconnected.
    const verto = getVertoSession(extension);
    const vertoReconnected = verto != null && (Date.now() - verto.lastPingAt) < 5_000;
    if (vertoReconnected) {
      logger.info(
        { callId, extension, pingAgeMs: Date.now() - (verto?.lastPingAt ?? 0) },
        "[ALeg] Disconnect watchdog: Verto session reconnected — no kill issued",
      );
      current.disconnectWatchdogActive = false;
      return;
    }

    logger.warn(
      {
        callId,
        extension,
        fsCallId:  current.fsCallId,
        status:    current.status,
        graceMs:   DISCONNECT_GRACE_MS,
      },
      "[ALeg] Disconnect watchdog fired — caller Verto session not reconnected; sending uuid_kill NORMAL_CLEARING",
    );

    sendEslCmd(`uuid_kill ${current.fsCallId} NORMAL_CLEARING`);
    current.disconnectWatchdogActive = false;
  }, DISCONNECT_GRACE_MS);

  disconnectTimers.set(callId, timer);
}

/** Cancel the in-flight disconnect watchdog for a call (call ended naturally). */
function cancelDisconnectWatchdog(callId: string): void {
  const t = disconnectTimers.get(callId);
  if (t) {
    clearTimeout(t);
    disconnectTimers.delete(callId);
    const state = aLegStore.get(callId);
    if (state) state.disconnectWatchdogActive = false;
  }
}

/** Cancel all disconnect watchdogs (e.g. on ESL disconnect/server shutdown). */
export function clearAllALegWatchdogs(): void {
  for (const t of disconnectTimers.values()) clearTimeout(t);
  disconnectTimers.clear();
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

/**
 * Returns the A-leg state for a call, enriched with live session data.
 * Used by the admin panel to show real-time A-leg status.
 */
export function getALegDiagnostics(callId: string): (ALegState & {
  currentSessionStatus: ALegValidation | null;
  liveExtensionStatus: {
    online: boolean;
    transport: "verto" | "sip" | null;
    vertoPingAgeMs?: number;
    sipExpiresInMs?: number;
  } | null;
}) | null {
  const state = aLegStore.get(callId);
  if (!state) return null;

  const currentSessionStatus = state.callerExtension != null
    ? validateALegSource(callId, state.callerExtension)
    : null;

  let liveExtensionStatus: { online: boolean; transport: "verto" | "sip" | null; vertoPingAgeMs?: number; sipExpiresInMs?: number } | null = null;

  if (state.callerExtension != null) {
    const now   = Date.now();
    const verto = getVertoSession(state.callerExtension);
    const sip   = getSipSession(state.callerExtension);

    const vertoPingAgeMs  = verto ? now - verto.lastPingAt : undefined;
    const sipExpiresInMs  = sip   ? sip.expiresAt - now    : undefined;
    const vertoAlive      = verto != null && vertoPingAgeMs != null && vertoPingAgeMs < 45_000;
    const sipAlive        = sip   != null && sipExpiresInMs != null && sipExpiresInMs > 0;

    liveExtensionStatus = {
      online:    vertoAlive || sipAlive,
      transport: vertoAlive ? "verto" : sipAlive ? "sip" : null,
      vertoPingAgeMs,
      sipExpiresInMs: sipExpiresInMs ?? undefined,
    };
  }

  return {
    ...state,
    currentSessionStatus,
    liveExtensionStatus,
  };
}

/**
 * Returns a snapshot of all active A-leg states.
 * Used by the admin panel for the live calls view.
 */
export function getAllALegStates(): ALegState[] {
  return Array.from(aLegStore.values());
}

/**
 * Returns the active A-leg callId for an extension, if any.
 * Used by notifyALegSessionDropped and admin tooling.
 */
export function getCallIdForExtension(extension: number): string | null {
  return extensionToCallId.get(extension) ?? null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Determine transport from session maps at a point in time. */
function resolveTransport(extension: number | undefined): "verto" | "sip" | "unknown" {
  if (extension == null) return "unknown";
  const now   = Date.now();
  const verto = getVertoSession(extension);
  const sip   = getSipSession(extension);
  if (verto && now - verto.lastPingAt < 45_000) return "verto";
  if (sip && sip.expiresAt > now)               return "sip";
  // Extension may be registered but not yet in the session map (just after
  // a server restart). Return "unknown" rather than claiming it's offline.
  return "unknown";
}
