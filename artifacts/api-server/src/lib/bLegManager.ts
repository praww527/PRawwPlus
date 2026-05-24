/**
 * B-leg Manager — per-call A/B-leg lifecycle tracking, pre-originate validation,
 * and proactive re-registration waiting.
 *
 * Terminology
 *   A-leg  = caller's channel (the Verto/SIP UA that sent verto.invite)
 *   B-leg  = callee's channel (the channel FreeSWITCH tries to originate to)
 *
 * This module is intentionally in-memory and never touches MongoDB — it is a
 * short-lived coordination layer whose state lives only as long as the call.
 *
 * Key lifecycle hooks
 *   1. POST /api/calls              → recordBLegInit()
 *   2. GET  /api/calls/:id/callee-ready → waitForRegistration()
 *   3. CHANNEL_ORIGINATE            → recordOriginateConfirmed()
 *   4. USER_NOT_REGISTERED hangup   → recordBLegFailed()
 *   5. sofia::register              → notifyRegistration()
 *   6. CHANNEL_HANGUP_COMPLETE (ok) → cleanupBLeg()
 */

import { logger } from "./logger";
import {
  isExtensionOnline,
  getVertoSession,
  getSipSession,
} from "./callSession";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DestValidation {
  checkedAt:       number;
  reachable:       boolean;
  transport:       "verto" | "sip" | null;
  vertoPingAgeMs?: number;
  sipRegAgeMs?:    number;
  sipExpiresInMs?: number;
  sipExpired?:     boolean;
  reason:          string;
}

export type BLegStatus =
  | "pending"        // init recorded, wakeup not yet confirmed
  | "wakeup_sent"    // push wakeup dispatched, waiting for re-reg
  | "originating"    // CHANNEL_ORIGINATE received — B-leg is being rung
  | "confirmed"      // call bridged successfully
  | "failed"         // hangup before bridge (USER_NOT_REGISTERED, NO_ANSWER, …)
  | "recovered"      // re-registered after initial failure, re-originate attempted
  | "cleaned_up";    // call ended normally; state removed

export interface BLegState {
  callId:            string;
  destExtension:     number;
  calleeUserId?:     string;
  initAt:            number;
  wakeupSentAt?:     number;
  preflightResult?:  DestValidation;
  recoveryAttempts:  number;
  lastRecoveryAt?:   number;
  originateConfirmedAt?: number;
  bLegUuid?:         string;
  aLegUuid?:         string;
  failedAt?:         number;
  hangupCause?:      string;
  status:            BLegStatus;
}

// ── State stores ──────────────────────────────────────────────────────────────

/** Per-call state keyed by callId (MongoDB _id). */
const bLegStore = new Map<string, BLegState>();

/**
 * Registration waiters: extension → list of callbacks to invoke when
 * notifyRegistration() is called for that extension.
 */
const registrationWaiters = new Map<number, Array<() => void>>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called by POST /api/calls once the DB record is created.
 * Records the initial B-leg state so the rest of the pipeline can track it.
 */
export function recordBLegInit(
  callId:        string,
  destExtension: number,
  calleeUserId?: string,
): void {
  bLegStore.set(callId, {
    callId,
    destExtension,
    calleeUserId,
    initAt:           Date.now(),
    recoveryAttempts: 0,
    status:           "pending",
  });
  logger.debug({ callId, destExtension }, "[BLeg] init recorded");
}

/**
 * Called by POST /api/calls after push wakeups are dispatched.
 */
export function recordWakeupSent(callId: string): void {
  const state = bLegStore.get(callId);
  if (!state) return;
  state.wakeupSentAt = Date.now();
  state.status       = "wakeup_sent";
  logger.debug({ callId, destExtension: state.destExtension }, "[BLeg] wakeup sent");
}

/**
 * Pre-originate validation — checks whether the destination extension is
 * currently reachable via Verto (WebRTC) or SIP.
 *
 * Returns a DestValidation object. The result is stored on the BLegState so
 * the admin panel can show exactly why a call was or wasn't blocked.
 *
 * This does NOT block or throw — callers use the `reachable` field to decide.
 */
export function validateBLegDestination(
  callId:    string,
  extension: number,
): DestValidation {
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
  let reachable = false;
  let reason: string;

  if (vertoAlive) {
    transport = "verto";
    reachable = true;
    reason    = `Verto WebSocket active (ping ${vertoPingAgeMs} ms ago)`;
  } else if (sipAlive) {
    transport = "sip";
    reachable = true;
    reason    = `SIP registered (expires in ${Math.round((sipExpiresInMs ?? 0) / 1000)} s)`;
  } else if (verto && !vertoAlive) {
    reason = `Verto session stale (last ping ${vertoPingAgeMs} ms ago — max 45000 ms)`;
  } else if (sipExpired) {
    reason = `SIP registration expired ${Math.round(Math.abs(sipExpiresInMs ?? 0) / 1000)} s ago`;
  } else {
    reason = "No Verto or SIP session found in session maps";
  }

  const result: DestValidation = {
    checkedAt:    now,
    reachable,
    transport,
    vertoPingAgeMs,
    sipRegAgeMs,
    sipExpiresInMs: sipExpiresInMs ?? undefined,
    sipExpired:     sipExpired || undefined,
    reason,
  };

  // Store on state
  const state = bLegStore.get(callId);
  if (state) state.preflightResult = result;

  logger.info(
    { callId, extension, reachable, transport, reason },
    "[BLeg] pre-originate validation",
  );

  return result;
}

/**
 * Called by the `callee-ready` endpoint.
 *
 * Waits up to `timeoutMs` for the destination extension to appear in either
 * the Verto or SIP session maps.  Returns immediately if already registered.
 *
 * Uses two complementary mechanisms:
 *   1. `notifyRegistration()` callbacks — fired by handleSofiaRegister() in ESL
 *   2. A 500 ms polling loop — safety net in case the ESL callback was missed
 */
export async function waitForRegistration(
  extension: number,
  timeoutMs = 12_000,
): Promise<{ registered: boolean; transport: "verto" | "sip" | null; elapsedMs: number }> {
  const start = Date.now();

  // Fast path: already registered
  if (isExtensionOnline(extension)) {
    return {
      registered: true,
      transport:  getBestTransport(extension),
      elapsedMs:  0,
    };
  }

  let onNotify: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    const registered = await new Promise<boolean>((resolve) => {
      // Register waiter so notifyRegistration() can resolve us immediately
      onNotify = () => resolve(true);
      const list = registrationWaiters.get(extension) ?? [];
      list.push(onNotify);
      registrationWaiters.set(extension, list);

      // Safety-net poll — catches re-registrations that arrive before our
      // waiter was added or whose ESL event fired before we subscribed.
      pollTimer = setInterval(() => {
        if (isExtensionOnline(extension)) resolve(true);
      }, 500);

      // Hard timeout
      timeoutTimer = setTimeout(() => resolve(false), timeoutMs);
    });

    return {
      registered,
      transport: registered ? getBestTransport(extension) : null,
      elapsedMs: Date.now() - start,
    };
  } finally {
    if (pollTimer)   clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);

    // Remove our waiter from the list
    if (onNotify) {
      const list = registrationWaiters.get(extension);
      if (list) {
        const idx = list.indexOf(onNotify);
        if (idx !== -1) list.splice(idx, 1);
        if (list.length === 0) registrationWaiters.delete(extension);
      }
    }
  }
}

/**
 * Called by `handleSofiaRegister()` in freeswitchESL.ts whenever FreeSWITCH
 * confirms a fresh SIP registration.  Resolves any callers blocked in
 * `waitForRegistration()` for this extension.
 */
export function notifyRegistration(extension: number): void {
  const list = registrationWaiters.get(extension);
  if (!list || list.length === 0) return;

  logger.debug({ extension, waiters: list.length }, "[BLeg] notifyRegistration — waking waiters");

  // Snapshot and clear before calling, to prevent re-entrant additions
  const snapshot = list.slice();
  registrationWaiters.delete(extension);
  for (const resolve of snapshot) resolve();
}

/**
 * Called by `handleOriginate()` in freeswitchESL.ts when CHANNEL_ORIGINATE fires.
 * This confirms the B-leg was successfully created by FreeSWITCH.
 *
 * We look up by destExtension (from the originate event) in addition to callId
 * because at originate time we may not yet know the exact callId.
 */
export function recordOriginateConfirmed(
  bLegUuid:      string,
  aLegUuid:      string,
  destExtension: number,
): void {
  // Find the matching state by aLegUuid first (most reliable), then by destExtension
  let state: BLegState | undefined;

  for (const s of bLegStore.values()) {
    if (
      s.aLegUuid === aLegUuid ||
      s.destExtension === destExtension
    ) {
      state = s;
      break;
    }
  }

  if (!state) {
    logger.debug(
      { bLegUuid, aLegUuid, destExtension },
      "[BLeg] recordOriginateConfirmed — no matching state found (external call or cold start)",
    );
    return;
  }

  state.bLegUuid              = bLegUuid;
  state.aLegUuid              = aLegUuid;
  state.originateConfirmedAt  = Date.now();
  state.status                = "originating";

  logger.info(
    { callId: state.callId, bLegUuid, aLegUuid, destExtension },
    "[BLeg] CHANNEL_ORIGINATE confirmed — B-leg is being rung",
  );
}

/**
 * Records the A-leg UUID on the state so `recordOriginateConfirmed` can match it.
 * Called from `ringingCall()` in callOrchestrator when we learn the A-leg UUID.
 */
export function recordALegUuid(callId: string, aLegUuid: string): void {
  const state = bLegStore.get(callId);
  if (!state) return;
  if (!state.aLegUuid) {
    state.aLegUuid = aLegUuid;
  }
}

/**
 * Called when CHANNEL_HANGUP_COMPLETE fires with a non-recoverable failure cause
 * (USER_NOT_REGISTERED, NO_ANSWER, ORIGINATOR_CANCEL, etc.).
 */
export function recordBLegFailed(
  callId:      string,
  hangupCause: string,
  bLegUuid?:   string,
): void {
  const state = bLegStore.get(callId);
  if (!state) return;

  state.failedAt    = Date.now();
  state.hangupCause = hangupCause;
  state.status      = "failed";
  if (bLegUuid) state.bLegUuid = bLegUuid;

  const preflightMs = state.initAt ? state.failedAt - state.initAt : null;

  logger.warn(
    {
      callId,
      destExtension:   state.destExtension,
      hangupCause,
      preflightMs,
      wakeupSentAt:    state.wakeupSentAt ?? null,
      preflight:       state.preflightResult ?? null,
      recoveryAttempts: state.recoveryAttempts,
    },
    "[BLeg] B-leg failed",
  );
}

/**
 * Increments the recovery attempt counter. Called by autoRecoverUnregistered.
 */
export function recordRecoveryAttempt(destExtension: number): void {
  for (const state of bLegStore.values()) {
    if (state.destExtension === destExtension) {
      state.recoveryAttempts++;
      state.lastRecoveryAt = Date.now();
      if (state.status === "failed") state.status = "recovered";
      logger.info(
        { callId: state.callId, destExtension, attempt: state.recoveryAttempts },
        "[BLeg] recovery attempt recorded",
      );
    }
  }
}

/**
 * Remove the state after a call ends cleanly (or after an admin cleanup).
 * Scheduled via a 5-min TTL to keep the state available for post-call diagnostics.
 */
export function cleanupBLeg(callId: string, delayMs = 5 * 60_000): void {
  setTimeout(() => {
    bLegStore.delete(callId);
    logger.debug({ callId }, "[BLeg] state cleaned up");
  }, delayMs);
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

/**
 * Returns the B-leg state for a call, enriched with live session data.
 * Used by the admin panel to show real-time B-leg status.
 */
export function getBLegDiagnostics(callId: string): (BLegState & {
  currentSessionStatus: DestValidation | null;
  waiterCount: number;
}) | null {
  const state = bLegStore.get(callId);
  if (!state) return null;

  const currentSessionStatus = validateBLegDestination(callId, state.destExtension);

  return {
    ...state,
    currentSessionStatus,
    waiterCount: registrationWaiters.get(state.destExtension)?.length ?? 0,
  };
}

/**
 * Returns a snapshot of all active B-leg states.
 * Used by the admin panel for the live calls view.
 */
export function getAllBLegStates(): BLegState[] {
  return Array.from(bLegStore.values());
}

/**
 * Returns session diagnostics for a specific extension — used directly by
 * the admin session-status endpoint without needing a callId.
 */
export function getExtensionSessionDiagnostics(extension: number): DestValidation {
  const now   = Date.now();
  const verto = getVertoSession(extension);
  const sip   = getSipSession(extension);

  const vertoPingAgeMs  = verto ? now - verto.lastPingAt : undefined;
  const vertoAlive      = verto != null && vertoPingAgeMs != null && vertoPingAgeMs < 45_000;
  const sipRegAgeMs     = sip ? now - sip.registeredAt  : undefined;
  const sipExpiresInMs  = sip ? sip.expiresAt - now     : undefined;
  const sipAlive        = sip != null && sipExpiresInMs != null && sipExpiresInMs > 0;
  const sipExpired      = sip != null && !sipAlive;

  let transport: "verto" | "sip" | null = null;
  let reachable = false;
  let reason: string;

  if (vertoAlive) {
    transport = "verto"; reachable = true;
    reason    = `Verto WebSocket active (ping ${vertoPingAgeMs} ms ago)`;
  } else if (sipAlive) {
    transport = "sip"; reachable = true;
    reason    = `SIP registered (expires in ${Math.round((sipExpiresInMs ?? 0) / 1000)} s)`;
  } else if (verto && !vertoAlive) {
    reason = `Verto session stale (last ping ${vertoPingAgeMs} ms ago)`;
  } else if (sipExpired) {
    reason = `SIP registration expired (${Math.round(Math.abs(sipExpiresInMs ?? 0) / 1000)} s ago)`;
  } else {
    reason = "No session found — extension is offline";
  }

  return {
    checkedAt:    now,
    reachable,
    transport,
    vertoPingAgeMs,
    sipRegAgeMs,
    sipExpiresInMs: sipExpiresInMs ?? undefined,
    sipExpired:     sipExpired || undefined,
    reason,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Returns the freshest available transport for an extension. */
function getBestTransport(extension: number): "verto" | "sip" | null {
  const now   = Date.now();
  const verto = getVertoSession(extension);
  const sip   = getSipSession(extension);

  if (verto && now - verto.lastPingAt < 45_000) return "verto";
  if (sip && sip.expiresAt > now)               return "sip";
  return null;
}
