/**
 * VoIP Engine — JsSIP over SIP/WebSocket + react-native-webrtc
 *
 * Handles:
 *  - SIP UA lifecycle (register/unregister)
 *  - Outgoing calls
 *  - Incoming call answer/reject
 *  - WebRTC audio stream management
 *  - Speaker/earpiece switching
 */

import {
  UA,
  WebSocketInterface,
  type RTCSession,
  type UAConfiguration,
} from "jssip";
import {
  mediaDevices,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
  type MediaStreamTrack,
} from "react-native-webrtc";
import { Platform } from "react-native";
import { getBaseUrl } from "./api";

// Polyfill globals so JsSIP works in React Native (it expects browser globals)
if (typeof global !== "undefined") {
  (global as any).RTCPeerConnection    = RTCPeerConnection;
  (global as any).RTCIceCandidate      = RTCIceCandidate;
  (global as any).RTCSessionDescription = RTCSessionDescription;
}

export type CallState =
  | "idle"
  | "registering"
  | "registered"
  | "calling"
  | "ringing"
  | "in-call"
  | "ending"
  | "error";

export interface VoipCredentials {
  extension: string;
  password:  string;
  domain:    string;
}

export interface CallInfo {
  uuid:          string;
  remoteNumber:  string;
  direction:     "inbound" | "outbound";
  startedAt:     Date;
}

type VoipEventMap = {
  stateChange:    (state: CallState) => void;
  incomingCall:   (session: RTCSession, from: string, uuid: string) => void;
  callConnected:  (info: CallInfo) => void;
  callEnded:      (reason: string) => void;
  error:          (message: string) => void;
};

function deriveSipWsUrl(): string {
  const base = getBaseUrl();
  // Replace https:// → wss:// and http:// → ws://
  return base.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://") + "/api/sip/ws";
}

class VoipEngine {
  private ua:              UA | null = null;
  private session:         RTCSession | null = null;
  private localStream:     MediaStream | null = null;
  private remoteStream:    MediaStream | null = null;
  private state:           CallState = "idle";
  private listeners:       Partial<{ [K in keyof VoipEventMap]: VoipEventMap[K][] }> = {};
  private credentials:     VoipCredentials | null = null;
  private currentCallInfo: CallInfo | null = null;

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

  getState(): CallState { return this.state; }
  getLocalStream():  MediaStream | null { return this.localStream; }
  getRemoteStream(): MediaStream | null { return this.remoteStream; }
  getCurrentCall():  CallInfo | null    { return this.currentCallInfo; }

  async register(creds: VoipCredentials): Promise<void> {
    if (this.ua) await this.unregister();

    this.credentials = creds;
    this.setState("registering");

    const wsUrl = deriveSipWsUrl();
    const socket = new WebSocketInterface(wsUrl);

    const config: UAConfiguration = {
      sockets:     [socket],
      uri:         `sip:${creds.extension}@${creds.domain}`,
      password:    creds.password,
      display_name: creds.extension,
      register:    true,
      register_expires: 300,
      session_timers: false,
      // Use react-native-webrtc's RTCPeerConnection
      pcConfig: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    };

    this.ua = new UA(config);

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
    this.session?.terminate();
    this.session = null;
    this.ua?.stop();
    this.ua = null;
    this.stopLocalStream();
    this.setState("idle");
  }

  private handleNewSession(session: RTCSession) {
    this.session = session;

    if (session.direction === "incoming") {
      const fromUri = session.remote_identity.uri.toString();
      const fromNum = session.remote_identity.uri.user ?? fromUri;
      const uuid    = `call-${Date.now()}`;

      this.setState("ringing");
      this.emit("incomingCall", session, fromNum, uuid);

      session.on("ended",   () => { this.handleSessionEnd("ended"); });
      session.on("failed",  (e: any) => { this.handleSessionEnd(e?.cause ?? "failed"); });
      session.on("accepted", () => {
        this.currentCallInfo = {
          uuid,
          remoteNumber: fromNum,
          direction: "inbound",
          startedAt: new Date(),
        };
        this.setState("in-call");
        this.emit("callConnected", this.currentCallInfo);
      });

      session.on("peerconnection", (data: any) => {
        this.wireRemoteStream(data.peerconnection);
      });
    }
  }

  async makeCall(destination: string): Promise<void> {
    if (!this.ua || this.state !== "registered") {
      throw new Error("Not registered — cannot make call");
    }

    this.setState("calling");

    const localStream = await this.getLocalAudioStream();
    this.localStream  = localStream;

    const callOptions = {
      mediaStream: localStream,
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    };

    const session = this.ua.call(
      `sip:${destination}@${this.credentials?.domain}`,
      callOptions,
    ) as RTCSession;

    this.session = session;
    const uuid   = `call-${Date.now()}`;

    session.on("progress", () => { this.setState("calling"); });
    session.on("accepted", () => {
      this.currentCallInfo = {
        uuid,
        remoteNumber: destination,
        direction: "outbound",
        startedAt: new Date(),
      };
      this.setState("in-call");
      this.emit("callConnected", this.currentCallInfo);
    });
    session.on("ended",  () => { this.handleSessionEnd("ended"); });
    session.on("failed", (e: any) => {
      this.setState("registered");
      this.handleSessionEnd(e?.cause ?? "failed");
    });
    session.on("peerconnection", (data: any) => {
      this.wireRemoteStream(data.peerconnection);
    });
  }

  async answerIncomingCall(): Promise<void> {
    if (!this.session || this.session.direction !== "incoming") return;

    const localStream = await this.getLocalAudioStream();
    this.localStream  = localStream;

    this.session.answer({
      mediaStream: localStream,
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    });
  }

  rejectIncomingCall(): void {
    if (!this.session || this.session.direction !== "incoming") return;
    this.session.terminate({ status_code: 603, reason_phrase: "Decline" });
  }

  hangup(): void {
    if (!this.session) return;
    try {
      this.session.terminate();
    } catch {}
  }

  private handleSessionEnd(reason: string) {
    this.stopLocalStream();
    this.session         = null;
    this.remoteStream    = null;
    this.currentCallInfo = null;
    const prevState = this.state;
    this.setState(this.credentials ? "registered" : "idle");
    if (prevState !== "idle") {
      this.emit("callEnded", reason);
    }
  }

  private wireRemoteStream(pc: RTCPeerConnection) {
    pc.addEventListener("track", (event: any) => {
      const streams: MediaStream[] = event.streams;
      if (streams?.length) {
        this.remoteStream = streams[0];
      } else if (event.track) {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream([event.track as MediaStreamTrack]);
        } else {
          (this.remoteStream as any).addTrack(event.track);
        }
      }
    });
  }

  private async getLocalAudioStream(): Promise<MediaStream> {
    const stream = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      },
      video: false,
    });
    return stream as unknown as MediaStream;
  }

  private stopLocalStream() {
    if (this.localStream) {
      (this.localStream as any).getTracks?.()?.forEach((t: MediaStreamTrack) => t.stop());
      this.localStream = null;
    }
  }

  setSpeakerEnabled(enabled: boolean): void {
    if (Platform.OS === "ios") {
      try {
        const InCallManager = require("react-native-incall-manager");
        InCallManager.setSpeakerphoneOn(enabled);
      } catch {}
    }
  }

  muteMicrophone(muted: boolean): void {
    if (!this.localStream) return;
    (this.localStream as any).getAudioTracks?.()?.forEach((t: MediaStreamTrack) => {
      (t as any).enabled = !muted;
    });
  }
}

export const voipEngine = new VoipEngine();
