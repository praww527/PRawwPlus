/**
 * FreeSWITCH SIP/WebSocket client for the web browser.
 *
 * Uses JsSIP over wss://APP/api/sip/ws (proxied to FreeSWITCH mod_sofia on
 * port 5066) so the browser registers as a standard SIP UA alongside the
 * existing Verto registration.  The dialplan already dials both legs
 * simultaneously:
 *   verto_contact(N@domain)  — Verto/WebRTC
 *   user/N@domain            — SIP/WS  ← this client provides the registration
 *
 * Incoming-call handling only: outgoing calls continue to go via the Verto
 * client → callOrchestrator (originate) path so billing, ESL, and DB records
 * are unaffected.
 *
 * Deduplication: if the Verto client already delivered the incoming call to
 * the app (callState !== "idle"), the SIP INVITE is immediately rejected with
 * 486 Busy Here so only one ring UI is shown to the user.
 */

import JsSIP from "jssip";
import type { RTCSession } from "jssip/lib/RTCSession";
import type { UAConfiguration } from "jssip/lib/UA";

export interface SipConfig {
  sipWsUrl:  string;
  domain:    string;
  extension: number;
  sipUri:    string;
  password:  string;
  configured: boolean;
  iceServers?: RTCIceServer[];
}

export interface SipCallbacks {
  onRegistered:   () => void;
  onUnregistered: () => void;
  onError:        (msg: string) => void;
  /** Incoming call — return true to accept, false to reject silently */
  onIncoming: (
    session:      RTCSession,
    callId:       string,
    callerNumber: string,
    sdp:          string,
  ) => boolean;
  onHangup:   (callId: string, cause: string) => void;
}

const REGISTER_EXPIRES = 300;       // 5 minutes
const RE_REGISTER_MS   = 250_000;   // re-register 50 s before expiry
const RECONNECT_BASE   = 5_000;
const RECONNECT_MAX    = 120_000;

/** Prefer Opus; Telephone-event MUST stay in the list for DTMF RFC 2833. */
function preferOpusSdp(sdp: string): string {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (!m) return sdp;
  const pt = m[1];
  return sdp.replace(
    /^(m=audio\s+\d+\s+\S+)([ \t\d]+)/m,
    (_all: string, prefix: string, payloads: string) => {
      const pts = payloads.trim().split(/\s+/);
      return `${prefix} ${[pt, ...pts.filter((p: string) => p !== pt)].join(" ")}`;
    },
  );
}

export class SipClient {
  private ua:               JsSIP.UA | null = null;
  private destroyed         = false;
  private reconnectTimer:   ReturnType<typeof setTimeout> | null = null;
  private reRegisterTimer:  ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt  = 0;
  private activeSession:    RTCSession | null = null;

  constructor(
    private config:    SipConfig,
    private callbacks: SipCallbacks,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  start() {
    if (!this.config.configured || !this.config.sipWsUrl) {
      this.callbacks.onError("SIP not configured — set FREESWITCH_DOMAIN");
      return;
    }
    if (this.ua) return;
    this.createAndStart();
  }

  stop() {
    this.destroyed = true;
    this.clearTimers();
    if (this.ua) {
      try { this.ua.stop(); } catch { /* ignore */ }
      this.ua = null;
    }
  }

  hangupActive(cause = "NORMAL_CLEARING") {
    if (this.activeSession) {
      try {
        this.activeSession.terminate({ status_code: 487, reason_phrase: cause });
      } catch { /* ignore */ }
      this.activeSession = null;
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private createAndStart() {
    const socket = new JsSIP.WebSocketInterface(this.config.sipWsUrl);

    const uaCfg: UAConfiguration = {
      sockets:          [socket],
      uri:              this.config.sipUri,
      password:         this.config.password,
      register:         true,
      register_expires: REGISTER_EXPIRES,
      contact_uri:      `sip:${this.config.extension}@${this.config.domain};transport=ws`,
      user_agent:       "PRaww+WebSIP/1.0",
    };

    let ua: JsSIP.UA;
    try {
      ua = new JsSIP.UA(uaCfg);
    } catch (err) {
      this.callbacks.onError(`SIP UA creation failed: ${(err as Error)?.message}`);
      return;
    }

    ua.on("registered", () => {
      console.info("[SIP] Registered with FreeSWITCH");
      this.reconnectAttempt = 0;
      this.callbacks.onRegistered();
      this.scheduleReRegister(ua);
    });

    ua.on("unregistered", () => {
      console.info("[SIP] Unregistered");
      this.callbacks.onUnregistered();
    });

    ua.on("registrationFailed", (data: any) => {
      const cause = (data?.cause as string | undefined) ?? "unknown";
      console.warn("[SIP] Registration failed:", cause);
      this.callbacks.onError(`SIP registration failed: ${cause}`);
    });

    ua.on("disconnected", () => {
      console.warn("[SIP] WebSocket disconnected");
      this.callbacks.onUnregistered();
      if (!this.destroyed) this.scheduleReconnect();
    });

    ua.on("connected", () => {
      console.info("[SIP] WebSocket connected");
    });

    ua.on("newRTCSession", (data: { session: RTCSession; originator: string }) => {
      const { session, originator } = data;
      if (originator !== "remote") return;   // outgoing — handled by Verto

      const from = session.remote_identity?.uri?.user ?? "unknown";
      const callId = session.id;
      const sdp = (session as any).request?.body ?? "";
      const patchedSdp = preferOpusSdp(sdp);

      console.info("[SIP] Incoming INVITE from", from, "id", callId);

      const accept = this.callbacks.onIncoming(session, callId, from, patchedSdp);

      if (!accept) {
        try {
          session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
        } catch { /* ignore */ }
        console.info("[SIP] Rejected incoming call (Verto already handling or busy)");
        return;
      }

      this.activeSession = session;

      session.on("ended", (ev: any) => {
        const cause = ev?.cause ?? "NORMAL_CLEARING";
        console.info("[SIP] Session ended:", cause);
        this.activeSession = null;
        this.callbacks.onHangup(callId, cause);
      });

      session.on("failed", (ev: any) => {
        const cause = ev?.cause ?? "CALL_FAILED";
        console.warn("[SIP] Session failed:", cause);
        this.activeSession = null;
        this.callbacks.onHangup(callId, cause);
      });

      // Answer the call with WebRTC
      const pcConfig: RTCConfiguration = {
        iceServers: this.config.iceServers ?? [
          { urls: "stun:stun.l.google.com:19302" },
        ],
      };

      session.answer({
        pcConfig,
        mediaConstraints: { audio: true, video: false },
        sessionTimersExpires: 120,
      } as any);
    });

    this.ua = ua;
    ua.start();
  }

  private scheduleReRegister(ua: JsSIP.UA) {
    if (this.reRegisterTimer) clearInterval(this.reRegisterTimer);
    this.reRegisterTimer = setInterval(() => {
      if (ua.isRegistered()) {
        try { ua.register(); } catch { /* ignore */ }
      }
    }, RE_REGISTER_MS);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempt++;
    const delay = Math.min(
      RECONNECT_BASE * Math.pow(2, this.reconnectAttempt - 1),
      RECONNECT_MAX,
    );
    console.info(`[SIP] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      if (this.destroyed) return;
      if (this.ua) {
        try { this.ua.stop(); } catch { /* ignore */ }
        this.ua = null;
      }
      this.createAndStart();
    }, delay);
  }

  private clearTimers() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.reRegisterTimer) { clearInterval(this.reRegisterTimer); this.reRegisterTimer = null; }
  }
}
