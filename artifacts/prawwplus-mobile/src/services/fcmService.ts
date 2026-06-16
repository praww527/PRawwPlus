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
import { callKeepService } from "./voip/callKeepService";
import { apiRequest } from "./api";

// Track the UUID of any currently-displayed incoming CallKeep UI so we can end
// the old one when a second "incoming_call" push arrives for the same call
// (wakeup push arrives first with the MongoDB call ID; then CHANNEL_ORIGINATE
// fires and sends a second push with the real FreeSWITCH B-leg UUID).
let _pendingCallKeepUuid: string | null = null;

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

  if (data.type === "call_wakeup" || data.type === "incoming_call_wakeup") {
    // Silent wakeup so the SIP/Verto socket reconnects before FreeSWITCH
    // tries to deliver the invite.  No CallKeep UI — the authoritative
    // incoming_call push arrives from CHANNEL_ORIGINATE with the real B-leg UUID.
    return;
  }

  if (data.type === "incoming_call") {
    const uuid = data.callUuid ?? `call-${Date.now()}`;
    // Server sends either fromExtension (internal) or fromPhone (verified external caller).
    // The extension is needed for SIP INVITE matching; the phone/name is for display.
    // Neither the displayName nor the handle (the OS "number" field) may show a
    // raw extension — both are user-visible. Show the phone if known, else a
    // generic label. SIP routing keys off the UUID, not this handle.
    const display = data.fromPhone ?? "Unknown caller";
    // Deduplicate: end any previous pending CallKeep UI before showing the new one.
    // This handles the case where the wakeup push (callUuid = MongoDB _id) arrives
    // first, then CHANNEL_ORIGINATE fires and sends a second push with the real
    // FreeSWITCH B-leg UUID — without this, both UUIDs would show simultaneously.
    if (_pendingCallKeepUuid && _pendingCallKeepUuid !== uuid) {
      try { callKeepService.endCall(_pendingCallKeepUuid); } catch { /* ignore */ }
    }
    _pendingCallKeepUuid = uuid;
    callKeepService.displayIncomingCall(uuid, display, display);
    return;
  }

  if (data.type === "call_terminated") {
    // Admin killed an active call — end any ringing CallKeep UI immediately
    const uuid = data.callId ?? data.fsCallId;
    if (uuid) {
      try { callKeepService.endCall(uuid); } catch { /* ignore */ }
    }
    _pendingCallKeepUuid = null;
    return;
  }

  // admin_message / update / maintenance / info are handled natively by the
  // FCM notification payload on Android/iOS; no extra JS action needed in fg.
}

export function handleBackgroundMessage(message: any): Promise<void> {
  const data = message?.data as Record<string, string> | undefined;
  if (!data) return Promise.resolve();

  if (data.type === "call_wakeup" || data.type === "incoming_call_wakeup") {
    return Promise.resolve();
  }

  if (data.type === "incoming_call") {
    const uuid = data.callUuid ?? `call-${Date.now()}`;
    // Neither the displayName nor the handle (the OS "number" field) may show a
    // raw extension — both are user-visible. Show the phone if known, else a
    // generic label. SIP routing keys off the UUID, not this handle.
    const display = data.fromPhone ?? "Unknown caller";
    // Deduplicate: end any previous pending CallKeep UI before showing the new one.
    if (_pendingCallKeepUuid && _pendingCallKeepUuid !== uuid) {
      try { callKeepService.endCall(_pendingCallKeepUuid); } catch { /* ignore */ }
    }
    _pendingCallKeepUuid = uuid;
    callKeepService.displayIncomingCall(uuid, display, display);
  }

  if (data.type === "call_terminated") {
    const uuid = data.callId ?? data.fsCallId;
    if (uuid) {
      try { callKeepService.endCall(uuid); } catch { /* ignore */ }
    }
    _pendingCallKeepUuid = null;
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
