/**
 * Periodic reconciliation: replay persisted ESL events and close stale call rows.
 */

import { connectDB, PendingEslEventModel, CallModel } from "@workspace/db";
import { logger } from "./logger";
import { finalizeCall, answerCall, ringingCall } from "./callOrchestrator";
import { EventResult, eslBufferDepth } from "./eslEventBuffer";
import { eslStatus } from "./freeswitchESL";
import { pushHealthSample } from "./healthRingBuffer";
import { getProcessMetrics } from "./processMetrics";
import { metrics } from "./metrics";

const STALE_INITIATED_MS    = 30_000;            // 30 s — watchdog is 20 s; give a 10 s buffer
const STALE_NON_TERMINAL_MS = 15 * 60 * 1000;   // 15 min for ringing/early_media
/** Longer than MAX_BILLSEC_PER_CALL (24h cap) so legitimate calls are not clipped */
const STALE_ANSWERED_MS     = 26 * 60 * 60 * 1000;
/** Same threshold as answered — bridged calls are billable and should not be clipped early */
const STALE_BRIDGED_MS      = 26 * 60 * 60 * 1000;
const MAX_PENDING_ATTEMPTS  = 100;

// ── Reconciliation stats (observable via /api/admin/platform-health) ──────────

export interface ReconciliationStats {
  cycles:       number;
  lastRanAt:    number | null;
  lastStale: {
    initiated: number;
    ringing:   number;
    answered:  number;
    bridged:   number;
  };
  lastPending:  number;
}

const reconciliationStats: ReconciliationStats = {
  cycles:    0,
  lastRanAt: null,
  lastStale: { initiated: 0, ringing: 0, answered: 0, bridged: 0 },
  lastPending: 0,
};

export function getReconciliationStats(): ReconciliationStats {
  return { ...reconciliationStats, lastStale: { ...reconciliationStats.lastStale } };
}

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
  const bridgedCutoff   = new Date(now - STALE_BRIDGED_MS);

  // "initiated" calls are swept fast (30 s) — the in-memory watchdog fires at
  // 20 s so anything still here is an orphan (e.g. from a server restart that
  // cleared the timers).
  const [rInitiated, rRing, rAnswered, rBridged] = await Promise.all([
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
    // "bridged" — two-way audio was established but CHANNEL_HANGUP_COMPLETE
    // was never processed. Same 26 h threshold as "answered" to avoid clipping
    // legitimate long calls while still catching truly stuck records.
    CallModel.updateMany(
      {
        endedAt:   null,
        status:    "bridged",
        startedAt: { $lt: bridgedCutoff },
      },
      {
        $set: {
          status:      "failed",
          endedAt:     new Date(),
          failReason:  "Stale bridged call — no FreeSWITCH hangup event received within 26 h (reconciliation safety net)",
          hangupCause: "RECOVERY_ON_TIMER_EXPIRE",
          duration:    0,
          cost:        0,
        },
      },
    ),
  ]);

  // Persist stale counts into observable stats
  reconciliationStats.lastStale.initiated = rInitiated.modifiedCount;
  reconciliationStats.lastStale.ringing   = rRing.modifiedCount;
  reconciliationStats.lastStale.answered  = rAnswered.modifiedCount;
  reconciliationStats.lastStale.bridged   = rBridged.modifiedCount;

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
  if (rBridged.modifiedCount > 0) {
    logger.warn(
      { count: rBridged.modifiedCount },
      "[Reconcile] Closed stale bridged calls — CHANNEL_HANGUP_COMPLETE was never processed; verify ESL subscription",
    );
  }
}

export async function runReconciliationCycle(): Promise<void> {
  const pendingBefore = await countPendingEslEvents().catch(() => 0);
  await processPendingEslBatch();
  await closeStaleCalls();
  reconciliationStats.cycles++;
  reconciliationStats.lastRanAt = Date.now();
  reconciliationStats.lastPending = pendingBefore;

  // Push a sample into the health ring buffer for sparkline display
  const esl = eslStatus();
  const staleTotal =
    reconciliationStats.lastStale.initiated +
    reconciliationStats.lastStale.ringing  +
    reconciliationStats.lastStale.answered +
    reconciliationStats.lastStale.bridged;

  const proc = getProcessMetrics();
  const snap = metrics.snapshot();
  pushHealthSample({
    ts:             Date.now(),
    eslConnected:   esl.connected,
    bufferDepth:    eslBufferDepth(),
    staleTotal,
    pendingCount:   pendingBefore,
    heapUsedMb:     proc.heapUsedMb,
    rssMb:          proc.rssMb,
    loopLagMs:      proc.loopLagMs,
    activeCalls:    snap.activeCalls,
    wsVertoClients: snap.activeVertoClients,
  });
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
