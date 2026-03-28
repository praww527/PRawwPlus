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
 *   endCallById(callId, userId, duration)    — REST /calls/:id/end (client-reported)
 *   cancelHangupTimer(fsCallId)              — call ended early; cancel balance timer
 */

import { connectDB, CallModel, UserModel } from "@workspace/db";
import { logger } from "./logger";
import { isTransitionAllowed, causeToStatus, causeToLabel, type CallStatus } from "./callStateMachine";
import { EventResult } from "./eslEventBuffer";

const COINS_PER_MINUTE = 1;
const MIN_COINS_SAFETY = 0.1;
const INSUFFICIENT_BALANCE_VOICE_DELAY = 9_000;

/** Injected at startup so the orchestrator can issue FreeSWITCH commands
 *  without a circular import with freeswitchESL.ts */
let eslCommandFn: ((cmd: string) => void) | null = null;

export function setEslCommandFn(fn: (cmd: string) => void) {
  eslCommandFn = fn;
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
}

// ─── Billing helpers ───────────────────────────────────────────────────────

function calcCoins(billsec: number): number {
  return billsec > 0 ? Math.ceil((billsec / 60) * COINS_PER_MINUTE) : 0;
}

async function deductCoinsAndUpdateStats(
  userId: string,
  coinsUsed: number,
  callId: string,
): Promise<void> {
  if (coinsUsed > 0) {
    await UserModel.updateOne({ _id: userId }, [
      {
        $set: {
          coins:          { $max: [0, { $subtract: ["$coins", coinsUsed] }] },
          totalCallsUsed: { $add: ["$totalCallsUsed", 1] },
          totalCoinsUsed: { $add: ["$totalCoinsUsed", coinsUsed] },
        },
      },
    ]);
  } else {
    await UserModel.updateOne({ _id: userId }, { $inc: { totalCallsUsed: 1 } });
  }
  logger.info({ callId, userId, coinsUsed }, "[Orchestrator] Billing applied");
}

// ─── State-gated DB write ─────────────────────────────────────────────────


/**
 * Atomically transition a call's status field in MongoDB.
 * Returns the updated document metadata, or null if the transition is not allowed
 * (already in a terminal state — silently idempotent).
 * Throws if the transition is explicitly invalid.
 */
async function transitionCallStatus(
  fsCallId: string,
  to: CallStatus,
  update: Record<string, unknown>,
  otherLegId?: string,
): Promise<{ callId: string; userId: string; callType: string } | null> {
  await connectDB();
  let call = await CallModel.findOne({ fsCallId });
  if (!call && otherLegId && otherLegId !== fsCallId) {
    call = await CallModel.findOne({ fsCallId: otherLegId });
    if (call) {
      logger.debug({ fsCallId, otherLegId }, "[Orchestrator] Resolved call via Other-Leg-Unique-ID");
    }
  }
  if (!call) return null;

  let allowed: boolean;
  try {
    allowed = isTransitionAllowed(call.status, to);
  } catch (err: unknown) {
    logger.warn({ fsCallId, from: call.status, to, err: (err as Error).message },
      "[Orchestrator] Invalid state transition — skipping");
    return { callId: String(call._id), userId: String(call.userId), callType: call.callType };
  }

  if (!allowed) {
    logger.warn({ fsCallId, from: call.status, to },
      "[Orchestrator] Skipping state transition — call already in terminal state");
    return { callId: String(call._id), userId: String(call.userId), callType: call.callType };
  }

  await CallModel.updateOne({ _id: call._id }, { status: to, ...update });
  logger.info({ fsCallId, from: call.status, to }, "[Orchestrator] State transition applied");
  return { callId: String(call._id), userId: String(call.userId), callType: call.callType };
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

  logger.info({ aLegUuid, bLegUuid }, "[Orchestrator] Call marked ringing");
  return EventResult.DONE;
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

  // Already answered or in terminal state
  if (call.status === "answered" || call.endedAt) {
    logger.debug({ fsCallId }, "[Orchestrator] answerCall — already answered, skipping");
    return EventResult.DONE;
  }

  const result = await transitionCallStatus(fsCallId, "answered", { startedAt: new Date() });
  if (!result) return EventResult.RETRY;

  // Mid-call balance enforcement for external calls
  if (call.callType === "external") {
    const user = await UserModel.findById(call.userId).select("coins").lean();
    const coins = user?.coins ?? 0;

    if (coins < MIN_COINS_SAFETY) {
      logger.warn({ fsCallId, coins }, "[Orchestrator] Zero balance on answer — disconnecting");
      sendEslCmd(
        `uuid_broadcast ${fsCallId} speak:flite|kal|Your balance is insufficient to make this call. Please top up your account. The call will be disconnected.`,
      );
      setTimeout(() => sendEslCmd(`uuid_kill ${fsCallId} ALLOTTED_TIMEOUT`),
        INSUFFICIENT_BALANCE_VOICE_DELAY);
      return EventResult.DONE;
    }

    const allowedSecs = Math.floor((coins / COINS_PER_MINUTE) * 60);
    const schedHangup = Math.max(5, allowedSecs - 5);
    logger.info({ fsCallId, coins, allowedSecs, schedHangup },
      "[Orchestrator] Scheduling balance-based hangup");

    const timer = setTimeout(() => {
      hangupTimers.delete(fsCallId);
      logger.warn({ fsCallId }, "[Orchestrator] Balance exhausted — announcing and killing call");
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

  await connectDB();

  let call = await CallModel.findOne({ fsCallId })
    .select("status callType userId endedAt _id")
    .lean();

  // Try other leg if primary not found
  if (!call && otherLegId && otherLegId !== fsCallId) {
    call = await CallModel.findOne({ fsCallId: otherLegId })
      .select("status callType userId endedAt _id")
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

  const finalStatus = causeToStatus(hangupCause);
  const coinsUsed = call.callType === "external" ? calcCoins(billsec) : 0;

  const update: Record<string, unknown> = {
    duration: billsec,
    cost:     coinsUsed,
    endedAt:  new Date(),
  };
  if (finalStatus !== "completed") {
    update.failReason = causeToLabel(hangupCause);
  }

  const result = await transitionCallStatus(fsCallId, finalStatus, update);

  if (!result) return EventResult.RETRY;

  await deductCoinsAndUpdateStats(result.userId, coinsUsed, result.callId);

  logger.info({ fsCallId, finalStatus, billsec, coinsUsed, hangupCause },
    "[Orchestrator] Call finalised via ESL");
  return EventResult.DONE;
}

/**
 * Handle REST POST /calls/:callId/end (client-reported duration).
 * Returns the updated call document, or throws on invalid transition.
 * Idempotent: if already ended, returns the existing record immediately.
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

  // Idempotent — already ended (ESL may have got there first)
  if (call.endedAt) {
    const existing = await CallModel.findById(callId).lean();
    logger.debug({ callId }, "[Orchestrator] endCallById — already ended, returning existing");
    return { ...existing, id: existing!._id } as Record<string, unknown>;
  }

  // Normalise incoming status: accept both legacy "in-progress"/"completed" and new "answered"
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

  const coinsUsed = call.callType === "external" ? calcCoins(durationSecs) : 0;

  const restUpdate: Record<string, unknown> = {
    status:   to,
    duration: durationSecs,
    cost:     coinsUsed,
    endedAt:  new Date(),
  };

  if (to !== "completed") {
    const reasonMap: Record<string, string> = {
      missed:    "No answer",
      cancelled: "Call cancelled",
      failed:    "Call failed",
    };
    restUpdate.failReason = reasonMap[to] ?? "Call ended";
  }

  await CallModel.updateOne({ _id: callId }, restUpdate);

  await deductCoinsAndUpdateStats(String(call.userId), coinsUsed, callId);

  const updated = await CallModel.findById(callId).lean();
  logger.info({ callId, to, durationSecs, coinsUsed }, "[Orchestrator] Call ended via REST");
  return { ...updated, id: updated!._id } as Record<string, unknown>;
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
    try {
      if (isTransitionAllowed(call.status, "answered")) {
        await CallModel.updateOne({ _id: callId }, { status: "answered", startedAt: new Date() });
      }
    } catch { /* invalid transition — ignore */ }
    return;
  }

  if (event === "CHANNEL_HANGUP" || event === "CHANNEL_HANGUP_COMPLETE") {
    if (call.endedAt) return;

    const rawStatus = status ?? "completed";
    const to = (rawStatus === "in-progress" ? "answered" : rawStatus) as CallStatus;

    let allowed = false;
    try { allowed = isTransitionAllowed(call.status, to); } catch { /* invalid */ }
    if (!allowed) return;

    const coinsUsed = call.callType === "external" ? calcCoins(durationSecs) : 0;

    await CallModel.updateOne(
      { _id: callId },
      { status: to, duration: durationSecs, cost: coinsUsed, endedAt: new Date() },
    );
    await deductCoinsAndUpdateStats(userId, coinsUsed, callId);
  }
}
