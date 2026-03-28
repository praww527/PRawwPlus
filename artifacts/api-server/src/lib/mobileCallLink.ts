/**
 * Correlate mobile JsSIP calls with Mongo Call rows.
 *
 * The app stores a client-generated UUID in `fsCallId`, but FreeSWITCH assigns the
 * real A-leg Unique-ID. ESL/orchestrator lookups fail without alignment, so calls
 * stay "initiated" in the DB while the client shows in-call (no server-side answer).
 *
 * The mobile client sends `X-PRaww-Call-Record-Id: <Call._id>` on the SIP INVITE.
 * mod_sofia exposes that as a channel variable; we read it from ESL events and patch
 * `Call.fsCallId` to the authoritative A-leg UUID before orchestration runs.
 */

import { connectDB, CallModel, UserModel } from "@workspace/db";
import { logger } from "./logger";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function extractPrawwCallRecordId(
  h: Record<string, string>,
): string | undefined {
  for (const [key, val] of Object.entries(h)) {
    if (!val?.trim()) continue;
    const k = key.toLowerCase();
    if (k.includes("praww-call-record-id")) {
      const id = val.trim();
      if (UUID_RE.test(id)) return id;
    }
  }
  return undefined;
}

function parseCallerExtension(h: Record<string, string>): number | null {
  const raw =
    h["Caller-Caller-ID-Number"] ??
    h["Channel-Caller-ID-Number"] ??
    h["variable_sip_from_user"] ??
    "";
  const n = parseInt(String(raw).replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * When CHANNEL_ORIGINATE reports an A-leg UUID, link the Call row (by SIP header)
 * so `fsCallId` matches FreeSWITCH for ESL-driven state transitions.
 */
export async function linkCallRecordToFsALeg(
  eventBody: Record<string, string>,
  aLegUuid: string,
): Promise<void> {
  if (!aLegUuid || !UUID_RE.test(aLegUuid)) return;

  const recordId = extractPrawwCallRecordId(eventBody);
  if (!recordId) return;

  const ext = parseCallerExtension(eventBody);
  if (ext == null) {
    logger.warn({ recordId }, "[ESL] linkCallRecord — could not parse caller extension");
    return;
  }

  await connectDB();
  const call = await CallModel.findById(recordId).select("userId fsCallId status").lean();
  if (!call) {
    logger.debug({ recordId }, "[ESL] linkCallRecord — no Call row for record id");
    return;
  }

  const user = await UserModel.findOne({ extension: ext }).select("_id").lean();
  if (!user || String(user._id) !== String(call.userId)) {
    logger.warn(
      { recordId, ext, callUserId: call.userId },
      "[ESL] linkCallRecord — extension does not own this call row (ignored)",
    );
    return;
  }

  if (call.fsCallId === aLegUuid) return;

  await CallModel.updateOne(
    { _id: recordId, userId: String(call.userId) },
    { $set: { fsCallId: aLegUuid } },
  );

  logger.info(
    { recordId, aLegUuid, prevFsCallId: call.fsCallId },
    "[ESL] Linked Call row fsCallId to FreeSWITCH A-leg (mobile SIP)",
  );
}
