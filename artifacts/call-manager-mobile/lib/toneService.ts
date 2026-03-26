/**
 * ITU-T Call Progress Tone Service
 *
 * Wraps react-native-incall-manager to play/stop standard call
 * progress tones (ringback, ringtone) and manage in-call audio routing.
 *
 * Busy/congestion/SIT tones are delivered as early media by FreeSWITCH
 * over the WebRTC channel — no local playback needed for those.
 */

import { Platform } from "react-native";

let InCallManager: any = null;

function getICM() {
  if (!InCallManager) {
    try {
      InCallManager = require("react-native-incall-manager").default;
    } catch {
      console.warn("[ToneService] react-native-incall-manager not available");
    }
  }
  return InCallManager;
}

export const toneService = {
  /**
   * Start in-call audio session (called when call is accepted / answered).
   * Disables proximity sensor, routes audio to earpiece by default.
   */
  startCallAudio(): void {
    const icm = getICM();
    if (!icm) return;
    try {
      icm.start({ media: "audio", auto: false, ringback: "" });
    } catch (e) {
      console.warn("[ToneService] startCallAudio error", e);
    }
  },

  /**
   * Stop in-call audio session and restore device defaults.
   * @param busytone - play a busy tone before stopping ('_BUNDLE_' | '_DEFAULT_' | '')
   */
  stopCallAudio(busytone: "_BUNDLE_" | "_DEFAULT_" | "" = ""): void {
    const icm = getICM();
    if (!icm) return;
    try {
      icm.stop({ busytone });
    } catch (e) {
      console.warn("[ToneService] stopCallAudio error", e);
    }
  },

  /**
   * ITU-T ringback tone — played locally while waiting for the callee to answer.
   * This is the standard 1s-on / 4s-off cadence (approximated by the OS/bundle).
   * FreeSWITCH replaces it with its own early-media ringback once the connection
   * reaches the far end.
   */
  startRingback(): void {
    const icm = getICM();
    if (!icm) return;
    try {
      icm.startRingback("_BUNDLE_");
    } catch (e) {
      console.warn("[ToneService] startRingback error", e);
    }
  },

  stopRingback(): void {
    const icm = getICM();
    if (!icm) return;
    try {
      icm.stopRingback();
    } catch (e) {
      console.warn("[ToneService] stopRingback error", e);
    }
  },

  /**
   * ITU-T incoming ringtone — played while the device is ringing.
   * Uses system default ringtone on Android, CallKit handles it on iOS.
   */
  startRingtone(): void {
    const icm = getICM();
    if (!icm) return;
    try {
      if (Platform.OS === "android") {
        icm.startRingtone("_DEFAULT_");
      }
      // On iOS, CallKit plays the system ringtone automatically.
    } catch (e) {
      console.warn("[ToneService] startRingtone error", e);
    }
  },

  stopRingtone(): void {
    const icm = getICM();
    if (!icm) return;
    try {
      icm.stopRingtone();
    } catch (e) {
      console.warn("[ToneService] stopRingtone error", e);
    }
  },

  /**
   * Route audio to speaker or earpiece.
   */
  setSpeaker(enabled: boolean): void {
    const icm = getICM();
    if (!icm) return;
    try {
      icm.setSpeakerphoneOn(enabled);
    } catch (e) {
      console.warn("[ToneService] setSpeaker error", e);
    }
  },

  /**
   * Mute/unmute the microphone at the OS level.
   */
  setMicMute(muted: boolean): void {
    const icm = getICM();
    if (!icm) return;
    try {
      icm.setMicrophoneMute(muted);
    } catch (e) {
      console.warn("[ToneService] setMicMute error", e);
    }
  },
};
