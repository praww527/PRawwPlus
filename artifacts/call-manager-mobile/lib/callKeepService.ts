/**
 * react-native-callkeep service.
 *
 * Wraps RNCallKeep to provide:
 *  - Native call UI on incoming push (both foreground, background, and terminated state)
 *  - Answer / end / DTMF events forwarded to the VoIP engine
 *  - Lock-screen call display on Android (ConnectionService) and iOS (CallKit)
 */

import RNCallKeep from "react-native-callkeep";
import { Platform } from "react-native";
import { voipEngine } from "./voipEngine";

export type CallKeepEvent =
  | { type: "answerCall";  uuid: string }
  | { type: "endCall";     uuid: string }
  | { type: "didActivateAudioSession" }
  | { type: "didDeactivateAudioSession" };

type CallKeepListener = (event: CallKeepEvent) => void;

const listeners: CallKeepListener[] = [];

export const callKeepService = {
  setup(): void {
    const options = {
      ios: {
        appName: "Call Manager",
        supportsVideo: false,
        maximumCallGroups: "1",
        maximumCallsPerCallGroup: "1",
        includesCallsInRecents: true,
      },
      android: {
        alertTitle:       "Permissions required",
        alertDescription: "Call Manager needs access to manage phone calls",
        cancelButton:     "Cancel",
        okButton:         "OK",
        imageName:        "ic_launcher",
        additionalPermissions: [],
        // Required for Android 14+
        selfManaged: true,
      },
    };

    RNCallKeep.setup(options).catch((err: any) => {
      console.warn("[CallKeep] Setup error:", err?.message ?? err);
    });

    // iOS-only: request mic permission via CallKit
    if (Platform.OS === "ios") {
      RNCallKeep.setAvailable(true);
    }

    // Register event handlers
    RNCallKeep.addEventListener("answerCall", ({ callUUID }: { callUUID: string }) => {
      console.log("[CallKeep] answerCall", callUUID);
      voipEngine.answerIncomingCall().catch(console.error);
      const event: CallKeepEvent = { type: "answerCall", uuid: callUUID };
      listeners.forEach((l) => l(event));
    });

    RNCallKeep.addEventListener("endCall", ({ callUUID }: { callUUID: string }) => {
      console.log("[CallKeep] endCall", callUUID);
      voipEngine.rejectIncomingCall();
      voipEngine.hangup();
      const event: CallKeepEvent = { type: "endCall", uuid: callUUID };
      listeners.forEach((l) => l(event));
    });

    RNCallKeep.addEventListener("didActivateAudioSession", () => {
      console.log("[CallKeep] audio session activated");
      const event: CallKeepEvent = { type: "didActivateAudioSession" };
      listeners.forEach((l) => l(event));
    });

    RNCallKeep.addEventListener("didDeactivateAudioSession", () => {
      console.log("[CallKeep] audio session deactivated");
      const event: CallKeepEvent = { type: "didDeactivateAudioSession" };
      listeners.forEach((l) => l(event));
    });

    RNCallKeep.addEventListener("didLoadWithEvents", (events: any[]) => {
      // Handle events that were queued while the app was not running
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (event.name === "RNCallKeepPerformAnswerCallAction") {
          const { callUUID } = event.data ?? {};
          if (callUUID) {
            voipEngine.answerIncomingCall().catch(console.error);
            listeners.forEach((l) => l({ type: "answerCall", uuid: callUUID }));
          }
        } else if (event.name === "RNCallKeepPerformEndCallAction") {
          const { callUUID } = event.data ?? {};
          if (callUUID) {
            voipEngine.rejectIncomingCall();
            voipEngine.hangup();
            listeners.forEach((l) => l({ type: "endCall", uuid: callUUID }));
          }
        }
      }
    });
  },

  displayIncomingCall(uuid: string, handle: string, displayName: string): void {
    RNCallKeep.displayIncomingCall(
      uuid,
      handle,
      displayName,
      "number",
      false,
    );
  },

  reportCallConnected(uuid: string): void {
    RNCallKeep.reportConnectedOutgoingCallWithUUID(uuid);
  },

  endCall(uuid: string): void {
    RNCallKeep.endCall(uuid);
  },

  endAllCalls(): void {
    RNCallKeep.endAllCalls();
  },

  reportCallEnded(uuid: string): void {
    RNCallKeep.reportEndCallWithUUID(uuid, 2); // 2 = remote ended
  },

  addListener(listener: CallKeepListener): () => void {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  },

  destroy(): void {
    RNCallKeep.removeEventListener("answerCall");
    RNCallKeep.removeEventListener("endCall");
    RNCallKeep.removeEventListener("didActivateAudioSession");
    RNCallKeep.removeEventListener("didDeactivateAudioSession");
    RNCallKeep.removeEventListener("didLoadWithEvents");
  },
};
