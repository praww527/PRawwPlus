/**
 * CallOrchestrator — single source of truth for call lifecycle logic.
 *
 * Call state transitions:
 *   initiated → ringing   (CHANNEL_ORIGINATE via ESL)
 *   ringing   → answered  (CHANNEL_ANSWER via ESL)
 *   answered  → completed / failed / missed / cancelled  (CHANNEL_HANGUP_COMPLETE via ESL)
 *
 * Public API:
 *   ringingCall(fsCallId)                    — CHANNEL_ORIGINATE
 *   answerCall(fsCallId)                     — CHANNEL_ANSWER
 *   finalizeCall(fsCallId, billsec, cause)   — CHANNEL_HANGUP_COMPLETE (ESL)
 *   endCallById(callId, userId, duration)    — REST /end: internal UX only; external = ESL-only
 *   cancelHangupTimer(fsCallId)              — call ended early; cancel balance timer
 */

import mongoose, { type ClientSession } from "mongoose";
import { connectDB, CallModel, UserModel, VoicemailModel } from "@workspace/db";
import { BillingLedgerModel, CdrModel } from "@workspace/db";
import { logger } from "./logger";
import {
  isTransitionAllowed,
  causeToStatus,
  causeToLabel,
  TERMINAL_CALL_STATUSES,
  type CallStatus,
} from "./callStateMachine";
import { EventResult } from "./eslEventBuffer";
import { resolveCoinsPerMinuteForUser, calcCoinsFromBillsec } from "./rating";
import { sendExpoPush, sendFcmDataMessage } from "./push";
import { appendCallEvent } from "./callEventLog";
import { armMediaWatchdog, cancelMediaWatchdog, clearAllMediaWatchdogs } from "./mediaWatchdog";
import { metrics } from "./metrics";
import { randomUUID } from "node:crypto";

/** Configurable ring timeout — kills stale ringing channels if FS own timer doesn't fire */
const RING_TIMEOUT_MS = parseInt(process.env.RING_TIMEOUT_MS ?? "45000", 10);

const COINS_PER_MINUTE = 1;
const MIN_COINS_SAFETY = 0.1;
const INSUFFICIENT_BALANCE_VOICE_DELAY = 9_000;
const BILLING_FS_PROJECTION = "status callType userId endedAt _id recipientNumber callerNumber direction startedAt fsCallId" as const;

function getMaxBillsecPerCall(): number {
  const raw = parseInt(process.env.MAX_BILLSEC_PER_CALL ?? "86400", 10);
  const n   = Number.isFinite(raw) ? raw : 86_400;
  return Math.min(86_400, Math.max(60, n));
}

async function maybeSendLowBalanceAlert(userId: string): Promise<void> {
  try {
    const user = await UserModel.findById(userId)
      .select("coins lowBalanceThresholdCoins expoPushToken fcmToken notificationPrefs")
      .lean();
    if (!user) return;

    const threshold =
      typeof user.lowBalanceThresholdCoins === "number"
        ? user.lowBalanceThresholdCoins
        : parseInt(process.env.LOW_BALANCE_THRESHOLD_COINS ?? "5", 10);

    if (!Number.isFinite(threshold) || threshold <= 0) return;
    if (user.coins > threshold) return;
    if (user.notificationPrefs?.lowBalance === false) return;

    const title = "Low balance";
    const body = `Your balance is low (${user.coins} coins). Please top up.`;
    const data = { type: "low_balance", coins: String(user.coins) };

    if (user.expoPushToken) {
      await sendExpoPush(user.expoPushToken, title, body, data);
    }
    if (user.fcmToken) {
      await sendFcmDataMessage(user.fcmToken, data);
    }
  } catch (err) {
    logger.warn({ err }, "[Billing] low balance alert failed");
  }
}

/** Injected at startup so the orchestrator can issue FreeSWITCH commands
 *  without a circular import with freeswitchESL.ts */
let eslCommandFn: ((cmd: string) => void) | null = null;

export function setEslCommandFn(fn: (cmd: string) => void) {
  eslCommandFn = fn;
}

// ESL trace function wired by freeswitchESL at startup (avoids circular import)
let eslTraceFn: ((uuid: string) => { event: string; ts: number; cause?: string }[]) | null = null;

export function setEslTraceFn(fn: (uuid: string) => { event: string; ts: number; cause?: string }[]): void {
  eslTraceFn = fn;
}

function sendEslCmd(cmd: string) {
  if (eslCommandFn) {
    eslCommandFn(cmd);
  } else {
    logger.warn({ cmd }, "[Orchestrator] ESL command fn not set — command dropped");
  }
}

/** Active balance-exhaustion timers keyed by fsCallId */
const hangupTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Ring timeout watchdog ────────────────────────────────────────────────────
// Fires RING_TIMEOUT_MS after the call enters "ringing" state.
// If the call is still ringing (not answered/bridged) at that point, we issue
// uuid_kill so the call doesn't stay zombie-ringing indefinitely.
// This is a safety net — FreeSWITCH's own no_answer_timeout in the dialplan
// (typically 30 s) should fire first; this fires if it doesn't.

const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelRingTimer(fsCallId: string): void {
  const t = ringTimers.get(fsCallId);
  if (t) { clearTimeout(t); ringTimers.delete(fsCallId); }
}

function registerRingTimer(fsCallId: string): void {
  cancelRingTimer(fsCallId);
  if (!RING_TIMEOUT_MS || RING_TIMEOUT_MS <= 0) return;

  const timer = setTimeout(() => {
    ringTimers.delete(fsCallId);
    logger.warn(
      { fsCallId, ringTimeoutMs: RING_TIMEOUT_MS },
      "[Orchestrator] Ring timeout expired — sending uuid_kill to prevent zombie ringing",
    );
    sendEslCmd(`uuid_kill ${fsCallId} RECOVERY_ON_TIMER_EXPIRE`);
  }, RING_TIMEOUT_MS);

  ringTimers.set(fsCallId, timer);
}

export function cancelHangupTimer(fsCallId: string) {
  const t = hangupTimers.get(fsCallId);
  if (t) {
    clearTimeout(t);
    hangupTimers.delete(fsCallId);
  }
}

export function clearAllHangupTimers() {
  for (const t of hangupTimers.values()) clearTimeout(t);
  hangupTimers.clear();
  for (const t of ringTimers.values()) clearTimeout(t);
  ringTimers.clear();
  clearAllMediaWatchdogs();
}

// ─── INITIATED state auto-recovery ───────────────────────────────────────────
// If FreeSWITCH never fires CHANNEL_ORIGINATE or CHANNEL_HANGUP_COMPLETE within
// the grace period, the call is almost certainly dead (SIP registration failure,
// dialplan misconfiguration, ESL connectivity loss, etc.).  We mark it failed so
// the DB record and UI don't stay stuck indefinitely.
//
// The timer is cancelled as soon as any ESL event (CHANNEL_ORIGINATE →
// ringingCall, CHANNEL_HANGUP_COMPLETE → finalizeCall) arrives.

const INITIATED_TIMEOUT_MS = 20_000; // 20 s matches task requirement

/** Timer handles keyed by fsCallId */
const initiatedTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Start the INITIATED-state watchdog for a newly-created call.
 * Must be called immediately after the DB record is written with status "initiated".
 * Idempotent — re-registering the same fsCallId resets the timer.
 */
export function registerInitiatedCall(
  fsCallId: string,
  callId:   string,
  delayMs   = INITIATED_TIMEOUT_MS,
): void {
  // Clear any previous timer for this UUID (idempotent re-registration)
  const existing = initiatedTimers.get(fsCallId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    initiatedTimers.delete(fsCallId);
    try {
      await connectDB();
      const call = await CallModel.findOne({ fsCallId, status: "initiated" })
        .select("_id userId")
        .lean();
      if (!call) return; // Already transitioned — nothing to do

      const eslTrace = eslTraceFn ? eslTraceFn(fsCallId) : [];

      logger.warn(
        {
          fsCallId,
          callId,
          eslEventCount: eslTrace.length,
          // Condensed trace: just event names + timestamps for log readability
          eslTrace: eslTrace.map((e) => ({
            event: e.event,
            ts:    new Date(e.ts).toISOString(),
            ...(e.cause ? { cause: e.cause } : {}),
          })),
          diagnosis: eslTrace.length === 0
            ? "NO_ESL_EVENTS — ESL subscription failed, originate command never sent, or FreeSWITCH is not connected"
            : eslTrace.some((e) => e.event === "CHANNEL_CREATE") && !eslTrace.some((e) => e.event === "CHANNEL_PROGRESS" || e.event === "CHANNEL_PROGRESS_MEDIA")
            ? "CREATE_NO_PROGRESS — Channel created but no SIP 180/183 received; likely routing/dialplan issue or invalid SIP profile"
            : eslTrace.some((e) => e.event === "CHANNEL_PROGRESS" || e.event === "CHANNEL_PROGRESS_MEDIA")
            ? "PROGRESS_NO_ANSWER — Callee UA is reachable but not answering; may be app-backgrounded or Verto disconnected"
            : "UNKNOWN — check eslTrace for details",
        },
        "[Orchestrator] INITIATED timeout — no FreeSWITCH activity in 20 s; marking failed. " +
        "Likely cause: SIP/Verto registration missing, dialplan misconfiguration, or ESL disconnected.",
      );

      await CallModel.findOneAndUpdate(
        { _id: call._id, status: "initiated" },
        {
          $set: {
            status:     "failed",
            endedAt:    new Date(),
            failReason: "No FreeSWITCH activity within 20 s — possible SIP registration failure",
            hangupCause: "USER_NOT_REGISTERED",
            duration:   0,
            cost:       0,
          },
        },
      );

      appendCallEvent({
        callId:   String(call._id),
        fsCallId,
        userId:   String(call.userId),
        event:    "failed",
        metadata: { reason: "initiated_timeout", delayMs },
      }).catch(() => {});
    } catch (err) {
      logger.error({ err, fsCallId, callId }, "[Orchestrator] initiatedTimeout handler error");
    }
  }, delayMs);

  initiatedTimers.set(fsCallId, timer);
}

function cancelInitiatedTimer(fsCallId: string) {
  const t = initiatedTimers.get(fsCallId);
  if (t) {
    clearTimeout(t);
    initiatedTimers.delete(fsCallId);
  }
}

// ─── Billing helpers ───────────────────────────────────────────────────────

function clampBillsec(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const n = Math.max(0, Math.floor(raw));
  return Math.min(n, getMaxBillsecPerCall());
}

function calcCoins(billsec: number, coinsPerMinute: number): number {
  const s = clampBillsec(billsec);
  return calcCoinsFromBillsec(s, coinsPerMinute);
}

async function deductCoinsAndUpdateStats(
  userId: string,
  coinsUsed: number,
  callId: string,
  session?: ClientSession | null,
): Promise<void> {
  const opts = session ? { session } : {};
  try {
    if (coinsUsed > 0) {
      await UserModel.updateOne(
        { _id: userId },
        [
          {
            $set: {
              coins:          { $max: [0, { $subtract: ["$coins", coinsUsed] }] },
              totalCallsUsed: { $add: ["$totalCallsUsed", 1] },
              totalCoinsUsed: { $add: ["$totalCoinsUsed", coinsUsed] },
            },
          },
        ],
        opts,
      );
    } else {
      await UserModel.updateOne({ _id: userId }, { $inc: { totalCallsUsed: 1 } }, opts);
    }
    logger.info({ callId, userId, coinsUsed }, "[Orchestrator] Billing applied");
  } catch (err) {
    logger.error(
      { err, callId, userId, coinsUsed },
      "[Orchestrator] CRITICAL: Billing DB update failed after call was finalised — reconcile wallet vs Call.cost",
    );
    if (session) throw err;
  }
}

// ─── State-gated DB write ─────────────────────────────────────────────────

type TransitionOutcome =
  | { applied: true; callId: string; userId: string; callType: string }
  | { applied: false; callId: string; userId: string; callType: string };

/**
 * Transition a call's status in MongoDB when permitted by the state machine.
 * `applied: false` means the write was skipped (already terminal / idempotent)
 * — callers must not bill or treat it as a fresh transition.
 */
async function transitionCallStatus(
  fsCallId: string,
  to: CallStatus,
  update: Record<string, unknown>,
  otherLegId?: string,
): Promise<TransitionOutcome | null> {
  await connectDB();
  let call = await CallModel.findOne({ fsCallId });
  if (!call && otherLegId && otherLegId !== fsCallId) {
    call = await CallModel.findOne({ fsCallId: otherLegId });
    if (call) {
      logger.debug({ fsCallId, otherLegId }, "[Orchestrator] Resolved call via Other-Leg-Unique-ID");
    }
  }
  if (!call) return null;

  const meta = {
    callId: String(call._id),
    userId: String(call.userId),
    callType: call.callType,
  };

  let allowed: boolean;
  try {
    allowed = isTransitionAllowed(call.status, to);
  } catch (err: unknown) {
    logger.warn({ fsCallId, from: call.status, to, err: (err as Error).message },
      "[Orchestrator] Invalid state transition — skipping");
    return { applied: false, ...meta };
  }

  if (!allowed) {
    logger.warn({ fsCallId, from: call.status, to },
      "[Orchestrator] Skipping state transition — call already in terminal state");
    return { applied: false, ...meta };
  }

  // Compare-and-set on current status so concurrent finalize / duplicate ESL legs
  // cannot resurrect a terminal row or double-apply side effects (e.g. balance timers).
  const fromStatus = call.status;
  const updated = await CallModel.findOneAndUpdate(
    { _id: call._id, status: fromStatus },
    { $set: { status: to, ...update } },
    { returnDocument: 'after' },
  ).lean();

  if (!updated) {
    logger.debug(
      { fsCallId, from: fromStatus, to },
      "[Orchestrator] State transition lost race — skipping",
    );
    return { applied: false, ...meta };
  }

  logger.info({ fsCallId, from: fromStatus, to }, "[Orchestrator] State transition applied");
  return { applied: true, ...meta };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Handle CHANNEL_ORIGINATE: transition initiated → ringing.
 *
 * FreeSWITCH fires CHANNEL_ORIGINATE on the B-leg (the outgoing channel).
 * The A-leg UUID (= fsCallId stored in DB) is passed as `aLegUuid`.
 *
 * Returns EventResult.RETRY when the DB record doesn't exist yet.
 */
export async function ringingCall(
  aLegUuid: string,
  bLegUuid: string,
): Promise<EventResult> {
  // Cancel the INITIATED watchdog — FS acknowledged the call
  cancelInitiatedTimer(aLegUuid);
  if (bLegUuid && bLegUuid !== aLegUuid) cancelInitiatedTimer(bLegUuid);

  await connectDB();

  // Try to find by A-leg UUID first (this is what's stored as fsCallId)
  let call = await CallModel.findOne({ fsCallId: aLegUuid })
    .select("status")
    .lean();

  // Fallback: try B-leg UUID (in case we stored the wrong one)
  if (!call && bLegUuid !== aLegUuid) {
    call = await CallModel.findOne({ fsCallId: bLegUuid })
      .select("status")
      .lean();
    if (call) {
      logger.debug({ aLegUuid, bLegUuid }, "[Orchestrator] ringingCall resolved via B-leg UUID");
    }
  }

  if (!call) return EventResult.RETRY;

  // Pass both UUIDs so transitionCallStatus can resolve whichever matches DB
  const result = await transitionCallStatus(aLegUuid, "ringing", {}, bLegUuid);
  if (!result) return EventResult.RETRY;

  logger.info({ aLegUuid, bLegUuid, applied: result.applied }, "[Orchestrator] ringingCall done");
  if (result.applied) {
    // Start the ring timeout watchdog so stale ringing channels are killed
    // if FreeSWITCH's own no_answer_timeout doesn't fire in time.
    registerRingTimer(aLegUuid);
    if (bLegUuid && bLegUuid !== aLegUuid) registerRingTimer(bLegUuid);

    appendCallEvent({
      callId: result.callId, fsCallId: aLegUuid,
      userId: result.userId, event: "ringing",
      metadata: { bLegUuid },
    }).catch(() => {});
  }
  return EventResult.DONE;
}

/**
 * Handle CHANNEL_BRIDGE: transition answered → bridged.
 *
 * FreeSWITCH fires CHANNEL_BRIDGE when two-way audio is truly established
 * between both legs.  This is the definitive "call is connected" event.
 * Recording should be started here rather than at CHANNEL_ANSWER.
 *
 * Returns EventResult.RETRY when the DB record doesn't exist yet.
 */
export async function bridgeCall(
  fsCallId: string,
  otherLegId?: string,
): Promise<EventResult> {
  // Cancel ring timer — the call progressed past ringing
  cancelRingTimer(fsCallId);
  if (otherLegId && otherLegId !== fsCallId) cancelRingTimer(otherLegId);

  const result = await transitionCallStatus(
    fsCallId,
    "bridged",
    { bridgedAt: new Date() },
    otherLegId,
  );
  if (!result) return EventResult.RETRY;

  logger.info({ fsCallId, otherLegId, applied: result.applied }, "[Orchestrator] bridgeCall done");
  if (result.applied) {
    // Record bridge time in metrics (startedAt → bridge)
    try {
      const callDoc = await CallModel.findById(result.callId).select("startedAt").lean();
      if (callDoc?.startedAt) {
        metrics.recordBridgeSetupLatency(Date.now() - callDoc.startedAt.getTime());
      }
    } catch { /* non-critical */ }

    appendCallEvent({
      callId: result.callId, fsCallId,
      userId: result.userId, event: "bridged",
      metadata: { otherLegId },
    }).catch(() => {});

    // Arm the RTP/media health watchdog
    armMediaWatchdog(fsCallId, otherLegId, result.callId, result.userId);
  }
  return EventResult.DONE;
}

/**
 * Kill the sibling leg of a call for bidirectional hangup propagation.
 *
 * When the A-leg hangs up, FreeSWITCH normally also kills the B-leg.
 * This explicit command handles edge cases where the sibling leg becomes orphaned
 * (e.g. mid-bridge transfer failures, dialplan loops, early-media-only calls).
 */
export function killSiblingLeg(siblingUuid: string, cause = "NORMAL_CLEARING"): void {
  if (!siblingUuid) return;
  sendEslCmd(`uuid_kill ${siblingUuid} ${cause}`);
}

/**
 * Handle CHANNEL_ANSWER: transition initiated/ringing → answered and, for external
 * calls, schedule a balance-exhaustion hangup.
 *
 * FreeSWITCH fires CHANNEL_ANSWER on BOTH legs. We check the primary UUID first
 * then fall back to the other-leg UUID so we catch whichever fires first.
 *
 * Returns EventResult.RETRY when the DB record doesn't exist yet (buffer will retry).
 */
export async function answerCall(
  fsCallId: string,
  otherLegId?: string,
): Promise<EventResult> {
  await connectDB();

  let call = await CallModel.findOne({ fsCallId })
    .select("status callType userId endedAt")
    .lean();

  // Try the other leg (B-leg CHANNEL_ANSWER carries A-leg UUID in Other-Leg-Unique-ID)
  if (!call && otherLegId && otherLegId !== fsCallId) {
    call = await CallModel.findOne({ fsCallId: otherLegId })
      .select("status callType userId endedAt")
      .lean();
    if (call) {
      logger.debug({ fsCallId, otherLegId }, "[Orchestrator] answerCall resolved via Other-Leg-Unique-ID");
      // Swap so the orchestrator uses the matching UUID
      fsCallId = otherLegId;
    }
  }

  if (!call) return EventResult.RETRY;

  // Already answered/bridged or in terminal state
  if (call.status === "answered" || call.status === "bridged" || call.endedAt) {
    logger.debug({ fsCallId }, "[Orchestrator] answerCall — already answered/bridged, skipping");
    return EventResult.DONE;
  }

  // Cancel ring timeout — call is being answered
  cancelRingTimer(fsCallId);
  if (otherLegId && otherLegId !== fsCallId) cancelRingTimer(otherLegId);

  const result = await transitionCallStatus(fsCallId, "answered", { startedAt: new Date() });
  if (!result) return EventResult.RETRY;
  if (!result.applied) return EventResult.DONE;

  appendCallEvent({
    callId: result.callId, fsCallId,
    userId: result.userId, event: "answered",
    metadata: { callType: call.callType },
  }).catch(() => {});

  // Mid-call balance enforcement for external calls
  if (call.callType === "external") {
    const user = await UserModel.findById(call.userId).select("coins").lean();
    const coins = user?.coins ?? 0;

    const coinsPerMinute = await resolveCoinsPerMinuteForUser(
      String(call.userId),
      String((call as any).recipientNumber ?? ""),
    );
    const effectiveRate = Math.max(0.0001, Number.isFinite(coinsPerMinute) ? coinsPerMinute : COINS_PER_MINUTE);

    if (coins < MIN_COINS_SAFETY) {
      logger.warn({ fsCallId, coins }, "[Orchestrator] Zero balance on answer — disconnecting");
      sendEslCmd(
        `uuid_broadcast ${fsCallId} speak:flite|kal|Your balance is insufficient to make this call. Please top up your account. The call will be disconnected.`,
      );
      setTimeout(() => sendEslCmd(`uuid_kill ${fsCallId} ALLOTTED_TIMEOUT`),
        INSUFFICIENT_BALANCE_VOICE_DELAY);
      return EventResult.DONE;
    }

    const allowedSecs = Math.floor((coins / effectiveRate) * 60);
    const schedHangup = Math.max(5, allowedSecs - 5);
    logger.info({ fsCallId, coins, allowedSecs, schedHangup },
      "[Orchestrator] Scheduling balance-based hangup");

    const callUserId = String(call.userId);
    const timer = setTimeout(async () => {
      hangupTimers.delete(fsCallId);
      // Re-read balance before disconnecting — prevents premature hangup when
      // another concurrent call already deducted coins from a shared snapshot.
      let freshCoins = 0;
      try {
        await connectDB();
        const freshUser = await UserModel.findById(callUserId).select("coins").lean();
        freshCoins = freshUser?.coins ?? 0;
      } catch { /* use 0 on error — safe to hang up */ }

      if (freshCoins >= MIN_COINS_SAFETY) {
        // Balance was topped up or another call ended; reschedule.
        const newAllowed = Math.floor((freshCoins / effectiveRate) * 60);
        const newSched = Math.max(5, newAllowed - 5);
        logger.info({ fsCallId, freshCoins, newSched },
          "[Orchestrator] Balance still sufficient after re-check — rescheduling hangup");
        const newTimer = setTimeout(() => {
          hangupTimers.delete(fsCallId);
          sendEslCmd(
            `uuid_broadcast ${fsCallId} speak:flite|kal|Your balance has been exhausted. The call will be disconnected now.`,
          );
          setTimeout(() => sendEslCmd(`uuid_kill ${fsCallId} ALLOTTED_TIMEOUT`),
            INSUFFICIENT_BALANCE_VOICE_DELAY);
        }, newSched * 1_000);
        hangupTimers.set(fsCallId, newTimer);
        return;
      }

      logger.warn({ fsCallId, freshCoins }, "[Orchestrator] Balance exhausted — announcing and killing call");
      sendEslCmd(
        `uuid_broadcast ${fsCallId} speak:flite|kal|Your balance has been exhausted. The call will be disconnected now.`,
      );
      setTimeout(() => sendEslCmd(`uuid_kill ${fsCallId} ALLOTTED_TIMEOUT`),
        INSUFFICIENT_BALANCE_VOICE_DELAY);
    }, schedHangup * 1_000);

    hangupTimers.set(fsCallId, timer);
  }

  return EventResult.DONE;
}

/**
 * Handle CHANNEL_HANGUP_COMPLETE (ESL path).
 * Transitions to the appropriate terminal state and applies billing.
 *
 * Returns EventResult.RETRY when the DB record doesn't exist yet.
 */
export async function finalizeCall(
  fsCallId: string,
  billsec: number,
  hangupCause: string,
  otherLegId?: string,
): Promise<EventResult> {
  cancelHangupTimer(fsCallId);
  if (otherLegId) cancelHangupTimer(otherLegId);

  // Cancel all watchdogs — call is being finalized by FS regardless of state
  cancelInitiatedTimer(fsCallId);
  if (otherLegId && otherLegId !== fsCallId) cancelInitiatedTimer(otherLegId);
  cancelRingTimer(fsCallId);
  if (otherLegId && otherLegId !== fsCallId) cancelRingTimer(otherLegId);
  cancelMediaWatchdog(fsCallId);
  if (otherLegId && otherLegId !== fsCallId) cancelMediaWatchdog(otherLegId);

  await connectDB();

  let call = await CallModel.findOne({ fsCallId })
    .select(BILLING_FS_PROJECTION)
    .lean();

  // Try other leg if primary not found
  if (!call && otherLegId && otherLegId !== fsCallId) {
    call = await CallModel.findOne({ fsCallId: otherLegId })
      .select(BILLING_FS_PROJECTION)
      .lean();
    if (call) {
      logger.debug({ fsCallId, otherLegId }, "[Orchestrator] finalizeCall resolved via Other-Leg-Unique-ID");
      fsCallId = otherLegId;
    }
  }

  if (!call) return EventResult.RETRY;

  // Already finalised (idempotent)
  if (call.endedAt) {
    logger.debug({ fsCallId }, "[Orchestrator] finalizeCall — already ended, skipping");
    return EventResult.DONE;
  }

  let finalStatus = causeToStatus(hangupCause);
  let allowed: boolean;
  try {
    allowed = isTransitionAllowed(call.status, finalStatus);
  } catch (err: unknown) {
    logger.warn(
      { fsCallId, from: call.status, to: finalStatus, err: (err as Error).message },
      "[Orchestrator] finalizeCall — invalid transition, retrying (state may catch up)",
    );
    return EventResult.RETRY;
  }
  if (!allowed) {
    logger.warn(
      { fsCallId, from: call.status, to: finalStatus },
      "[Orchestrator] finalizeCall — transition not allowed (terminal/corrupt), skipping",
    );
    return EventResult.DONE;
  }

  const safeBillsec = clampBillsec(billsec);

  // ── Fast carrier hangup detection ──────────────────────────────────────────
  // Some carriers send SIP 200 OK (CHANNEL_ANSWER) then immediately BYE the
  // call before any audio is exchanged (billsec = 0).  This maps to
  // causeToStatus → "completed" but is actually a carrier-side rejection.
  //
  // Pattern observed:  CREATE → PROGRESS_MEDIA → ANSWER → HANGUP_COMPLETE
  // with billsec = 0 and hangupCause = NORMAL_CLEARING.
  //
  // Rule: if the call would be "completed"/"ended" but no audio was exchanged
  // (billsec = 0), override the status to "failed" so the UI shows the real
  // outcome instead of a phantom 0-second completed call.
  if ((finalStatus === "completed" || finalStatus === "ended") && safeBillsec === 0) {
    finalStatus = "failed";
    logger.warn(
      { fsCallId, hangupCause, billsec: safeBillsec, prevStatus: call.status },
      "[Orchestrator] Fast carrier hangup detected — ANSWER + immediate DISCONNECT " +
      "with billsec=0; marking FAILED. " +
      "Carrier sent 200 OK then BYE without delivering audio. " +
      "Check SIP response codes and Q.850 cause in CHANNEL_HANGUP_COMPLETE log above.",
    );
  }

  const coinsPerMinute = call.callType === "external"
    ? await resolveCoinsPerMinuteForUser(String(call.userId), String(call.recipientNumber ?? ""))
    : 0;
  const coinsUsed   = call.callType === "external" ? calcCoins(safeBillsec, coinsPerMinute || COINS_PER_MINUTE) : 0;

  const update: Record<string, unknown> = {
    status:      finalStatus,
    duration:    safeBillsec,
    cost:        coinsUsed,
    endedAt:     new Date(),
    hangupCause: hangupCause,
  };
  if (finalStatus !== "completed" && finalStatus !== "ended") {
    update.failReason = finalStatus === "failed" && safeBillsec === 0 && hangupCause === "NORMAL_CLEARING"
      ? "Carrier rejected — answered then immediately disconnected (billsec=0)"
      : causeToLabel(hangupCause);
  }

  const terminalSet = TERMINAL_CALL_STATUSES as unknown as string[];
  const filter = {
    _id:     call._id,
    endedAt: null,
    status:  { $nin: terminalSet },
  };

  const useTxn = process.env.MONGODB_USE_TRANSACTIONS === "true";

  if (useTxn) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const resDocTxn = await CallModel.findOneAndUpdate(filter, { $set: update }, { returnDocument: 'after', session })
        .lean();
      if (resDocTxn) {
        const ledgerId = `call:${String(resDocTxn._id)}`;
        let billed = false;
        if (coinsUsed > 0) {
          try {
            await BillingLedgerModel.create([{
              _id: ledgerId,
              userId: String(resDocTxn.userId),
              callId: String(resDocTxn._id),
              type: "debit",
              coins: coinsUsed,
              reason: "call",
              meta: { fsCallId, billsec: safeBillsec, coinsPerMinute },
            }], { session });
            billed = true;
          } catch (e: any) {
            if (e?.code !== 11000) throw e;
          }
        }
        if (billed) {
          await deductCoinsAndUpdateStats(String(resDocTxn.userId), coinsUsed, String(resDocTxn._id), session);
        } else {
          await deductCoinsAndUpdateStats(String(resDocTxn.userId), 0, String(resDocTxn._id), session);
        }

        const cdrId = `cdr:${String(resDocTxn._id)}`;
        try {
          await CdrModel.create([{
            _id: cdrId,
            callId: String(resDocTxn._id),
            userId: String(resDocTxn.userId),
            fsCallId,
            otherLegId,
            callerNumber: (resDocTxn as any).callerNumber,
            recipientNumber: (resDocTxn as any).recipientNumber,
            direction: (resDocTxn as any).direction,
            callType: (resDocTxn as any).callType,
            status: finalStatus,
            hangupCause,
            billsec: safeBillsec,
            coinsUsed,
            startedAt: (resDocTxn as any).startedAt,
            endedAt: new Date(),
          }], { session });
        } catch (e: any) {
          if (e?.code !== 11000) throw e;
        }
      }
      await session.commitTransaction();
      logger.info(
        { fsCallId, finalStatus, billsec: safeBillsec, coinsUsed, hangupCause },
        "[Orchestrator] Call finalised via ESL (transaction)",
      );
      if (resDocTxn) {
        appendCallEvent({
          callId: String(resDocTxn._id), fsCallId,
          userId: String(resDocTxn.userId), event: "hangup",
          metadata: { hangupCause, billsec: safeBillsec, coinsUsed, finalStatus, path: "txn" },
        }).catch(() => {});
      }
      return EventResult.DONE;
    } catch (err) {
      await session.abortTransaction().catch((abortErr) => {
        logger.warn({ abortErr }, "[Orchestrator] finalizeCall abortTransaction failed");
      });
      logger.warn(
        { err },
        "[Orchestrator] finalizeCall transaction failed — falling back to non-transactional path",
      );
    } finally {
      session.endSession();
    }
  }

  const resDoc = await CallModel.findOneAndUpdate(filter, { $set: update }, { returnDocument: 'after' }).lean();

  if (!resDoc) {
    logger.debug({ fsCallId }, "[Orchestrator] finalizeCall — concurrent finalization won, idempotent skip");
    return EventResult.DONE;
  }

  const ledgerId = `call:${String(resDoc._id)}`;
  let billed = false;
  if (coinsUsed > 0) {
    try {
      await BillingLedgerModel.create({
        _id: ledgerId,
        userId: String(resDoc.userId),
        callId: String(resDoc._id),
        type: "debit",
        coins: coinsUsed,
        reason: "call",
        meta: { fsCallId, billsec: safeBillsec, coinsPerMinute },
      });
      billed = true;
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
    }
  }
  await deductCoinsAndUpdateStats(String(resDoc.userId), billed ? coinsUsed : 0, String(resDoc._id));

  const cdrId = `cdr:${String(resDoc._id)}`;
  try {
    await CdrModel.create({
      _id: cdrId,
      callId: String(resDoc._id),
      userId: String(resDoc.userId),
      fsCallId,
      otherLegId,
      callerNumber: (resDoc as any).callerNumber,
      recipientNumber: (resDoc as any).recipientNumber,
      direction: (resDoc as any).direction,
      callType: (resDoc as any).callType,
      status: finalStatus,
      hangupCause,
      billsec: safeBillsec,
      coinsUsed,
      startedAt: (resDoc as any).startedAt,
      endedAt: new Date(),
    });
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
  }

  if (billed && coinsUsed > 0) {
    await maybeSendLowBalanceAlert(String(resDoc.userId));
  }

  logger.info(
    { fsCallId, finalStatus, billsec: safeBillsec, coinsUsed, hangupCause },
    "[Orchestrator] Call finalised via ESL",
  );
  appendCallEvent({
    callId: String(resDoc._id), fsCallId,
    userId: String(resDoc.userId), event: "hangup",
    metadata: { hangupCause, billsec: safeBillsec, coinsUsed, finalStatus },
  }).catch(() => {});

  // ── Voicemail record creation ───────────────────────────────────────────────
  // When a call ends with ATTENDED_TRANSFER (routed to voicemail), create a
  // Voicemail document so the callee's inbox shows the new message.
  if (finalStatus === "voicemail") {
    metrics.voicemailFallbacks++;
    createVoicemailRecord(resDoc, fsCallId).catch((err) =>
      logger.warn({ err, callId: resDoc._id }, "[Orchestrator] Voicemail record creation failed"),
    );
  }

  return EventResult.DONE;
}

async function createVoicemailRecord(
  call: Record<string, any>,
  fsCallId: string,
): Promise<void> {
  try {
    await connectDB();

    // Resolve the callee userId from the recipientNumber/extension
    const recipientExt = call.recipientNumber
      ? parseInt(String(call.recipientNumber), 10)
      : null;
    const calleeUser = recipientExt
      ? await UserModel.findOne({ extension: recipientExt }).select("_id extension fcmToken expoPushToken").lean()
      : null;

    const vmId = randomUUID();
    await VoicemailModel.create({
      _id:           vmId,
      callId:        String(call._id),
      userId:        String(calleeUser?._id ?? call.userId),
      fromNumber:    call.callerNumber,
      fromExtension: call.callerNumber ? parseInt(String(call.callerNumber), 10) : undefined,
      extension:     recipientExt ?? undefined,
      duration:      0,      // populated when recording is retrieved
      read:          false,
    });

    logger.info({ vmId, callId: call._id, fsCallId }, "[Orchestrator] Voicemail record created");

    appendCallEvent({
      callId:  String(call._id),
      fsCallId,
      userId:  String(calleeUser?._id ?? call.userId),
      event:   "voicemail",
      metadata: { vmId, fromNumber: call.callerNumber },
    }).catch(() => {});

    // Push notification to the callee
    if (calleeUser) {
      const data = {
        type:   "voicemail",
        vmId,
        callId: String(call._id),
      };
      if ((calleeUser as any).fcmToken) {
        sendFcmDataMessage((calleeUser as any).fcmToken, data).catch(() => {});
      }
      if ((calleeUser as any).expoPushToken) {
        sendExpoPush(
          (calleeUser as any).expoPushToken,
          "📬 New Voicemail",
          "You have a new voicemail message",
          data,
        ).catch(() => {});
      }
    }
  } catch (err) {
    logger.error({ err, callId: call._id }, "[Orchestrator] createVoicemailRecord error");
  }
}

/**
 * Handle REST POST /calls/:callId/end (client-reported duration).
 *
 * **External calls:** FreeSWITCH ESL + `finalizeCall` is the only billing authority
 * (`variable_billsec`). This endpoint does not mutate external calls so client
 * timestamps cannot block ESL finalization or enable wallet fraud.
 *
 * **Internal calls:** No coin billing; REST may finalize for UX when ESL is absent.
 */
export async function endCallById(
  callId: string,
  userId: string,
  durationSecs: number,
  requestedStatus?: string,
): Promise<Record<string, unknown>> {
  await connectDB();

  const call = await CallModel.findOne({ _id: callId, userId });
  if (!call) throw Object.assign(new Error("Call not found"), { statusCode: 404 });

  if (call.callType === "external") {
    const existing = await CallModel.findById(callId).lean();
    logger.info(
      { callId, durationSecs, requestedStatus },
      "[Orchestrator] endCallById — external call ignored (ESL/billsec authoritative)",
    );
    return { ...existing, id: existing!._id } as Record<string, unknown>;
  }

  // Idempotent — already ended
  if (call.endedAt) {
    const existing = await CallModel.findById(callId).lean();
    logger.debug({ callId }, "[Orchestrator] endCallById — already ended, returning existing");
    return { ...existing, id: existing!._id } as Record<string, unknown>;
  }

  const rawStatus = requestedStatus ?? "completed";
  const to = (rawStatus === "in-progress" ? "answered" : rawStatus) as CallStatus;

  let allowed: boolean;
  try {
    allowed = isTransitionAllowed(call.status, to);
  } catch {
    allowed = false;
  }

  if (!allowed) {
    const existing = await CallModel.findById(callId).lean();
    return { ...existing, id: existing!._id } as Record<string, unknown>;
  }

  const safeDuration = clampBillsec(durationSecs);

  const restUpdate: Record<string, unknown> = {
    status:   to,
    duration: safeDuration,
    cost:     0,
    endedAt:  new Date(),
  };

  if (to !== "completed" && to !== "ended") {
    const reasonMap: Record<string, string> = {
      missed:    "No answer",
      cancelled: "Call cancelled",
      failed:    "Call failed",
      rejected:  "Call rejected",
      voicemail: "Went to voicemail",
    };
    restUpdate.failReason = reasonMap[to] ?? "Call ended";
  }

  const terminalSet = TERMINAL_CALL_STATUSES as unknown as string[];
  const updated = await CallModel.findOneAndUpdate(
    {
      _id:     callId,
      userId,
      endedAt: null,
      status:  { $nin: terminalSet },
    },
    { $set: restUpdate },
    { returnDocument: 'after' },
  ).lean();

  if (!updated) {
    const existing = await CallModel.findById(callId).lean();
    logger.debug({ callId }, "[Orchestrator] endCallById — concurrent finalize, returning current");
    return { ...existing, id: existing!._id } as Record<string, unknown>;
  }

  await deductCoinsAndUpdateStats(String(call.userId), 0, callId);

  logger.info({ callId, to, durationSecs: safeDuration }, "[Orchestrator] Internal call ended via REST");
  return { ...updated, id: updated._id } as Record<string, unknown>;
}

/**
 * Handle the legacy FreeSWITCH webhook (POST /calls/webhook/freeswitch).
 * This is a secondary code-path kept for compatibility; the ESL path is authoritative.
 */
export async function webhookUpdate(
  event: string,
  callId: string,
  userId: string,
  durationSecs: number,
  status?: string,
): Promise<void> {
  await connectDB();
  const call = await CallModel.findOne({ _id: callId, userId });
  if (!call) return;

  if (event === "CHANNEL_ANSWER") {
    let allowed = false;
    try {
      allowed = isTransitionAllowed(call.status, "answered");
    } catch {
      /* invalid transition */
    }
    if (!allowed) return;

    const fromStatus = call.status;
    const updated = await CallModel.findOneAndUpdate(
      { _id: callId, userId, endedAt: null, status: fromStatus },
      { $set: { status: "answered", startedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean();
    if (!updated) {
      logger.debug(
        { callId },
        "[Orchestrator] webhook CHANNEL_ANSWER — lost race or stale state",
      );
    }
    return;
  }

  if (event === "CHANNEL_HANGUP" || event === "CHANNEL_HANGUP_COMPLETE") {
    if (call.callType === "external") {
      logger.debug({ callId }, "[Orchestrator] webhook hangup ignored for external (ESL path bills)");
      return;
    }
    if (call.endedAt) return;

    const rawStatus = status ?? "completed";
    const to = (rawStatus === "in-progress" ? "answered" : rawStatus) as CallStatus;

    let allowed = false;
    try { allowed = isTransitionAllowed(call.status, to); } catch { /* invalid */ }
    if (!allowed) return;

    const safeDuration = clampBillsec(durationSecs);
    const terminalSet  = TERMINAL_CALL_STATUSES as unknown as string[];
    const updated = await CallModel.findOneAndUpdate(
      {
        _id:     callId,
        endedAt: null,
        status:  { $nin: terminalSet },
      },
      {
        $set: {
          status:   to,
          duration: safeDuration,
          cost:     0,
          endedAt:  new Date(),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    if (updated) {
      await deductCoinsAndUpdateStats(userId, 0, callId);
    }
  }
}
