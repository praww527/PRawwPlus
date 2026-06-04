/**
 * Wakeup Push — Phase 6
 *
 * Sends a high-priority push notification to wake up a mobile app
 * before an incoming SIP INVITE arrives, giving the device time to
 * register (or re-register) so it can receive the call.
 *
 * Flow:
 *   1. Incoming call arrives (ESL CHANNEL_CREATE or callOrchestrator)
 *   2. wakeupPush.sendWakeup(userId, callData) is called
 *   3. FCM data-only message (priority=HIGH) sent to mobile device
 *   4. Device wakes, re-registers SIP, call arrives within ~2-3 seconds
 */

import { connectDB, UserModel } from "@workspace/db";
import { sendFcmDataMessage, sendExpoPush, sendWebPushToSubscription } from "./push";
import { logger } from "./logger";
import { metrics } from "./metrics";

export interface WakeupPayload {
  callId:        string;
  callerNumber:  string;
  callerName?:   string;
  direction:     "inbound" | "outbound";
  fsCallId?:     string;
  serverTimestamp: string;
}

/**
 * Send a wakeup push to the user's mobile device.
 * Returns true if at least one push was sent.
 */
export async function sendWakeup(userId: string, payload: WakeupPayload): Promise<boolean> {
  try {
    await connectDB();

    const user = await UserModel.findById(userId)
      .select("fcmToken expoPushToken notificationPrefs")
      .lean();

    if (!user) return false;

    const prefs = (user as any).notificationPrefs;
    if (prefs?.incomingCalls === false) return false;

    const data: Record<string, string> = {
      type:            "incoming_call_wakeup",
      callId:          payload.callId,
      callerNumber:    payload.callerNumber,
      callerName:      payload.callerName ?? "",
      direction:       payload.direction,
      fsCallId:        payload.fsCallId ?? "",
      serverTimestamp: payload.serverTimestamp,
    };

    let sent = false;

    if ((user as any).fcmToken) {
      await sendFcmDataMessage((user as any).fcmToken, data);
      metrics.pushWakeups++;
      sent = true;
      logger.info({ userId, callerNumber: payload.callerNumber }, "[wakeup] FCM wakeup sent");
    }

    if ((user as any).expoPushToken) {
      await sendExpoPush(
        (user as any).expoPushToken,
        "Incoming Call",
        `Call from ${payload.callerName ?? payload.callerNumber}`,
        data,
      );
      if (!sent) metrics.pushWakeups++;
      sent = true;
      logger.info({ userId, callerNumber: payload.callerNumber }, "[wakeup] Expo wakeup sent");
    }

    return sent;
  } catch (err) {
    logger.error({ err, userId }, "[wakeup] sendWakeup failed");
    return false;
  }
}

/**
 * Batch wakeup for ring-all scenarios.
 */
export async function sendWakeupToExtensions(
  userIds:  string[],
  payload:  WakeupPayload,
): Promise<number> {
  const results = await Promise.allSettled(userIds.map((id) => sendWakeup(id, payload)));
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

/**
 * Shared helper: send an incoming-call wakeup push to a callee identified by
 * their extension number.  Used by both CHANNEL_ORIGINATE push and the
 * hold-window retry loop so external/trunk inbound calls also wake the device.
 *
 * Respects DND and notificationPrefs.incomingCalls.
 * Returns true if at least one push channel was attempted.
 */
export async function sendIncomingCallWakeupByExt(
  destExtStr:    string,
  callerExtOrNum: string,
  aLegUuid?:     string,
): Promise<boolean> {
  try {
    await connectDB();

    const extNum = parseInt(destExtStr, 10);
    if (!extNum || extNum < 1000 || extNum > 9999) return false;

    const user = await UserModel.findOne({ extension: extNum })
      .select("_id fcmToken expoPushToken webPushSubscription notificationPrefs dnd")
      .lean();

    if (!user) return false;
    if ((user as any).dnd) return false;
    if ((user as any).notificationPrefs?.incomingCalls === false) return false;

    const data: Record<string, string> = {
      type:          "incoming_call_wakeup",
      toExtension:   destExtStr,
      callerNumber:  callerExtOrNum,
      aLegUuid:      aLegUuid ?? "",
      serverTimestamp: new Date().toISOString(),
    };

    const title = "📞 Incoming Call";
    const body  = `Call from ${callerExtOrNum}`;

    let sent = false;
    const tasks: Promise<void>[] = [];

    if ((user as any).fcmToken) {
      tasks.push(
        sendFcmDataMessage((user as any).fcmToken, data).then(() => {
          metrics.pushWakeups++;
          sent = true;
          logger.info({ destExtStr, callerExtOrNum }, "[wakeup] FCM incoming-call wakeup sent (hold window)");
        }).catch((err) => {
          logger.warn({ err, destExtStr }, "[wakeup] FCM wakeup (hold window) failed");
        }),
      );
    }

    if ((user as any).webPushSubscription?.endpoint) {
      tasks.push(
        sendWebPushToSubscription(
          (user as any).webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } },
          // Override type to "incoming_call" so the service worker shows the
          // Answer/Decline action buttons — SW only renders those for incoming_call.
          { ...data, type: "incoming_call", title, body },
          String((user as any)._id),
        ).then((result) => {
          if (result.sent) {
            sent = true;
            logger.info({ destExtStr }, "[wakeup] web-push incoming-call wakeup sent (hold window)");
          }
          if (result.error === "expired") {
            UserModel.updateOne(
              { _id: (user as any)._id },
              { $unset: { webPushSubscription: 1 } },
            ).catch(() => {});
          }
        }),
      );
    }

    if ((user as any).expoPushToken) {
      tasks.push(
        sendExpoPush((user as any).expoPushToken, title, body, data).then(() => {
          sent = true;
          logger.info({ destExtStr, callerExtOrNum }, "[wakeup] Expo incoming-call wakeup sent (hold window)");
        }).catch((err) => {
          logger.warn({ err, destExtStr }, "[wakeup] Expo wakeup (hold window) failed");
        }),
      );
    }

    await Promise.all(tasks);
    return sent;
  } catch (err) {
    logger.error({ err, destExtStr }, "[wakeup] sendIncomingCallWakeupByExt failed");
    return false;
  }
}
