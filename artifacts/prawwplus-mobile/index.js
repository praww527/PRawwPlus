/**
 * React Native entry point.
 *
 * IMPORTANT: The FCM background message handler MUST be registered here,
 * at the module level, before any other code.  It runs inside a headless JS
 * task when the app is terminated (killed state) on Android and the device
 * receives a high-priority FCM data message.
 *
 * react-native-callkeep and @react-native-firebase/messaging are native
 * modules only available in development builds (not standard Expo Go).
 * Both are resolved lazily so the file stays safe in Expo Go.
 */

import { registerRootComponent } from "expo";
import App from "./App";

try {
  const messaging = require("@react-native-firebase/messaging").default;

  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    const data = remoteMessage?.data ?? {};
    if (data.type !== "incoming_call") return;

    try {
      const rnck       = require("react-native-callkeep");
      const RNCallKeep = rnck.default ?? rnck;

      // In the headless / killed-state context the React component tree has
      // not mounted, so the callKeepService singleton has not been set up.
      // Call RNCallKeep.setup() directly — it is idempotent and must complete
      // before displayIncomingCall() is invoked.
      await RNCallKeep.setup({
        ios: {
          appName: "PRaww+",
          supportsVideo: false,
          maximumCallGroups: "1",
          maximumCallsPerCallGroup: "1",
          includesCallsInRecents: true,
        },
        android: {
          alertTitle:            "Permissions required",
          alertDescription:      "PRaww+ needs access to manage phone calls",
          cancelButton:          "Cancel",
          okButton:              "OK",
          imageName:             "ic_launcher",
          additionalPermissions: [],
          selfManaged:           true,
        },
      });

      const uuid        = data.callUuid ?? `call-${Date.now()}`;
      const fromExt     = data.fromExtension ?? "Unknown";
      const displayName = `Extension ${fromExt}`;

      RNCallKeep.displayIncomingCall(uuid, fromExt, displayName, "number", false);
    } catch (ckErr) {
      console.warn(
        "[index.js] CallKeep background handler error:",
        ckErr?.message ?? ckErr,
      );
    }
  });
} catch (fcmErr) {
  console.warn(
    "[index.js] FCM background handler not registered (Expo Go?):",
    fcmErr?.message ?? fcmErr,
  );
}

registerRootComponent(App);
