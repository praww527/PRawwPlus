/**
 * Server startup routine
 *
 * Runs once when the API server boots:
 *   1. Connects to MongoDB (reads MONGODB_URI or MONGO_URI)
 *   2. Finds every user that doesn't have a FreeSWITCH extension yet
 *   3. Assigns sequential extensions (starting at 1000) + random passwords
 *   4. Logs a clean summary so you can see what happened in the console
 */

import crypto from "crypto";
import { connectDB, UserModel, CallModel } from "@workspace/db";
import { logger } from "./logger";
import { startESL, sendEslBgapiAwait, sendEslApiCommand } from "./freeswitchESL";
import { pushFreeSwitchConfig } from "./freeswitchSSH";
import { startReconciliationWorker } from "./reconciliationWorker";
import { startSessionSweeper, setSweepEslCommandFn } from "./sessionSweeper";
import { setMediaWatchdogEsl } from "./mediaWatchdog";
import { setSofiaRescanFn } from "./extension";
import { cleanExpiredSipSessions } from "./callSession";

const EXTENSION_START = 1001;
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateSipPassword(): string {
  const bytes = crypto.randomBytes(12);
  let pw = "";
  for (let i = 0; i < 12; i++) pw += ALNUM[bytes[i] % ALNUM.length];
  return pw;
}

// ── Environment validation ───────────────────────────────────────────────────
// Called once at startup. Warns on missing/weak settings so developers and
// ops see clear guidance in the logs rather than cryptic runtime failures.
function validateEnv(): void {
  const isProduction = process.env.NODE_ENV === "production";

  const required: Array<{ key: string; note?: string }> = [
    { key: "MONGODB_URI",       note: "MongoDB connection string — DB features will not work" },
    { key: "SESSION_SECRET",    note: "Cookie signing secret — sessions are insecure without this" },
    { key: "APP_URL",           note: "Canonical domain URL — PayFast callbacks and CORS will be unreliable" },
  ];

  const recommended: Array<{ key: string; note: string }> = [
    { key: "PAYFAST_MERCHANT_ID",   note: "Required for live payments (sandbox used in dev only)" },
    { key: "PAYFAST_MERCHANT_KEY",  note: "Required for live payments" },
    { key: "FREESWITCH_DOMAIN",     note: "Required for SIP/WebRTC calling" },
    { key: "FREESWITCH_ESL_PASSWORD", note: "Required for FreeSWITCH event socket" },
    { key: "VAPID_PUBLIC_KEY",      note: "Required for web push notifications" },
    { key: "VAPID_PRIVATE_KEY",     note: "Required for web push notifications" },
    { key: "SENDGRID_API_KEY",      note: "Required for transactional email delivery" },
  ];

  const missing = required.filter((e) => !process.env[e.key]);
  const missingRecommended = recommended.filter((e) => !process.env[e.key]);

  if (missing.length > 0) {
    for (const e of missing) {
      logger.error({ key: e.key }, `[env] MISSING required variable: ${e.key} — ${e.note}`);
    }
    if (isProduction) {
      logger.error("[env] One or more required environment variables are missing. The platform may not function correctly in production.");
    }
  }

  if (missingRecommended.length > 0) {
    for (const e of missingRecommended) {
      logger.warn({ key: e.key }, `[env] Missing recommended variable: ${e.key} — ${e.note}`);
    }
  }

  // Warn about weak or default secrets in production
  if (isProduction) {
    const secret = process.env.SESSION_SECRET ?? "";
    if (secret.length < 32) {
      logger.error("[env] SESSION_SECRET is too short (must be at least 32 characters) — sessions are insecure");
    }
    if (secret === "changeme" || secret === "secret" || secret === "development") {
      logger.error("[env] SESSION_SECRET is using a default/weak value — change this before deploying");
    }
  }

  if (missing.length === 0 && missingRecommended.length === 0) {
    logger.info("[env] All environment variables validated OK");
  }
}

export async function runStartup(): Promise<void> {
  // ── 0. Validate environment ─────────────────────────────────────────────
  validateEnv();

  // ── 1. Start FreeSWITCH ESL listener ────────────────────────────────────
  // ESL is started BEFORE MongoDB so call control works even when the DB is
  // temporarily unavailable at boot.  All ESL event handlers call connectDB()
  // lazily, so starting early is safe.
  if (process.env.FREESWITCH_DOMAIN) {
    startESL();
    logger.info("FreeSWITCH ESL listener started");

    // Wire the sofia rescan callback into extension.ts so new users get an
    // immediate FreeSWITCH directory rescan after their first extension is
    // assigned — without this, their first SIP REGISTER can fail with
    // USER_NOT_REGISTERED until the next scheduled rescan.
    setSofiaRescanFn(() => {
      sendEslApiCommand("sofia profile prawwplus_mobile rescan");
    });
  }

  // ── 1a. Wire up media watchdog ESL injection ─────────────────────────────
  // Must be called after startESL() so the bgapi/command functions are ready.
  setMediaWatchdogEsl(
    (cmd: string) => sendEslBgapiAwait(cmd, 12_000),
    (cmd: string) => { sendEslApiCommand(cmd); },
  );

  // ── 1b. Start stale session sweeper ─────────────────────────────────────
  setSweepEslCommandFn((cmd: string) => { sendEslApiCommand(cmd); });
  startSessionSweeper();

  // ── 1c. SIP session expiry watchdog ──────────────────────────────────────
  // Every 5 minutes, evict any SIP registration entries whose expiresAt has
  // passed. This prevents the in-memory map from serving stale registrations
  // as "alive" after a device re-registers with a new contact/IP.
  setInterval(() => {
    const removed = cleanExpiredSipSessions();
    if (removed > 0) {
      logger.info({ removed }, "[SIP-Watchdog] Evicted expired SIP session entries");
    }
  }, 5 * 60_000).unref();

  // ── 2. Connect to MongoDB ────────────────────────────────────────────────
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    logger.warn(
      "MONGODB_URI / MONGO_URI is not set — skipping DB startup. " +
      "Set the MONGODB_URI environment variable and restart the server.",
    );
    return;
  }

  try {
    await connectDB();
    logger.info("MongoDB connected");
    startReconciliationWorker();
  } catch (err) {
    logger.error({ err }, "MongoDB connection failed — server will still start but DB features won't work");
    return;
  }

  // ── 2. Clean up stale calls left over from previous server sessions ──────
  //
  // Distinct cases:
  //
  //  "initiated"   — client created the DB record but CHANNEL_ANSWER never arrived,
  //                  meaning the SIP leg never connected. Safe to mark failed after
  //                  a short threshold (15 min). Real calls cannot stay "initiated"
  //                  for that long — FreeSWITCH's own no-answer timeout fires first.
  //
  //  "in-progress" / "answered" — active call in DB while server had timers + ESL.
  //                  On restart that state is gone, so we mark failed immediately
  //                  (same rationale as in-progress: no createdAt threshold).
  try {
    const now = new Date();

    const [initiatedResult, inProgressResult, answeredResult] = await Promise.all([
      // ALL "initiated" calls → failed immediately on restart.
      // Their in-memory 20 s watchdog timer died with the process, so they
      // will never be cleaned up otherwise. Any call still in "initiated"
      // when the server restarts is definitively dead — the caller's Verto
      // WebSocket disconnected along with the server.
      CallModel.updateMany(
        { status: "initiated" },
        { status: "failed", failReason: "Call not connected (server restart)", endedAt: now },
      ),
      // ALL "in-progress" calls → failed immediately (server lost state for them)
      CallModel.updateMany(
        { status: "in-progress" },
        { status: "failed", failReason: "Call ended unexpectedly (server restart)", endedAt: now },
      ),
      // "answered" — orchestrator uses this; same as in-progress after restart (timers/ESL reset)
      CallModel.updateMany(
        { status: "answered", endedAt: null },
        { status: "failed", failReason: "Call ended unexpectedly (server restart)", endedAt: now },
      ),
    ]);

    const total =
      initiatedResult.modifiedCount +
      inProgressResult.modifiedCount +
      answeredResult.modifiedCount;
    if (total > 0) {
      logger.info(
        {
          initiated: initiatedResult.modifiedCount,
          inProgress: inProgressResult.modifiedCount,
          answered: answeredResult.modifiedCount,
        },
        "Cleaned up stale calls from previous session",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to clean up stale calls — non-fatal");
  }

  // ── 3. Push FreeSWITCH config (xml_curl, verto, dialplan) ───────────────
  // This ensures FreeSWITCH always has the current APP_URL so its mod_xml_curl
  // directory lookups reach our live API endpoint at rtc.PRaww.co.za.
  if (process.env.FREESWITCH_DOMAIN && process.env.FREESWITCH_SSH_KEY) {
    logger.info("[FSH] Auto-pushing FreeSWITCH config on startup (light reload)…");
    pushFreeSwitchConfig({ lightReload: true })
      .then((result) => {
        if (result.success) {
          logger.info({ steps: result.steps }, "[FSH] FreeSWITCH config pushed OK");
        } else {
          logger.warn({ steps: result.steps, error: result.error }, "[FSH] FreeSWITCH config push failed — calls may not work");
        }
      })
      .catch((err) => {
        logger.warn({ err: (err as Error)?.message }, "[FSH] FreeSWITCH config push error");
      });
  }

  // ── 5. Find users without a FreeSWITCH extension ───────────────────────
  try {
    const usersWithoutExt = await UserModel
      .find({ $or: [{ extension: { $exists: false } }, { extension: null }] })
      .select("_id email username name")
      .lean();

    if (usersWithoutExt.length === 0) {
      logger.info("FreeSWITCH provisioning: all users already have extensions");
      const total = await UserModel.countDocuments({ extension: { $exists: true, $ne: null } });
      logger.info({ total }, "FreeSWITCH provisioned users total");
      return;
    }

    // Find the highest extension already assigned
    const maxUser = await UserModel
      .findOne({ extension: { $exists: true, $ne: null } })
      .sort({ extension: -1 })
      .select("extension")
      .lean();

    let nextExt = maxUser?.extension != null ? maxUser.extension + 1 : EXTENSION_START;

    // ── 5a. Bulk-assign extensions ────────────────────────────────────────
    const bulkOps = usersWithoutExt.map((user: any) => {
      const ext = nextExt++;
      const fsPassword = generateSipPassword();
      return {
        updateOne: {
          filter: { _id: user._id, $or: [{ extension: { $exists: false } }, { extension: null }] },
          update:  { $set: { extension: ext, fsPassword } },
        },
      };
    });

    const result = await UserModel.bulkWrite(bulkOps, { ordered: false });

    // ── 5b. Log summary ───────────────────────────────────────────────────
    logger.info(
      {
        provisioned:   result.modifiedCount,
        startExtension: nextExt - result.modifiedCount,
        endExtension:   nextExt - 1,
      },
      "FreeSWITCH provisioning complete",
    );

    // Show each user's assigned extension for easy debugging
    const provisioned = await UserModel
      .find({ extension: { $gte: EXTENSION_START } })
      .select("email username name extension")
      .sort({ extension: 1 })
      .lean();

    for (const u of provisioned) {
      logger.info(
        { extension: u.extension, email: u.email ?? u.username ?? u.name ?? u._id },
        "User extension",
      );
    }
  } catch (err) {
    logger.error({ err }, "FreeSWITCH provisioning failed — calls will still work for users who log in");
  }
}
