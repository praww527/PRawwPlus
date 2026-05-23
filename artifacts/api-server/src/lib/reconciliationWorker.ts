/**
 * Periodic reconciliation: replay persisted ESL events and close stale call rows.
 */

import { connectDB, PendingEslEventModel, CallModel } from "@workspace/db";
import { logger } from "./logger";
import { finalizeCall, answerCall, ringingCall } from "./callOrchestrator";
import { EventResult } from "./eslEventBuffer";

const STALE_INITIATED_MS    = 30_000;            // 30 s — watchdog is 20 s; give a 10 s buffer
const STALE_NON_TERMINAL_MS = 15 * 60 * 1000;   // 15 min for ringing/other non-terminal
/** Longer than MAX_BILLSEC_PER_CALL (24h cap) so legitimate calls are not clipped */
const STALE_ANSWERED_MS     = 26 * 60 * 60 * 1000;
const MAX_PENDING_ATTEMPTS  = 100;

export async function countPendingEslEvents(): Promise<number> {
  await connectDB();
  return PendingEslEventModel.countDocuments({ status: "pending" });
}

async function processPendingEslBatch(): Promise<void> {
  await connectDB();
  const batch = await PendingEslEventModel.find({
    status:   "pending",
    attempts: { $lt: MAX_PENDING_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(30)
    .lean();

  for (const doc of batch) {
    const p = doc.payload ?? {};
    try {
      let result: EventResult;

      if (doc.label === "CHANNEL_HANGUP_COMPLETE") {
        result = await finalizeCall(
          doc.fsCallId,
          Number(p.billsec) || 0,
          String(p.hangupCause ?? ""),
          p.otherLegId ? String(p.otherLegId) : undefined,
        );
      } else if (doc.label === "CHANNEL_ANSWER") {
        result = await answerCall(
          doc.fsCallId,
          p.otherLegId ? String(p.otherLegId) : undefined,
        );
      } else if (doc.label === "CHANNEL_ORIGINATE") {
        const aLeg = String(p.aLegUuid ?? doc.fsCallId);
        const bLeg = String(p.bLegUuid ?? "");
        result = await ringingCall(aLeg, bLeg);
      } else {
        await PendingEslEventModel.updateOne(
          { _id: doc._id },
          { $set: { status: "dead", lastError: "unknown label" } },
        );
        continue;
      }

      const nextAttempts = (doc.attempts ?? 0) + 1;

      if (result === EventResult.DONE) {
        await PendingEslEventModel.updateOne(
          { _id: doc._id },
          { $set: { status: "processed", attempts: nextAttempts } },
        );
      } else if (nextAttempts >= MAX_PENDING_ATTEMPTS) {
        await PendingEslEventModel.updateOne(
          { _id: doc._id },
          {
            $set: {
              status:    "dead",
              attempts:  nextAttempts,
              lastError: "max reconciliation attempts",
            },
          },
        );
        logger.error(
          { id: doc._id, fsCallId: doc.fsCallId, label: doc.label },
          "[Reconcile] Pending ESL event marked dead after max attempts",
        );
      } else {
        await PendingEslEventModel.updateOne(
          { _id: doc._id },
          {
            $set: { attempts: nextAttempts, lastError: "retry" },
          },
        );
      }
    } catch (err) {
      const nextAttempts = (doc.attempts ?? 0) + 1;
      await PendingEslEventModel.updateOne(
        { _id: doc._id },
        {
          $set: {
            attempts:  nextAttempts,
            lastError: String((err as Error)?.message ?? err),
            ...(nextAttempts >= MAX_PENDING_ATTEMPTS
              ? { status: "dead" as const }
              : {}),
          },
        },
      );
      logger.error(
        { err, id: doc._id, fsCallId: doc.fsCallId },
        "[Reconcile] Pending ESL replay error",
      );
    }
  }
}

async function closeStaleCalls(): Promise<void> {
  await connectDB();
  const now            = Date.now();
  const initiatedCutoff = new Date(now - STALE_INITIATED_MS);   // 30 s
  const ringingCutoff   = new Date(now - STALE_NON_TERMINAL_MS); // 15 min
  const answeredCutoff  = new Date(now - STALE_ANSWERED_MS);

  // "initiated" calls are swept fast (30 s) — the in-memory watchdog fires at
  // 20 s so anything still here is an orphan (e.g. from a server restart that
  // cleared the timers).
  const [rInitiated, rRing, rAnswered] = await Promise.all([
    CallModel.updateMany(
      {
        endedAt:   null,
        status:    "initiated",
        createdAt: { $lt: initiatedCutoff },
      },
      {
        $set: {
          status:      "failed",
          endedAt:     new Date(),
          failReason:  "Call not connected — no FreeSWITCH activity within 30 s (reconciliation safety net)",
          hangupCause: "USER_NOT_REGISTERED",
          duration:    0,
          cost:        0,
        },
      },
    ),
    CallModel.updateMany(
      {
        endedAt:   null,
        status:    "ringing",
        createdAt: { $lt: ringingCutoff },
      },
      {
        $set: {
          status:      "failed",
          endedAt:     new Date(),
          failReason:  "Stale call — no FreeSWITCH hangup received within 15 min (reconciliation safety net)",
          hangupCause: "RECOVERY_ON_TIMER_EXPIRE",
          duration:    0,
          cost:        0,
        },
      },
    ),
    CallModel.updateMany(
      {
        endedAt:   null,
        status:    "answered",
        startedAt: { $lt: answeredCutoff },
      },
      {
        $set: {
          status:      "failed",
          endedAt:     new Date(),
          failReason:  "Stale answered call — no FreeSWITCH hangup event received within 26 h (reconciliation safety net)",
          hangupCause: "RECOVERY_ON_TIMER_EXPIRE",
          duration:    0,
          cost:        0,
        },
      },
    ),
  ]);

  if (rInitiated.modifiedCount > 0) {
    logger.warn({ count: rInitiated.modifiedCount }, "[Reconcile] Closed stale initiated calls (orphaned watchdog — likely a server restart)");
  }
  if (rRing.modifiedCount > 0) {
    logger.info({ count: rRing.modifiedCount }, "[Reconcile] Closed stale ringing calls");
  }
  if (rAnswered.modifiedCount > 0) {
    logger.warn(
      { count: rAnswered.modifiedCount },
      "[Reconcile] Closed stale answered calls — verify ESL / pending hangup reconciliation",
    );
  }
}

export async function runReconciliationCycle(): Promise<void> {
  await processPendingEslBatch();
  await closeStaleCalls();
}

export function startReconciliationWorker(): void {
  const raw = process.env.RECONCILIATION_INTERVAL_MS ?? "60000";
  const ms    = Math.max(10_000, parseInt(raw, 10) || 60_000);

  const tick = () => {
    runReconciliationCycle().catch((err) =>
      logger.error({ err }, "[Reconcile] cycle failed"),
    );
  };

  setInterval(tick, ms);
  setImmediate(tick);
  logger.info({ intervalMs: ms }, "[Reconcile] worker scheduled");
}
