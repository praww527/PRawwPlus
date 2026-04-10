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
import { startESL } from "./freeswitchESL";
import { pushFreeSwitchConfig } from "./freeswitchSSH";
import { startReconciliationWorker } from "./reconciliationWorker";

const EXTENSION_START = 1001;
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateSipPassword(): string {
  const bytes = crypto.randomBytes(12);
  let pw = "";
  for (let i = 0; i < 12; i++) pw += ALNUM[bytes[i] % ALNUM.length];
  return pw;
}

export async function runStartup(): Promise<void> {
  // ── 1. Connect to MongoDB ────────────────────────────────────────────────
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
    const STALE_INITIATED_MS = 15 * 60 * 1000; // 15 minutes
    const initiatedCutoff = new Date(Date.now() - STALE_INITIATED_MS);

    const [initiatedResult, inProgressResult, answeredResult] = await Promise.all([
      // "initiated" calls older than 15 min → failed (never connected)
      CallModel.updateMany(
        { status: "initiated", createdAt: { $lt: initiatedCutoff } },
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

  // ── 3. Start FreeSWITCH ESL listener ────────────────────────────────────
  if (process.env.FREESWITCH_DOMAIN) {
    startESL();
    logger.info("FreeSWITCH ESL listener started");
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

  // ── 4. Find users without a FreeSWITCH extension ───────────────────────
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

    // ── 3. Bulk-assign extensions ──────────────────────────────────────────
    const bulkOps = usersWithoutExt.map((user) => {
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

    // ── 4. Log summary ─────────────────────────────────────────────────────
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
