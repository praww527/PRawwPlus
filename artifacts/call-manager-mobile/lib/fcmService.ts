/**
 * Firebase Cloud Messaging service.
 *
 * Handles:
 *  - FCM token registration / upload to backend
 *  - Foreground message handling
 *  - Background/terminated message handling (set up in index.js)
 *
 * NOTE: @react-native-firebase/messaging is a native module only available
 * in development builds, NOT in standard Expo Go. All functions are safe
 * no-ops when running in Expo Go.
 */

import { Platform } from "react-native";
import { callKeepService } from "./callKeepService";
import { apiRequest } from "./api";

// Lazily resolve the Firebase messaging module
function getMessaging(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-firebase/messaging");
    return (mod.default ?? mod)();
  } catch {
    return null;
  }
}

// Lazily resolve the messaging module class (for static AuthorizationStatus)
function getMessagingClass(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-firebase/messaging");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function requestPermission(): Promise<boolean> {
  const instance = getMessaging();
  const MessagingClass = getMessagingClass();
  if (!instance || !MessagingClass) return false;

  const authStatus = await instance.requestPermission();
  return (
    authStatus === MessagingClass.AuthorizationStatus.AUTHORIZED ||
    authStatus === MessagingClass.AuthorizationStatus.PROVISIONAL
  );
}

export async function registerFcmToken(): Promise<string | null> {
  const instance = getMessaging();
  if (!instance) {
    console.warn("[FCM] Native module not available (Expo Go). Skipping FCM token registration.");
    return null;
  }

  try {
    if (Platform.OS === "ios") {
      await instance.registerDeviceForRemoteMessages();
    }

    const granted = await requestPermission();
    if (!granted) {
      console.warn("[FCM] Permission not granted");
      return null;
    }

    const token = await instance.getToken();
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

export function handleForegroundMessage(message: any): void {
  const data = message?.data as Record<string, string> | undefined;
  if (!data) return;

  if (data.type === "incoming_call") {
    const uuid = data.callUuid ?? `call-${Date.now()}`;
    const from = data.fromExtension ?? "Unknown";
    callKeepService.displayIncomingCall(uuid, from, `Extension ${from}`);
  }
}

export function handleBackgroundMessage(message: any): Promise<void> {
  const data = message?.data as Record<string, string> | undefined;
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
 * Returns a cleanup function. Safe to call in Expo Go (returns a no-op cleanup).
 */
export function setupFcmListeners(): () => void {
  const instance = getMessaging();
  if (!instance) {
    console.warn("[FCM] Native module not available (Expo Go). Skipping FCM listeners.");
    return () => {};
  }

  const unsubForeground = instance.onMessage(async (message: any) => {
    handleForegroundMessage(message);
  });

  const unsubTokenRefresh = instance.onTokenRefresh(async (token: string) => {
    await uploadFcmToken(token);
  });

  return () => {
    unsubForeground();
    unsubTokenRefresh();
  };
}
