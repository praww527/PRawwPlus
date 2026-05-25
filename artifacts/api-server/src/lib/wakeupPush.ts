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
import { sendFcmDataMessage, sendExpoPush } from "./push";
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
