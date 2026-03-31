/**
 * react-native-callkeep service.
 *
 * Wraps RNCallKeep to provide:
 *  - Native call UI on incoming push (both foreground, background, and terminated state)
 *  - Answer / end / DTMF events forwarded to the VoIP engine
 *  - Lock-screen call display on Android (ConnectionService) and iOS (CallKit)
 *
 * NOTE: react-native-callkeep is a native module only available in development builds.
 * All methods are no-ops when running in Expo Go.
 */

import { Platform } from "react-native";
import { voipEngine } from "./voipEngine";

export type CallKeepEvent =
  | { type: "answerCall";  uuid: string }
  | { type: "endCall";     uuid: string }
  | { type: "didActivateAudioSession" }
  | { type: "didDeactivateAudioSession" };

type CallKeepListener = (event: CallKeepEvent) => void;

const listeners: CallKeepListener[] = [];

// Lazily resolve RNCallKeep so the app doesn't crash in Expo Go
function getRNCallKeep(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("react-native-callkeep");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export const callKeepService = {
  setup(): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) {
      console.warn("[CallKeep] Native module not available (Expo Go). Using no-op mode.");
      return;
    }

    const options = {
      ios: {
        appName: "PRaww+",
        supportsVideo: false,
        maximumCallGroups: "1",
        maximumCallsPerCallGroup: "1",
        includesCallsInRecents: true,
      },
      android: {
        alertTitle:       "Permissions required",
        alertDescription: "PRaww+ needs access to manage phone calls",
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
      // Queue the answer UUID so VoipEngine auto-answers once the SIP INVITE
      // arrives (handles the app-woken-from-push case).
      voipEngine.queueAnswer(callUUID);
      // The actual answerIncomingCall() call is made by the CallContext listener
      // below (via listeners.forEach).  Calling it here as well would cause a
      // double-answer race that can corrupt the JsSIP session state.
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
            voipEngine.queueAnswer(callUUID);
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
    // Ensure the next SIP INVITE reuses this UUID so UI + CallKeep align.
    voipEngine.setPendingIncomingCall(uuid, handle);
    voipEngine.startIncomingGraceTimeout(45_000, (timedOutUuid) => {
      try {
        RNCallKeep.endCall(timedOutUuid);
      } catch {}
    });
    RNCallKeep.displayIncomingCall(uuid, handle, displayName, "number", false);
  },

  reportCallConnected(uuid: string): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    RNCallKeep.reportConnectedOutgoingCallWithUUID(uuid);
  },

  endCall(uuid: string): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    RNCallKeep.endCall(uuid);
  },

  endAllCalls(): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    RNCallKeep.endAllCalls();
  },

  reportCallEnded(uuid: string): void {
    const RNCallKeep = getRNCallKeep();
    if (!RNCallKeep) return;
    RNCallKeep.reportEndCallWithUUID(uuid, 2);
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
    RNCallKeep.removeEventListener("answerCall");
    RNCallKeep.removeEventListener("endCall");
    RNCallKeep.removeEventListener("didActivateAudioSession");
    RNCallKeep.removeEventListener("didDeactivateAudioSession");
    RNCallKeep.removeEventListener("didLoadWithEvents");
  },
};
