/**
 * Firebase Cloud Messaging service.
 *
 * Handles:
 *  - FCM token registration / upload to backend
 *  - Foreground message handling
 *  - Background/terminated message handling (set up in index.js)
 *
 * For incoming_call type messages, this triggers callKeepService.displayIncomingCall
 * so the native call UI appears even when the app is closed.
 */

import messaging, { type FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import { Platform } from "react-native";
import { callKeepService } from "./callKeepService";
import { apiRequest } from "./api";

async function requestPermission(): Promise<boolean> {
  const authStatus = await messaging().requestPermission();
  return (
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL
  );
}

export async function registerFcmToken(): Promise<string | null> {
  try {
    if (Platform.OS === "ios") {
      await messaging().registerDeviceForRemoteMessages();
    }

    const granted = await requestPermission();
    if (!granted) {
      console.warn("[FCM] Permission not granted");
      return null;
    }

    const token = await messaging().getToken();
    if (!token) return null;

    await uploadFcmToken(token);
    return token;
  } catch (err) {
    console.error("[FCM] Failed to register FCM token:", err);
    return null;
  }
}

export async function uploadFcmToken(token: string): Promise<void> {
  try {
    await apiRequest("/users/fcm-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  } catch {
    // Silently fail — will retry on next login
  }
}

export async function removeFcmToken(): Promise<void> {
  try {
    await apiRequest("/users/fcm-token", { method: "DELETE" });
  } catch {}
}

/**
 * Handle a FCM message that arrives while the app is in the foreground.
 * For incoming_call type, show the native call UI via CallKeep.
 */
export function handleForegroundMessage(
  message: FirebaseMessagingTypes.RemoteMessage,
): void {
  const data = message.data as Record<string, string> | undefined;
  if (!data) return;

  if (data.type === "incoming_call") {
    const uuid    = data.callUuid ?? `call-${Date.now()}`;
    const from    = data.fromExtension ?? "Unknown";
    callKeepService.displayIncomingCall(uuid, from, `Extension ${from}`);
  }
}

/**
 * Background / Quit-state message handler (registered in index.js).
 * This function is called in a headless JS task — no React state available.
 */
export function handleBackgroundMessage(
  message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
  const data = message.data as Record<string, string> | undefined;
  if (!data) return Promise.resolve();

  if (data.type === "incoming_call") {
    const uuid = data.callUuid ?? `call-${Date.now()}`;
    const from = data.fromExtension ?? "Unknown";
    callKeepService.displayIncomingCall(uuid, from, `Extension ${from}`);
  }

  return Promise.resolve();
}

/**
 * Set up all FCM listeners for a running app.
 * Returns a cleanup function.
 */
export function setupFcmListeners(): () => void {
  // Foreground messages
  const unsubForeground = messaging().onMessage(async (message) => {
    handleForegroundMessage(message);
  });

  // Token refresh
  const unsubTokenRefresh = messaging().onTokenRefresh(async (token) => {
    await uploadFcmToken(token);
  });

  return () => {
    unsubForeground();
    unsubTokenRefresh();
  };
}
