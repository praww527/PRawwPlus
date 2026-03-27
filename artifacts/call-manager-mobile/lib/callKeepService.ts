/**
 * react-native-callkeep service.
 *
 * Wraps RNCallKeep to provide:
 *  - Native call UI on incoming push (both foreground, background, and terminated state)
 *  - Answer / end / DTMF events forwarded to the VoIP engine
 *  - Lock-screen call display on Android (ConnectionService) and iOS (CallKit)
 *
 * Gracefully degrades in Expo Go / environments where CallKeep is not available.
 */

import { Platform } from "react-native";
import { isExpoGo } from "./isExpoGo";
import { voipEngine } from "./voipEngine";

export type CallKeepEvent =
  | { type: "answerCall";  uuid: string }
  | { type: "endCall";     uuid: string }
  | { type: "didActivateAudioSession" }
  | { type: "didDeactivateAudioSession" };

type CallKeepListener = (event: CallKeepEvent) => void;

const listeners: CallKeepListener[] = [];

function getRNCallKeep(): any | null {
  if (isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("react-native-callkeep").default;
  } catch {
    console.warn("[CallKeep] react-native-callkeep not available");
    return null;
  }
}

export const callKeepService = {
  setup(): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) {
      if (isExpoGo) {
        console.log("[CallKeep] Skipped — running in Expo Go (dev preview mode)");
      }
      return;
    }

    const options = {
      ios: {
        appName: "PRawwPlus",
        supportsVideo: false,
        maximumCallGroups: "1",
        maximumCallsPerCallGroup: "1",
        includesCallsInRecents: true,
      },
      android: {
        alertTitle:       "Permissions required",
        alertDescription: "PRawwPlus needs access to manage phone calls",
        cancelButton:     "Cancel",
        okButton:         "OK",
        imageName:        "ic_launcher",
        additionalPermissions: [],
        selfManaged: true,
      },
    };

    RNCallKeep.setup(options).catch((err: any) => {
      console.warn("[CallKeep] Setup error:", err?.message ?? err);
    });

    if (Platform.OS === "ios") {
      RNCallKeep.setAvailable(true);
    }

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
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    try {
      RNCallKeep.displayIncomingCall(uuid, handle, displayName, "number", false);
    } catch (e) {
      console.warn("[CallKeep] displayIncomingCall error:", e);
    }
  },

  reportCallConnected(uuid: string): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    try {
      RNCallKeep.reportConnectedOutgoingCallWithUUID(uuid);
    } catch (e) {
      console.warn("[CallKeep] reportCallConnected error:", e);
    }
  },

  endCall(uuid: string): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    try {
      RNCallKeep.endCall(uuid);
    } catch (e) {
      console.warn("[CallKeep] endCall error:", e);
    }
  },

  endAllCalls(): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    try {
      RNCallKeep.endAllCalls();
    } catch (e) {
      console.warn("[CallKeep] endAllCalls error:", e);
    }
  },

  reportCallEnded(uuid: string): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    try {
      RNCallKeep.reportEndCallWithUUID(uuid, 2);
    } catch (e) {
      console.warn("[CallKeep] reportCallEnded error:", e);
    }
  },

  addListener(listener: CallKeepListener): () => void {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  },

  destroy(): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    try {
      RNCallKeep.removeEventListener("answerCall");
      RNCallKeep.removeEventListener("endCall");
      RNCallKeep.removeEventListener("didActivateAudioSession");
      RNCallKeep.removeEventListener("didDeactivateAudioSession");
      RNCallKeep.removeEventListener("didLoadWithEvents");
    } catch (e) {
      console.warn("[CallKeep] destroy error:", e);
    }
  },
};
