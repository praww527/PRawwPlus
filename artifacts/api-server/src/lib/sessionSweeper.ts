/**
 * Session sweeper — periodic background task that removes stale state.
 *
 * Runs every SWEEP_INTERVAL_MS (default 30 s) and:
 *   1. Removes Verto sessions whose last ping exceeds SESSION_MAX_AGE_MS (default 45 s)
 *   2. Kills orphaned DB calls stuck in initiated/ringing for > ZOMBIE_CALL_AGE_MS (default 5 min)
 *   3. Increments metrics counters for observability
 *
 * This is a safety net — normal session lifecycle is managed by vertoProxy.ts
 * and callOrchestrator.ts. The sweeper catches anything that slipped through
 * (server crash, ESL drop, network partition, etc.).
 */

import { connectDB, CallModel } from "@workspace/db";
import { getAllSessions, unregisterVertoSession, getAllSipSessions, unregisterSipSession } from "./callSession";
import { metrics } from "./metrics";
import { logger } from "./logger";
import { appendCallEvent } from "./callEventLog";

const SWEEP_INTERVAL_MS  = parseInt(process.env.SWEEP_INTERVAL_MS  ?? "30000",  10);
const SESSION_MAX_AGE_MS = parseInt(process.env.SESSION_MAX_AGE_MS ?? "45000",  10);
const ZOMBIE_CALL_AGE_MS = parseInt(process.env.ZOMBIE_CALL_AGE_MS ?? "300000", 10); // 5 min

let sweepTimer: ReturnType<typeof setInterval> | null = null;

// ── ESL command injection (avoids circular import) ───────────────────────────
let eslCommandFn: ((cmd: string) => void) | null = null;

export function setSweepEslCommandFn(fn: (cmd: string) => void): void {
  eslCommandFn = fn;
}

function sendEslCmd(cmd: string): void {
  if (eslCommandFn) {
    eslCommandFn(cmd);
  } else {
    logger.warn({ cmd }, "[Sweeper] ESL command fn not set — command dropped");
  }
}

// ── Stale Verto session cleanup ───────────────────────────────────────────────

function sweepStaleSessions(): number {
  const now = Date.now();
  const sessions = getAllSessions();
  let cleaned = 0;

  for (const s of sessions) {
    const age = now - s.lastPingAt;
    if (age > SESSION_MAX_AGE_MS) {
      unregisterVertoSession(s.extension, s.sessId);
      cleaned++;
      logger.info(
        { extension: s.extension, sessId: s.sessId, ageMs: age, maxAgeMs: SESSION_MAX_AGE_MS },
        "[Sweeper] Removed stale Verto session",
      );
    }
  }

  return cleaned;
}

// ── Expired SIP session cleanup ───────────────────────────────────────────────
// SIP registrations have a hard expiry (expiresAt). If the UA stopped sending
// re-REGISTERs (e.g. mobile app killed, network dropped without a REGISTER/0),
// the session stays in the map past its expiry and isExtensionOnline() returns
// false for it — but it still occupies memory and pollutes the SIP session count.
// Sweep them periodically so the in-memory table reflects only live registrations.

const SIP_EXPIRED_GRACE_MS = parseInt(
  process.env.SIP_EXPIRED_GRACE_MS ?? "120000", // 2 min grace after expiry
  10,
);

function sweepExpiredSipSessions(): number {
  const now = Date.now();
  const sessions = getAllSipSessions();
  let cleaned = 0;

  for (const s of sessions) {
    if (s.expiresAt < now - SIP_EXPIRED_GRACE_MS) {
      unregisterSipSession(s.extension);
      cleaned++;
      logger.info(
        {
          extension: s.extension,
          expiresAt: new Date(s.expiresAt).toISOString(),
          expiredMsAgo: now - s.expiresAt,
        },
        "[Sweeper] Removed expired SIP registration (orphaned — no re-REGISTER received)",
      );
    }
  }

  return cleaned;
}

// ── Zombie call cleanup ───────────────────────────────────────────────────────

async function sweepZombieCalls(): Promise<number> {
  try {
    await connectDB();

    const cutoff = new Date(Date.now() - ZOMBIE_CALL_AGE_MS);
    // Also sweep answered/bridged calls stuck longer than 2× the zombie threshold —
    // these can occur when FreeSWITCH drops without sending CHANNEL_HANGUP_COMPLETE
    // (e.g. crash, network partition) and the ESL reconnect missed the event.
    const bridgeCutoff = new Date(Date.now() - Math.max(ZOMBIE_CALL_AGE_MS * 2, 600_000));
    const zombies = await CallModel.find({
      $or: [
        { status: { $in: ["initiated", "ringing"] }, startedAt: { $lt: cutoff } },
        { status: { $in: ["answered", "bridged"]  }, startedAt: { $lt: bridgeCutoff } },
      ],
      endedAt: null,
    })
      .select("_id userId fsCallId status startedAt")
      .lean();

    if (zombies.length === 0) return 0;

    logger.warn(
      { count: zombies.length, cutoff: cutoff.toISOString(), zombieCallAgeMs: ZOMBIE_CALL_AGE_MS },
      "[Sweeper] Found zombie calls — killing and marking failed",
    );

    for (const z of zombies) {
      const ageMs = Date.now() - z.startedAt!.getTime();

      // Tell FreeSWITCH to kill the channel if we have a UUID
      if (z.fsCallId) {
        sendEslCmd(`uuid_kill ${z.fsCallId} RECOVERY_ON_TIMER_EXPIRE`);
      }

      // Mark failed in DB (CAS on status so we don't step on a concurrent finalize)
      await CallModel.findOneAndUpdate(
        { _id: z._id, status: z.status, endedAt: null },
        {
          $set: {
            status:      "failed",
            endedAt:     new Date(),
            failReason:  `Zombie call swept after ${Math.round(ageMs / 1000)} s — no ESL activity`,
            hangupCause: "RECOVERY_ON_TIMER_EXPIRE",
            duration:    0,
            cost:        0,
          },
        },
      );

      // Append a trace event so the admin timeline shows what happened
      appendCallEvent({
        callId:   String(z._id),
        fsCallId: z.fsCallId,
        userId:   String(z.userId),
        event:    "custom",
        metadata: { type: "stale_sweep", ageMs, prevStatus: z.status },
      }).catch(() => {});

      logger.info(
        { callId: z._id, fsCallId: z.fsCallId, prevStatus: z.status, ageMs },
        "[Sweeper] Zombie call marked failed",
      );
    }

    return zombies.length;
  } catch (err) {
    logger.error({ err }, "[Sweeper] Error during zombie call sweep");
    return 0;
  }
}

// ── Main sweep cycle ──────────────────────────────────────────────────────────

async function runSweep(): Promise<void> {
  metrics.staleSweepRuns++;

  const sessionsCleaned    = sweepStaleSessions();
  const sipSessionsCleaned = sweepExpiredSipSessions();
  const zombiesKilled      = await sweepZombieCalls();

  metrics.staleSessionCleanups += sessionsCleaned + sipSessionsCleaned;
  metrics.zombieCallsKilled    += zombiesKilled;

  const totalCleaned = sessionsCleaned + sipSessionsCleaned + zombiesKilled;
  if (totalCleaned > 0) {
    logger.info(
      { sessionsCleaned, sipSessionsCleaned, zombiesKilled, sweepRun: metrics.staleSweepRuns },
      "[Sweeper] Sweep complete",
    );
  } else {
    logger.debug({ sweepRun: metrics.staleSweepRuns }, "[Sweeper] Sweep complete — nothing to clean");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startSessionSweeper(): void {
  if (sweepTimer) return; // already running

  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, sessionMaxAgeMs: SESSION_MAX_AGE_MS, zombieCallAgeMs: ZOMBIE_CALL_AGE_MS },
    "[Sweeper] Starting stale session sweeper",
  );

  // Run once immediately on start to catch anything left from a prior crash
  runSweep().catch((err) => logger.error({ err }, "[Sweeper] Initial sweep error"));

  sweepTimer = setInterval(() => {
    runSweep().catch((err) => logger.error({ err }, "[Sweeper] Periodic sweep error"));
  }, SWEEP_INTERVAL_MS);

  sweepTimer.unref(); // don't prevent Node.js from exiting
}

export function stopSessionSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
    logger.info("[Sweeper] Stopped");
  }
}
