/**
 * Firebase Cloud Messaging service.
 *
 * Handles:
 *  - FCM token registration / upload to backend
 *  - Foreground message handling
 *  - Background/terminated message handling (set up in index.js)
 *
 * Gracefully degrades in Expo Go where Firebase is not available.
 */

import { Platform } from "react-native";
import { isExpoGo } from "./isExpoGo";
import { callKeepService } from "./callKeepService";
import { apiRequest } from "./api";

type RemoteMessage = {
  data?: Record<string, string>;
};

function getMessaging(): any | null {
  if (isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("@react-native-firebase/messaging").default;
  } catch {
    console.warn("[FCM] @react-native-firebase/messaging not available");
    return null;
  }
}

async function requestPermission(): Promise<boolean> {
  const messagingFn = getMessaging();
  if (!messagingFn) return false;
  try {
    const authStatus = await messagingFn().requestPermission();
    return (
      authStatus === messagingFn.AuthorizationStatus.AUTHORIZED ||
      authStatus === messagingFn.AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

export async function registerFcmToken(): Promise<string | null> {
  if (isExpoGo) {
    console.log("[FCM] Skipped — running in Expo Go (dev preview mode)");
    return null;
  }
  const messagingFn = getMessaging();
  if (!messagingFn) return null;

  try {
    if (Platform.OS === "ios") {
      await messagingFn().registerDeviceForRemoteMessages();
    }

    const granted = await requestPermission();
    if (!granted) {
      console.warn("[FCM] Permission not granted");
      return null;
    }

    const token = await messagingFn().getToken();
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

export function handleForegroundMessage(message: RemoteMessage): void {
  const data = message.data;
  if (!data) return;

  if (data.type === "incoming_call") {
    const uuid = data.callUuid ?? `call-${Date.now()}`;
    const from = data.fromExtension ?? "Unknown";
    callKeepService.displayIncomingCall(uuid, from, `Extension ${from}`);
  }
}

export function handleBackgroundMessage(message: RemoteMessage): Promise<void> {
  const data = message.data;
  if (!data) return Promise.resolve();

  if (data.type === "incoming_call") {
    const uuid = data.callUuid ?? `call-${Date.now()}`;
    const from = data.fromExtension ?? "Unknown";
    callKeepService.displayIncomingCall(uuid, from, `Extension ${from}`);
  }

  return Promise.resolve();
}

export function setupFcmListeners(): () => void {
  if (isExpoGo) {
    console.log("[FCM] Listeners skipped — running in Expo Go (dev preview mode)");
    return () => {};
  }

  const messagingFn = getMessaging();
  if (!messagingFn) return () => {};

  try {
    const unsubForeground = messagingFn().onMessage(async (message: RemoteMessage) => {
      handleForegroundMessage(message);
    });

    const unsubTokenRefresh = messagingFn().onTokenRefresh(async (token: string) => {
      await uploadFcmToken(token);
    });

    return () => {
      unsubForeground();
      unsubTokenRefresh();
    };
  } catch (err) {
    console.warn("[FCM] Failed to set up listeners:", err);
    return () => {};
  }
}
