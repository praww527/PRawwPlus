/**
 * React Native entry point.
 *
 * IMPORTANT: FCM background handler MUST be registered here (before any other code)
 * so it runs in the headless JS task when the app is terminated.
 *
 * In Expo Go, Firebase and CallKeep native modules are not available.
 * We skip their registration gracefully so the app can still launch for UI preview.
 */

// Detect Expo Go at startup
let isExpoGo = false;
try {
  const Constants = require("expo-constants").default;
  isExpoGo = Constants.appOwnership === "expo";
} catch {}

if (!isExpoGo) {
  try {
    const messaging = require("@react-native-firebase/messaging").default;
    const RNCallKeep = require("react-native-callkeep").default;

    // Register background FCM handler — runs in a headless JS task
    // This must be the FIRST thing registered, even before the app renders
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      const data = remoteMessage.data ?? {};

      if (data.type === "incoming_call") {
        const uuid        = data.callUuid ?? `call-${Date.now()}`;
        const fromExt     = data.fromExtension ?? "Unknown";
        const displayName = `Extension ${fromExt}`;

        // Show the native call UI via CallKeep
        RNCallKeep.displayIncomingCall(uuid, fromExt, displayName, "number", false);
      }
    });
  } catch (err) {
    console.warn("[App] Background handler setup skipped:", err?.message ?? err);
  }
}

// Now load the Expo Router entry point
import "expo-router/entry";
