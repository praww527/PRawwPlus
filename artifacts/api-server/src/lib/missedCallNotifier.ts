/**
 * Missed Call Notifier — Phase 6
 *
 * Sends push notifications when a call is missed (not answered).
 * Called by callOrchestrator when a call ends with status "missed".
 *
 * Delivery channels (all attempted in parallel when available):
 *   - Web Push  (browser subscription stored as webPushSubscription)
 *   - FCM       (Android / background-app)
 *   - Expo Push (iOS via Expo APNs gateway)
 *
 * Also provides a batched digest for users who have missed multiple calls
 * (sent at configurable intervals, default: immediately + daily digest).
 */

import { connectDB, UserModel } from "@workspace/db";
import { sendAdminPush, sendWebPushToSubscription } from "./push";
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
      .select("notificationPrefs fcmToken expoPushToken webPushSubscription name")
      .lean();

    if (!user) return;

    const prefs = (user as any).notificationPrefs;
    if (prefs?.missedCalls === false) return;

    const hasPush =
      (user as any).fcmToken ||
      (user as any).expoPushToken ||
      (user as any).webPushSubscription?.endpoint;

    if (!hasPush) return;

    const displayName = callerName ?? callerNumber;
    const title       = "📵 Missed Call";
    const body        = `You missed a call from ${displayName}`;
    const data: Record<string, string> = {
      type:        "missed_call",
      callId,
      callerNumber,
      callerName:  callerName ?? "",
      ts:          String(Date.now()),
    };

    const tasks: Promise<void>[] = [];

    // ── FCM + Expo ────────────────────────────────────────────────────────────
    if ((user as any).fcmToken || (user as any).expoPushToken) {
      tasks.push(
        sendAdminPush(
          (user as any).fcmToken,
          (user as any).expoPushToken,
          title,
          body,
          data,
        ).then(() => {}).catch((err) => {
          logger.warn({ err, userId }, "[missedCall] FCM/Expo push failed");
        }),
      );
    }

    // ── Web Push (browser subscription) ─────────────────────────────────────
    if ((user as any).webPushSubscription?.endpoint) {
      tasks.push(
        sendWebPushToSubscription(
          (user as any).webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } },
          { ...data, title, body },
          userId,
        ).then((result) => {
          if (result.error === "expired") {
            // Subscription is stale — remove it so we don't keep trying.
            UserModel.updateOne(
              { _id: userId },
              { $unset: { webPushSubscription: 1 } },
            ).catch(() => {});
            logger.info({ userId }, "[missedCall] Web push subscription expired — cleared");
          }
        }).catch((err) => {
          logger.warn({ err, userId }, "[missedCall] Web push failed");
        }),
      );
    }

    await Promise.all(tasks);

    const record: MissedCallRecord = { callId, callerNumber, callerName, at: Date.now() };
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
      const data: Record<string, string> = {
        type:  "missed_call_digest",
        count: String(recent.length),
        title,
        body,
      };

      const digestUser = await UserModel.findById(userId)
        .select("fcmToken expoPushToken webPushSubscription")
        .lean();
      if (!digestUser) { pendingDigests.delete(userId); continue; }

      const tasks: Promise<void>[] = [];

      if ((digestUser as any).fcmToken || (digestUser as any).expoPushToken) {
        tasks.push(
          sendAdminPush(
            (digestUser as any).fcmToken,
            (digestUser as any).expoPushToken,
            title,
            body,
            data,
          ).then(() => {}).catch(() => {}),
        );
      }

      if ((digestUser as any).webPushSubscription?.endpoint) {
        tasks.push(
          sendWebPushToSubscription(
            (digestUser as any).webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } },
            data,
            userId,
          ).then((result) => {
            if (result.error === "expired") {
              UserModel.updateOne(
                { _id: userId },
                { $unset: { webPushSubscription: 1 } },
              ).catch(() => {});
            }
          }).catch(() => {}),
        );
      }

      await Promise.all(tasks);
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
