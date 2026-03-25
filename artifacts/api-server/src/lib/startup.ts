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
import { connectDB, UserModel } from "@workspace/db";
import { logger } from "./logger";
import { startESL } from "./freeswitchESL";
import { pushFreeSwitchConfig } from "./freeswitchSSH";

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
      "Add the secret in the Secrets panel and restart the server.",
    );
    return;
  }

  try {
    await connectDB();
    logger.info("MongoDB connected");
  } catch (err) {
    logger.error({ err }, "MongoDB connection failed — server will still start but DB features won't work");
    return;
  }

  // ── 2. Start FreeSWITCH ESL listener ────────────────────────────────────
  if (process.env.FREESWITCH_DOMAIN) {
    startESL();
    logger.info("FreeSWITCH ESL listener started");
  }

  // ── 3. Push FreeSWITCH config (xml_curl, verto, dialplan) ───────────────
  // This ensures FreeSWITCH always has the current APP_URL / REPLIT_DEV_DOMAIN
  // so its mod_xml_curl directory lookups reach our live API endpoint.
  if (process.env.FREESWITCH_DOMAIN && process.env.FREESWITCH_SSH_KEY) {
    logger.info("[FSH] Auto-pushing FreeSWITCH config on startup…");
    pushFreeSwitchConfig()
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
