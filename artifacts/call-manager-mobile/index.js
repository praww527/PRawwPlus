/**
 * React Native entry point.
 *
 * IMPORTANT: FCM background handler MUST be registered here (before any other code)
 * so it runs in the headless JS task when the app is terminated.
 */

import messaging from "@react-native-firebase/messaging";
import RNCallKeep from "react-native-callkeep";

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

// Now load the Expo Router entry point
import "expo-router/entry";
