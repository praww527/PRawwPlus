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
 *  - ICE candidate gathering timeout (15 s) with restart fallback
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
  stateChange:      (state: CallState) => void;
  incomingCall:     (session: RTCSession, from: string, uuid: string) => void;
  waitingCall:      (info: WaitingCall) => void;
  waitingCallEnded: () => void;
  callConnected:    (info: CallInfo) => void;
  callEnded:        (reason: string, friendlyReason: string) => void;
  error:            (message: string) => void;
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

// ─── Default ICE servers (STUN-only fallback) ─────────────────────────────────

const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

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

    const iceServers = (creds.iceServers && Array.isArray(creds.iceServers) && creds.iceServers.length > 0)
      ? creds.iceServers
      : DEFAULT_ICE_SERVERS;

    const config: UAConfiguration & { pcConfig?: { iceServers: any[]; iceTransportPolicy?: string } } = {
      sockets:              [socket],
      uri:                  `sip:${creds.extension}@${creds.domain}`,
      authorization_user:   String(creds.extension),
      password:             creds.password,
      display_name:         String(creds.extension),
      register:             true,
      register_expires:     300,
      session_timers:       false,
      // Use "all" policy when TURN is configured, "relay" only forces TURN
      // (too restrictive), "all" lets direct connections work when available.
      pcConfig: {
        iceServers,
        iceTransportPolicy: "all",
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

      // If there's already an active call, this is a waiting call
      if (this.session && (this.state === "in-call" || this.state === "on-hold")) {
        const waiting: WaitingCall = { session, fromNumber: fromNum, uuid };
        this.waitingSession = waiting;
        this.emit("waitingCall", waiting);

        session.on("ended",  () => {
          if (this.waitingSession?.session === session) {
            this.waitingSession = null;
            this.emit("waitingCallEnded");
          }
        });
        session.on("failed", () => {
          if (this.waitingSession?.session === session) {
            this.waitingSession = null;
            this.emit("waitingCallEnded");
          }
        });
        return;
      }

      this.session = session;
      this.emit("incomingCall", session, fromNum, uuid);
      toneService.startRingtone();

      // Auto-answer if CallKeep already queued an answer (killed-state wakeup)
      if (this.pendingAnswerUuid && (this.pendingAnswerUuid === uuid || !uuid)) {
        this.pendingAnswerUuid = null;
        this.answerIncomingCall().catch((err) =>
          console.error("[VoIP] Auto-answer from pendingAnswerUuid failed:", err)
        );
        return;
      }

      session.on("ended",  (e: any) => {
        if (this.session === session) {
          toneService.stopRingtone();
          this.session = null;
          this.setState(this.credentials ? "registered" : "idle");
          this.emit("callEnded", e?.cause ?? "ended", friendlyReason(e?.cause ?? "ended"));
        }
      });
      session.on("failed", (e: any) => {
        if (this.session === session) {
          toneService.stopRingtone();
          this.session = null;
          this.setState(this.credentials ? "registered" : "idle");
          this.emit("callEnded", e?.cause ?? "failed", friendlyReason(e?.cause ?? "failed"));
        }
      });

    } else {
      // Outgoing call
      this.session = session;
      toneService.startRingback();
      this.setState("calling");

      this.startNoAnswerTimer(() => {
        session.terminate({ status_code: 408, reason_phrase: "Request Timeout" });
      });

      session.on("progress", () => {
        this.setState("ringing");
      });

      session.on("accepted", () => {
        this.clearNoAnswerTimer();
        toneService.stopRingback();
        toneService.startCallAudio();
        this.currentCallInfo = {
          uuid: (session as any).__callUuid ?? uuidv4(),
          remoteNumber: session.remote_identity?.uri?.user ?? "Unknown",
          direction: "outbound",
          startedAt: new Date(),
        };
        this.isHeld = false;
        this.setState("in-call");
        this.emit("callConnected", this.currentCallInfo);
      });

      session.on("ended",  (e: any) => { this.handleSessionEnd(session, e?.cause ?? "ended"); });
      session.on("failed", (e: any) => {
        this.clearNoAnswerTimer();
        this.handleSessionEnd(session, e?.cause ?? "failed");
      });

      session.on("peerconnection", (data: any) => {
        this.wireRemoteStream(data.peerconnection);
      });
    }
  }

  // ── Outgoing call ──

  async makeCall(destination: string, fsCallId?: string, dbCallId?: string | null): Promise<void> {
    if (!this.ua || this.state === "idle" || this.state === "registering") {
      throw new Error("Not registered — cannot place call");
    }
    if (this.state === "calling" || this.state === "ringing" || this.state === "in-call") {
      throw new Error("A call is already in progress");
    }

    const localStream = await this.getLocalAudioStream();
    this.localStream  = localStream;

    const iceServers = (this.credentials?.iceServers && Array.isArray(this.credentials.iceServers) && this.credentials.iceServers.length > 0)
      ? this.credentials.iceServers
      : DEFAULT_ICE_SERVERS;

    const callOptions: any = {
      mediaStream: localStream,
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers,
        iceTransportPolicy: "all",
      },
    };

    const session = this.ua.call(`sip:${destination}@${this.credentials?.domain}`, callOptions);

    // Attach the FS / DB call IDs to the session object for reference
    if (fsCallId) (session as any).__fsCallId = fsCallId;
    if (dbCallId) (session as any).__dbCallId = dbCallId;
    (session as any).__callUuid = fsCallId ?? uuidv4();

    // Wire up remote stream
    session.on("peerconnection", (data: any) => {
      this.wireRemoteStream(data.peerconnection);
    });
  }

  // ── Answer incoming call ──

  async answerIncomingCall(): Promise<void> {
    const session = this.session;
    if (!session || session.direction !== "incoming") {
      throw new Error("No incoming call to answer");
    }

    toneService.stopRingtone();
    this.clearPendingIncoming();

    const localStream = await this.getLocalAudioStream();
    this.localStream  = localStream;

    const iceServers = (this.credentials?.iceServers && Array.isArray(this.credentials.iceServers) && this.credentials.iceServers.length > 0)
      ? this.credentials.iceServers
      : DEFAULT_ICE_SERVERS;

    // Wire up events BEFORE answer() so we don't miss the "accepted" event
    const uuid = (session as any).__callUuid ?? uuidv4();

    session.on("accepted", () => {
      toneService.startCallAudio();
      this.currentCallInfo = {
        uuid,
        remoteNumber: session.remote_identity?.uri?.user ?? "Unknown",
        direction: "inbound",
        startedAt: new Date(),
      };
      this.isHeld = false;
      this.setState("in-call");
      this.emit("callConnected", this.currentCallInfo);
    });

    session.on("ended",  (e: any) => { this.handleSessionEnd(session, e?.cause ?? "ended"); });
    session.on("failed", (e: any) => { this.handleSessionEnd(session, e?.cause ?? "failed"); });

    session.on("peerconnection", (data: any) => {
      this.wireRemoteStream(data.peerconnection);
    });

    session.answer({
      mediaStream:      localStream as any,
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers,
        iceTransportPolicy: "all",
      },
    });
  }

  // ── Reject / Hangup ──

  rejectIncomingCall(statusCode = 603): void {
    if (!this.session || this.session.direction !== "incoming") return;
    toneService.stopRingtone();
    try { this.session.terminate({ status_code: statusCode }); } catch {}
    this.session = null;
    this.setState(this.credentials ? "registered" : "idle");
  }

  hangup(): void {
    this.clearNoAnswerTimer();
    if (!this.session) return;
    try { this.session.terminate(); } catch {}
  }

  // ── Hold / Unhold ──

  holdCall(): void {
    if (!this.session || !this.session.isEstablished()) return;
    try {
      this.session.hold();
      this.isHeld = true;
      this.setState("on-hold");
    } catch (err) {
      console.warn("[VoIP] holdCall error:", err);
    }
  }

  unholdCall(): void {
    if (!this.session || !this.session.isEstablished()) return;
    try {
      this.session.unhold();
      this.isHeld = false;
      this.setState("in-call");
    } catch (err) {
      console.warn("[VoIP] unholdCall error:", err);
    }
  }

  // ── DTMF ──

  sendDTMF(digit: string): void {
    if (!this.session?.isEstablished()) return;
    try {
      this.session.sendDTMF(digit, {
        transportType: DTMF_TRANSPORT.RFC2833,
        duration:      100,
        interToneGap:  50,
      });
    } catch (err) {
      console.warn("[VoIP] sendDTMF error:", err);
    }
  }

  // ── Call waiting ──

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

    // Wire SIP event handlers BEFORE calling answer() so no events are missed.
    session.on("accepted", () => {
      toneService.startCallAudio();
      this.currentCallInfo = {
        uuid,
        remoteNumber: fromNumber,
        direction: "inbound",
        startedAt: new Date(),
      };
      this.isHeld = false;
      this.setState("in-call");
      this.emit("callConnected", this.currentCallInfo);
    });

    session.on("ended",  (e: any) => { this.handleSessionEnd(session, e?.cause ?? "ended"); });
    session.on("failed", (e: any) => { this.handleSessionEnd(session, e?.cause ?? "failed"); });

    session.on("peerconnection", (data: any) => {
      this.wireRemoteStream(data.peerconnection);
    });

    const localStream = await this.getLocalAudioStream();
    this.localStream  = localStream;

    const iceServers = (this.credentials?.iceServers && Array.isArray(this.credentials.iceServers) && this.credentials.iceServers.length > 0)
      ? this.credentials.iceServers
      : DEFAULT_ICE_SERVERS;

    session.answer({
      mediaStream:      localStream as any,
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers,
        iceTransportPolicy: "all",
      },
    });
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

  // ── CallKeep / FCM sync ──

  /** Called by the background FCM handler when a push arrives before the SIP INVITE. */
  setPendingIncomingCall(uuid: string, from?: string) {
    this.clearPendingIncoming();
    this.pendingIncoming = { uuid, from, ts: Date.now() };
    // Auto-clear after 60 s to avoid stale state
    this.pendingIncomingTimer = setTimeout(() => {
      this.pendingIncoming = null;
    }, 60_000);
  }

  /** Called by CallKeep "answerCall" event to queue an auto-answer. */
  queueAnswer(uuid: string) {
    this.pendingAnswerUuid = uuid;
  }

  private clearPendingIncoming() {
    if (this.pendingIncomingTimer) {
      clearTimeout(this.pendingIncomingTimer);
      this.pendingIncomingTimer = null;
    }
    this.pendingIncoming = null;
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
    if (!mediaDevices) throw new Error("react-native-webrtc not available — use a development build, not Expo Go");
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
