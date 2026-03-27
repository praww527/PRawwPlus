/**
 * CallOrchestrator — single source of truth for call lifecycle logic.
 *
 * Previously, billing, state updates, and timer management were duplicated
 * across three places:
 *   • freeswitchESL.ts  (handleAnswer / handleHangup)
 *   • routes/calls.ts   (POST /calls/:callId/end)
 *   • routes/calls.ts   (POST /calls/webhook/freeswitch)
 *
 * This service owns all of that. Callers provide raw event data; the
 * orchestrator validates state transitions, deducts coins, and updates the DB.
 *
 * Public API:
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
 * Returns the updated document, or null if the transition is not allowed
 * (already in a terminal state — silently idempotent).
 * Throws if the transition is explicitly invalid.
 */
async function transitionCallStatus(
  fsCallId: string,
  to: CallStatus,
  update: Record<string, unknown>,
): Promise<{ callId: string; userId: string; callType: string } | null> {
  await connectDB();
  const call = await CallModel.findOne({ fsCallId });
  if (!call) return null;           // caller will decide if this is RETRY or DONE

  const allowed = isTransitionAllowed(call.status, to);
  if (!allowed) {
    // Terminal state — already processed, idempotent
    logger.debug({ fsCallId, from: call.status, to },
      "[Orchestrator] Skipping — call already in terminal state");
    return { callId: String(call._id), userId: String(call.userId), callType: call.callType };
  }

  await CallModel.updateOne({ _id: call._id }, { status: to, ...update });
  logger.info({ fsCallId, from: call.status, to }, "[Orchestrator] State transition applied");
  return { callId: String(call._id), userId: String(call.userId), callType: call.callType };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Handle CHANNEL_ANSWER: transition initiated → in-progress and, for external
 * calls, schedule a balance-exhaustion hangup.
 *
 * Returns EventResult.RETRY when the DB record doesn't exist yet (buffer will retry).
 */
export async function answerCall(fsCallId: string): Promise<EventResult> {
  await connectDB();
  const call = await CallModel.findOne({ fsCallId })
    .select("status callType userId endedAt")
    .lean();

  if (!call) return EventResult.RETRY;

  const result = await transitionCallStatus(fsCallId, "in-progress", { startedAt: new Date() });
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
): Promise<EventResult> {
  cancelHangupTimer(fsCallId);

  await connectDB();
  const call = await CallModel.findOne({ fsCallId })
    .select("status callType userId endedAt _id")
    .lean();

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

  const to = (requestedStatus ?? "completed") as CallStatus;
  const allowed = isTransitionAllowed(call.status, to);
  if (!allowed) {
    const existing = await CallModel.findById(callId).lean();
    return { ...existing, id: existing!._id } as Record<string, unknown>;
  }

  const coinsUsed = call.callType === "external" ? calcCoins(durationSecs) : 0;

  await CallModel.updateOne(
    { _id: callId },
    { status: to, duration: durationSecs, cost: coinsUsed, endedAt: new Date() },
  );

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
    if (isTransitionAllowed(call.status, "in-progress")) {
      await CallModel.updateOne({ _id: callId }, { status: "in-progress", startedAt: new Date() });
    }
    return;
  }

  if (event === "CHANNEL_HANGUP" || event === "CHANNEL_HANGUP_COMPLETE") {
    if (call.endedAt) return;       // idempotent

    const to = (status ?? "completed") as CallStatus;
    if (!isTransitionAllowed(call.status, to)) return;

    const coinsUsed = call.callType === "external" ? calcCoins(durationSecs) : 0;

    await CallModel.updateOne(
      { _id: callId },
      { status: to, duration: durationSecs, cost: coinsUsed, endedAt: new Date() },
    );
    await deductCoinsAndUpdateStats(userId, coinsUsed, callId);
  }
}
