/**
 * VoIP Engine — JsSIP over SIP/WebSocket + react-native-webrtc
 *
 * Production implementation supporting:
 *  - SIP UA lifecycle (register/unregister)
 *  - Outgoing and incoming calls
 *  - Call hold / unhold (RFC 3264)
 *  - DTMF (RFC 2833 + INFO)
 *  - Call waiting (multiple sessions)
 *  - No-answer timeout
 *  - Full SIP cause → human-readable error mapping
 *  - InCallManager audio routing integration
 *  - WebRTC audio stream management
 */

declare var global: typeof globalThis;

import { UA, WebSocketInterface } from "jssip";
import type { RTCSession } from "jssip/lib/RTCSession";
import type { UAConfiguration } from "jssip/lib/UA";
import { DTMF_TRANSPORT } from "jssip/lib/Constants";
import { v4 as uuidv4 } from "uuid";
import { toneService } from "./toneService";
import { getBaseUrl } from "../api";

// Lazily resolve react-native-webrtc (not available in Expo Go)
let _rnWebRTC: any = null;
function getRNWebRTC(): any {
  if (_rnWebRTC) return _rnWebRTC;
  try {
    _rnWebRTC = require("react-native-webrtc");
  } catch {
    console.warn("[VoIP] react-native-webrtc not available (Expo Go). VoIP calls disabled.");
    _rnWebRTC = {};
  }
  return _rnWebRTC;
}

/** False in Expo Go and other environments without native WebRTC. */
export function isWebRtcAvailable(): boolean {
  const { mediaDevices, RTCPeerConnection } = getRNWebRTC();
  return Boolean(mediaDevices?.getUserMedia && RTCPeerConnection);
}

// Polyfill globals for JsSIP (expects browser environment)
// Only runs when react-native-webrtc is available (i.e. development build)
try {
  const webRTC = require("react-native-webrtc");
  if (typeof global !== "undefined") {
    (global as any).RTCPeerConnection     = webRTC.RTCPeerConnection;
    (global as any).RTCIceCandidate       = webRTC.RTCIceCandidate;
    (global as any).RTCSessionDescription = webRTC.RTCSessionDescription;
  }
} catch {
  // Expo Go — WebRTC polyfill unavailable, VoIP will not function
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type CallState =
  | "idle"
  | "registering"
  | "registered"
  | "calling"
  | "ringing"
  | "in-call"
  | "on-hold"
  | "ending"
  | "error";

export interface VoipCredentials {
  extension: string;
  password:  string;
  domain:    string;
  iceServers?: { urls: string | string[]; username?: string; credential?: string }[];
  sipWsUrl?: string;
}

export interface CallInfo {
  uuid:         string;
  remoteNumber: string;
  direction:    "inbound" | "outbound";
  startedAt:    Date;
}

export interface WaitingCall {
  session:     RTCSession;
  fromNumber:  string;
  uuid:        string;
}

type VoipEventMap = {
  stateChange:    (state: CallState) => void;
  incomingCall:   (session: RTCSession, from: string, uuid: string) => void;
  waitingCall:    (info: WaitingCall) => void;
  callConnected:  (info: CallInfo) => void;
  callEnded:      (reason: string, friendlyReason: string) => void;
  error:          (message: string) => void;
};

// ─── SIP Cause → User-Friendly Message mapping ────────────────────────────────

const SIP_CAUSE_MESSAGES: Record<string, string> = {
  // Standard JsSIP causes
  "Busy":                  "The number you called is currently busy.",
  "Rejected":              "Call was declined by the other party.",
  "Not Found":             "The number you dialed does not exist.",
  "Unavailable":           "The user is currently unavailable.",
  "Address Incomplete":    "The number entered is incomplete or invalid.",
  "Authentication Error":  "Authentication failed. Please check your credentials.",
  "Connection Error":      "Network connection error. Please check your internet.",
  "Canceled":              "Call was cancelled.",
  "No Answer":             "No answer — the call was not picked up.",
  "Expires":               "Call attempt timed out.",
  "No Ack":                "Call setup failed — network issue.",
  "Dialog Error":          "Call failed — please try again.",
  "Request Timeout":       "Call timed out — no response from the server.",
  "SIP Failure Code":      "The call could not be completed.",
  "RTP Timeout":           "Call dropped — audio stream lost.",
  "User Denied Media Access": "Microphone access denied. Please enable it in Settings.",
  "WebRTC Not Supported":  "WebRTC is not supported on this device.",
  "WebRTC Error":          "A WebRTC error occurred.",
  "Bad Media Description": "Incompatible media format.",
  "Missing SDP":           "Call setup error — missing media description.",

  // FreeSWITCH hangup causes (received via SIP reason header)
  "USER_BUSY":             "The number you called is currently busy.",
  "NO_ANSWER":             "No answer — the call was not picked up.",
  "ORIGINATOR_CANCEL":     "Call cancelled.",
  "NORMAL_CLEARING":       "Call ended.",
  "UNREGISTERED":          "The number is currently offline.",
  "USER_NOT_REGISTERED":   "The user is not registered.",
  "SUBSCRIBER_ABSENT":     "The number is unavailable.",
  "NO_ROUTE_DESTINATION":  "The number you dialed does not exist.",
  "DESTINATION_OUT_OF_ORDER": "The destination is currently unreachable.",
  "CALL_REJECTED":         "Call was rejected.",
  "INCOMPATIBLE_DESTINATION": "Incompatible destination.",
  "RECOVERY_ON_TIMER_EXPIRE": "Call attempt timed out.",
  "MEDIA_TIMEOUT":         "Call dropped — audio connection lost.",
  "NETWORK_OUT_OF_ORDER":  "Network error — please check your connection.",
  "BEARER_CAPABILITY_NOT_AUTHORIZED": "Call barred — not authorised.",
  "FACILITY_NOT_SUBSCRIBED": "Service not subscribed.",
  "OUTGOING_CALL_BARRED":  "Outgoing calls are barred on this account.",
  "INCOMING_CALL_BARRED":  "Incoming calls are barred.",
  "INSUFFICIENT_FUNDS":    "Insufficient funds to complete the call.",
};

function friendlyReason(cause: string): string {
  if (!cause) return "Call ended.";
  return SIP_CAUSE_MESSAGES[cause] ?? `Call ended (${cause}).`;
}

// ─── SIP WS URL ───────────────────────────────────────────────────────────────

function deriveSipWsUrl(): string {
  const base = getBaseUrl();
  return base
    .replace(/^https:\/\//, "wss://")
    .replace(/^http:\/\//, "ws://") + "/api/sip/ws";
}

// ─── No-answer timeout ────────────────────────────────────────────────────────

const NO_ANSWER_TIMEOUT_MS = 30_000;

// ─── VoipEngine class ─────────────────────────────────────────────────────────

class VoipEngine {
  private ua:              UA | null = null;
  private session:         RTCSession | null = null;
  private waitingSession:  WaitingCall | null = null;
  private localStream:     MediaStream | null = null;
  private remoteStream:    MediaStream | null = null;
  private state:           CallState = "idle";
  private listeners:       Partial<{ [K in keyof VoipEventMap]: VoipEventMap[K][] }> = {};
  private credentials:     VoipCredentials | null = null;
  private currentCallInfo: CallInfo | null = null;
  private noAnswerTimer:   ReturnType<typeof setTimeout> | null = null;
  private isHeld:          boolean = false;

  // CallKeep/FCM → SIP synchronization
  private pendingIncoming:
    | { uuid: string; from?: string; ts: number }
    | null = null;
  private pendingAnswerUuid: string | null = null;
  private pendingIncomingTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Event emitter ──

  on<K extends keyof VoipEventMap>(event: K, listener: VoipEventMap[K]) {
    if (!this.listeners[event]) this.listeners[event] = [];
    (this.listeners[event] as VoipEventMap[K][]).push(listener);
  }

  off<K extends keyof VoipEventMap>(event: K, listener: VoipEventMap[K]) {
    const arr = this.listeners[event] as VoipEventMap[K][] | undefined;
    if (!arr) return;
    const idx = arr.indexOf(listener);
    if (idx !== -1) arr.splice(idx, 1);
  }

  private emit<K extends keyof VoipEventMap>(event: K, ...args: Parameters<VoipEventMap[K]>) {
    const arr = this.listeners[event] as ((...a: Parameters<VoipEventMap[K]>) => void)[] | undefined;
    arr?.forEach((fn) => fn(...args));
  }

  private setState(state: CallState) {
    this.state = state;
    this.emit("stateChange", state);
  }

  // ── Accessors ──

  getState(): CallState             { return this.state; }
  getLocalStream():  MediaStream | null { return this.localStream; }
  getRemoteStream(): MediaStream | null { return this.remoteStream; }
  getCurrentCall():  CallInfo | null    { return this.currentCallInfo; }
  getWaitingCall():  WaitingCall | null { return this.waitingSession; }
  isOnHold():        boolean            { return this.isHeld; }

  // ── Register / Unregister ──

  async register(creds: VoipCredentials): Promise<void> {
    if (this.ua) await this.unregister();

    this.credentials = creds;
    this.setState("registering");

    const wsUrl  = creds.sipWsUrl?.trim() ? creds.sipWsUrl.trim() : deriveSipWsUrl();
    const socket = new WebSocketInterface(wsUrl);

    const config: UAConfiguration & { pcConfig?: { iceServers: any[] } } = {
      sockets:          [socket],
      uri:              `sip:${creds.extension}@${creds.domain}`,
      password:         creds.password,
      display_name:     creds.extension,
      register:         true,
      register_expires: 300,
      session_timers:   false,
      pcConfig: {
        iceServers: (creds.iceServers && Array.isArray(creds.iceServers) && creds.iceServers.length > 0)
          ? creds.iceServers
          : [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
      },
    };

    this.ua = new UA(config as any);

    this.ua.on("registered", () => {
      this.setState("registered");
    });

    this.ua.on("unregistered", () => {
      if (this.state !== "idle") this.setState("idle");
    });

    this.ua.on("registrationFailed", (e: any) => {
      this.setState("error");
      this.emit("error", `Registration failed: ${e?.cause ?? "unknown"}`);
    });

    this.ua.on("newRTCSession", (data: any) => {
      const session: RTCSession = data.session;
      this.handleNewSession(session);
    });

    this.ua.start();
  }

  async unregister(): Promise<void> {
    this.clearNoAnswerTimer();
    this.session?.terminate();
    this.session = null;
    this.ua?.stop();
    this.ua = null;
    this.clearPendingIncoming();
    this.pendingAnswerUuid = null;
    this.stopLocalStream();
    toneService.stopCallAudio();
    toneService.stopRingback();
    toneService.stopRingtone();
    this.setState("idle");
  }

  // ── Session handling ──

  private handleNewSession(session: RTCSession) {
    if (session.direction === "incoming") {
      const fromNum = session.remote_identity?.uri?.user
        ?? session.remote_identity?.uri?.toString()
        ?? "Unknown";
      let uuid = uuidv4();
      if (this.pendingIncoming && Date.now() - this.pendingIncoming.ts < 45_000) {
        const matchFrom = this.pendingIncoming.from ? this.pendingIncoming.from === fromNum : true;
        if (matchFrom) {
          uuid = this.pendingIncoming.uuid;
          this.clearPendingIncoming();
        }
      }

      // If already in a call, emit as waiting call
      if (this.state === "in-call" || this.state === "on-hold") {
        this.waitingSession = { session, fromNumber: fromNum, uuid };
        this.emit("waitingCall", this.waitingSession);

        session.on("ended",  () => { if (this.waitingSession?.uuid === uuid) this.waitingSession = null; });
        session.on("failed", () => { if (this.waitingSession?.uuid === uuid) this.waitingSession = null; });
        return;
      }

      this.session = session;
      this.setState("ringing");
      toneService.startRingtone();
      this.emit("incomingCall", session, fromNum, uuid);

      // If user answered from CallKeep before SIP INVITE arrived, auto-answer now.
      if (this.pendingAnswerUuid && this.pendingAnswerUuid === uuid) {
        this.pendingAnswerUuid = null;
        this.answerIncomingCall().catch((e) => console.warn("[VoIP] auto-answer failed", e));
      }

      session.on("accepted", () => {
        toneService.stopRingtone();
        toneService.startCallAudio();
        this.currentCallInfo = {
          uuid,
          remoteNumber: fromNum,
          direction: "inbound",
          startedAt: new Date(),
        };
        this.isHeld = false;
        this.setState("in-call");
        this.emit("callConnected", this.currentCallInfo);
      });

      session.on("ended",  (e: any) => {
        toneService.stopRingtone();
        this.handleSessionEnd(session, e?.cause ?? "ended");
      });
      session.on("failed", (e: any) => {
        toneService.stopRingtone();
        this.handleSessionEnd(session, e?.cause ?? "failed");
      });

      session.on("peerconnection", (data: any) => {
        this.wireRemoteStream(data.peerconnection);
      });
    }
  }

  /** Called by CallKeep/FCM path so the next SIP INVITE reuses this UUID. */
  setPendingIncomingCall(uuid: string, from?: string) {
    if (!uuid?.trim()) return;
    this.pendingIncoming = { uuid: uuid.trim(), from: from?.trim(), ts: Date.now() };
  }

  /** Called when user answers in CallKeep before SIP INVITE is present. */
  queueAnswer(uuid: string) {
    if (!uuid?.trim()) return;
    this.pendingAnswerUuid = uuid.trim();
  }

  startIncomingGraceTimeout(ms: number, onTimeout: (uuid: string) => void) {
    if (!this.pendingIncoming) return;
    const { uuid } = this.pendingIncoming;
    if (this.pendingIncomingTimer) clearTimeout(this.pendingIncomingTimer);
    this.pendingIncomingTimer = setTimeout(() => {
      const stillPending = this.pendingIncoming?.uuid === uuid;
      if (!stillPending) return;
      this.clearPendingIncoming();
      if (this.pendingAnswerUuid === uuid) this.pendingAnswerUuid = null;
      onTimeout(uuid);
    }, ms);
  }

  private clearPendingIncoming() {
    this.pendingIncoming = null;
    if (this.pendingIncomingTimer) {
      clearTimeout(this.pendingIncomingTimer);
      this.pendingIncomingTimer = null;
    }
  }

  // ── Outgoing call ──

  /**
   * @param channelUuid Optional stable UUID for CallKit + POST /calls fsCallId.
   *                    When omitted, a new uuid is generated (legacy).
   * @param callRecordId Mongo Call._id — sent as SIP header so ESL can link fsCallId to FS A-leg.
   */
  async makeCall(destination: string, channelUuid?: string, callRecordId?: string | null): Promise<void> {
    if (!this.ua || this.state !== "registered") {
      throw new Error("Not registered — cannot make call");
    }

    this.setState("calling");
    toneService.startRingback();

    const localStream = await this.getLocalAudioStream();
    this.localStream  = localStream;

    const extraHeaders: string[] = [];
    if (callRecordId?.trim()) {
      extraHeaders.push(`X-PRaww-Call-Record-Id: ${callRecordId.trim()}`);
    }

    const callOptions = {
      mediaStream:       localStream,
      mediaConstraints:  { audio: true, video: false },
      extraHeaders,
      pcConfig: {
        iceServers: (this.credentials?.iceServers && this.credentials.iceServers.length > 0)
          ? this.credentials.iceServers
          : [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
      },
    };

    const session = this.ua.call(
      `sip:${destination}@${this.credentials?.domain}`,
      callOptions as any,
    ) as RTCSession;

    this.session = session;
    const uuid   = channelUuid ?? uuidv4();

    // No-answer timeout — only fires if still in calling/ringing state.
    // Use uppercase "NO_ANSWER" to match the FreeSWITCH cause convention so
    // CallContext.onEnded correctly maps this to status "missed" (not "failed").
    this.startNoAnswerTimer(() => {
      if (this.state === "calling" || this.state === "ringing") {
        session.terminate({ status_code: 408, reason_phrase: "No Answer" });
        toneService.stopRingback();
        this.handleSessionEnd(session, "NO_ANSWER");
      }
    });

    session.on("progress", (e: any) => {
      const statusCode: number | undefined = e?.response?.status_code;
      const hasBody = Boolean(e?.response?.body);

      if (statusCode === 180) {
        // 180 Ringing — remote is alerting, transition UI to ringing state.
        // Keep local ringback playing; the remote side has not sent audio yet.
        this.setState("ringing");
      } else if (statusCode === 183 && hasBody) {
        // 183 Session Progress with SDP — FreeSWITCH early media.
        // Switch from local ringback tone to the remote audio stream.
        toneService.stopRingback();
      }
    });

    session.on("accepted", () => {
      this.clearNoAnswerTimer();
      toneService.stopRingback();
      toneService.startCallAudio();
      this.currentCallInfo = {
        uuid,
        remoteNumber: destination,
        direction: "outbound",
        startedAt: new Date(),
      };
      this.isHeld = false;
      this.setState("in-call");
      this.emit("callConnected", this.currentCallInfo);
    });

    session.on("ended", (e: any) => {
      this.clearNoAnswerTimer();
      toneService.stopRingback();
      this.handleSessionEnd(session, e?.cause ?? "ended");
    });

    session.on("failed", (e: any) => {
      this.clearNoAnswerTimer();
      toneService.stopRingback();
      this.handleSessionEnd(session, e?.cause ?? "failed");
    });

    session.on("peerconnection", (data: any) => {
      this.wireRemoteStream(data.peerconnection);
    });
  }

  // ── Answer / Reject ──

  async answerIncomingCall(): Promise<void> {
    if (!this.session || this.session.direction !== "incoming") return;

    toneService.stopRingtone();

    const localStream = await this.getLocalAudioStream();
    this.localStream  = localStream;

    this.session.answer({
      mediaStream:      localStream as any,
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers: (this.credentials?.iceServers && this.credentials.iceServers.length > 0)
          ? this.credentials.iceServers
          : [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
      },
    });
  }

  rejectIncomingCall(statusCode = 603): void {
    if (!this.session || this.session.direction !== "incoming") return;
    toneService.stopRingtone();
    this.session.terminate({ status_code: statusCode, reason_phrase: "Decline" });
  }

  hangup(): void {
    if (!this.session) return;
    try {
      this.session.terminate();
    } catch {}
  }

  // ── Hold / Unhold ──

  hold(): void {
    if (!this.session || this.state !== "in-call") return;
    try {
      this.session.hold();
      this.isHeld = true;
      this.setState("on-hold");
    } catch (e) {
      console.warn("[VoIP] hold error", e);
    }
  }

  unhold(): void {
    if (!this.session || this.state !== "on-hold") return;
    try {
      this.session.unhold();
      this.isHeld = false;
      this.setState("in-call");
    } catch (e) {
      console.warn("[VoIP] unhold error", e);
    }
  }

  // ── DTMF ──

  sendDTMF(digit: string): void {
    if (!this.session) return;
    try {
      this.session.sendDTMF(digit, {
        transportType: DTMF_TRANSPORT.RFC2833,
        duration: 100,
        interToneGap: 70,
      });
    } catch (e) {
      console.warn("[VoIP] DTMF error", e);
    }
  }

  // ── Call waiting: answer waiting call (swaps sessions) ──

  async answerWaitingCall(): Promise<void> {
    if (!this.waitingSession) return;

    const { session, fromNumber, uuid } = this.waitingSession;
    this.waitingSession = null;

    // Null out this.session and point it to the new session BEFORE terminating
    // the old one. This way, when the old session's "ended" event fires and
    // calls handleSessionEnd, the session reference mismatch tells it to skip
    // the state reset — we already have a new active call.
    const oldSession = this.session;
    this.session = session;
    if (oldSession) {
      try { oldSession.terminate(); } catch {}
    }

    const localStream = await this.getLocalAudioStream();
    this.localStream  = localStream;

    session.answer({
      mediaStream:      localStream as any,
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    });

    this.currentCallInfo = {
      uuid,
      remoteNumber: fromNumber,
      direction: "inbound",
      startedAt: new Date(),
    };
    this.isHeld = false;
    this.setState("in-call");
    this.emit("callConnected", this.currentCallInfo);
  }

  dismissWaitingCall(): void {
    if (!this.waitingSession) return;
    try {
      this.waitingSession.session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
    } catch {}
    this.waitingSession = null;
  }

  // ── Mute / Speaker ──

  muteMicrophone(muted: boolean): void {
    if (!this.localStream) return;
    (this.localStream as any).getAudioTracks?.()?.forEach((t: MediaStreamTrack) => {
      (t as any).enabled = !muted;
    });
    toneService.setMicMute(muted);
  }

  setSpeakerEnabled(enabled: boolean): void {
    toneService.setSpeaker(enabled);
  }

  // ── Private helpers ──

  private handleSessionEnd(endedSession: RTCSession, reason: string) {
    // If this.session already points to a different (newer) session — a call-swap
    // just occurred. Only clean up audio; do NOT reset state or emit callEnded,
    // as the new call is already active.
    if (this.session && this.session !== endedSession) {
      toneService.stopRingback();
      toneService.stopRingtone();
      return;
    }

    toneService.stopCallAudio();
    toneService.stopRingback();
    toneService.stopRingtone();
    this.stopLocalStream();
    this.session         = null;
    this.remoteStream    = null;
    this.currentCallInfo = null;
    this.isHeld          = false;
    const prevState = this.state;
    this.setState(this.credentials ? "registered" : "idle");
    if (prevState !== "idle") {
      this.emit("callEnded", reason, friendlyReason(reason));
    }
  }

  private wireRemoteStream(pc: any) {
    (pc as any).addEventListener("track", (event: any) => {
      const streams: any[] = event.streams;
      if (streams?.length) {
        this.remoteStream = streams[0];
      } else if (event.track) {
        if (!this.remoteStream) {
          const { MediaStream: RNMediaStream } = getRNWebRTC();
          if (RNMediaStream) {
            this.remoteStream = new RNMediaStream([event.track]);
          }
        } else {
          (this.remoteStream as any).addTrack(event.track);
        }
      }
    });
  }

  private async getLocalAudioStream(): Promise<any> {
    const { mediaDevices } = getRNWebRTC();
    if (!mediaDevices) throw new Error("react-native-webrtc not available");
    const stream = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      } as any,
      video: false,
    });
    return stream;
  }

  private stopLocalStream() {
    if (this.localStream) {
      (this.localStream as any).getTracks?.()?.forEach((t: MediaStreamTrack) => t.stop());
      this.localStream = null;
    }
  }

  private startNoAnswerTimer(cb: () => void) {
    this.clearNoAnswerTimer();
    this.noAnswerTimer = setTimeout(cb, NO_ANSWER_TIMEOUT_MS);
  }

  private clearNoAnswerTimer() {
    if (this.noAnswerTimer) {
      clearTimeout(this.noAnswerTimer);
      this.noAnswerTimer = null;
    }
  }
}

export const voipEngine = new VoipEngine();

/** False in Expo Go — `react-native-webrtc` is not bundled. Use a dev or production native build. */
export function isVoipMediaSupported(): boolean {
  try {
    const w = require("react-native-webrtc") as {
      mediaDevices?: { getUserMedia?: unknown };
    };
    return typeof w?.mediaDevices?.getUserMedia === "function";
  } catch {
    return false;
  }
}
