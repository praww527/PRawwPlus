/**
 * Missed Call Notifier — Phase 6
 *
 * Sends push notifications when a call is missed (not answered).
 * Called by callOrchestrator when a call ends with status "missed".
 *
 * Also provides a batched digest for users who have missed multiple calls
 * (sent at configurable intervals, default: immediately + daily digest).
 */

import { connectDB, UserModel } from "@workspace/db";
import { sendAdminPush } from "./push";
import { logger } from "./logger";

interface MissedCallRecord {
  callId:       string;
  callerNumber: string;
  callerName?:  string;
  at:           number;
}

const pendingDigests = new Map<string, MissedCallRecord[]>();

/**
 * Immediately notify a user of a missed call and queue for digest.
 */
export async function notifyMissedCall(
  userId:       string,
  callerNumber: string,
  callId:       string,
  callerName?:  string,
): Promise<void> {
  try {
    await connectDB();

    const user = await UserModel.findById(userId)
      .select("notificationPrefs fcmToken expoPushToken name")
      .lean();

    if (!user) return;

    const prefs = (user as any).notificationPrefs;
    if (prefs?.missedCalls === false) return;

    const hasPush = (user as any).fcmToken || (user as any).expoPushToken;
    if (!hasPush) return;

    const displayName = callerName ?? callerNumber;
    await sendAdminPush(
      (user as any).fcmToken,
      (user as any).expoPushToken,
      "Missed Call",
      `You missed a call from ${displayName}`,
      { type: "missed_call", callId, callerNumber, callerName: callerName ?? "", ts: String(Date.now()) },
    );

    const record: MissedCallRecord = {
      callId,
      callerNumber,
      callerName,
      at: Date.now(),
    };

    const existing = pendingDigests.get(userId) ?? [];
    existing.push(record);
    if (existing.length > 20) existing.shift();
    pendingDigests.set(userId, existing);

    logger.info({ userId, callerNumber, callId }, "[missedCall] Notification sent");
  } catch (err) {
    logger.error({ err, userId, callId }, "[missedCall] notifyMissedCall failed");
  }
}

/**
 * Send a daily digest of all missed calls to users who have multiple.
 * Called by invoiceCron or on a separate schedule.
 */
export async function sendMissedCallDigests(): Promise<void> {
  const now = Date.now();

  for (const [userId, records] of pendingDigests) {
    if (records.length < 2) { pendingDigests.delete(userId); continue; }

    try {
      const recent = records.filter((r) => now - r.at < 24 * 3600 * 1000);
      if (recent.length === 0) { pendingDigests.delete(userId); continue; }

      const title = `${recent.length} Missed Calls`;
      const body  = `You have ${recent.length} missed calls. Latest: ${recent[recent.length - 1].callerNumber}`;

      const digestUser = await UserModel.findById(userId).select("fcmToken expoPushToken").lean();
      if (!digestUser) { pendingDigests.delete(userId); continue; }
      await sendAdminPush(
        (digestUser as any).fcmToken,
        (digestUser as any).expoPushToken,
        title,
        body,
        { type: "missed_call_digest", count: String(recent.length) },
      );

      pendingDigests.delete(userId);
      logger.info({ userId, count: recent.length }, "[missedCall] Digest sent");
    } catch (err) {
      logger.error({ err, userId }, "[missedCall] Digest send failed");
    }
  }
}

export function getMissedCallDigestStats(): { userCount: number; totalPending: number } {
  let totalPending = 0;
  for (const v of pendingDigests.values()) totalPending += v.length;
  return { userCount: pendingDigests.size, totalPending };
}
