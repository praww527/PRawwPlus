/**
 * React Native entry point.
 *
 * IMPORTANT: FCM background handler MUST be registered here (before any other code)
 * so it runs in the headless JS task when the app is terminated.
 *
 * NOTE: react-native-callkeep and @react-native-firebase/messaging are native modules
 * that are only available in development builds, NOT in standard Expo Go.
 * If running in Expo Go, these are gracefully skipped.
 */

try {
  const messaging = require("@react-native-firebase/messaging").default;
  const RNCallKeep = require("react-native-callkeep").default;

  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    const data = remoteMessage.data ?? {};

    if (data.type === "incoming_call") {
      const uuid        = data.callUuid ?? `call-${Date.now()}`;
      const fromExt     = data.fromExtension ?? "Unknown";
      const displayName = `Extension ${fromExt}`;

      RNCallKeep.displayIncomingCall(uuid, fromExt, displayName, "number", false);
    }
  });
} catch (e) {
  console.warn("[PRaww+] Native modules (Firebase/CallKeep) not available in Expo Go.", e?.message ?? e);
}

import { registerRootComponent } from "expo";
import App from "./src/App";

registerRootComponent(App);
