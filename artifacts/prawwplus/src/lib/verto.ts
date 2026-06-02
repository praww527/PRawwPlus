/**
 * FreeSWITCH Verto WebRTC Client
 *
 * Protocol: JSON-RPC 2.0 over WebSocket (subprotocol "verto")
 *
 * Handshake sequence:
 *   1. Client connects → sends `login`
 *   2. Server responds to `login` with result
 *   3. Client sends `verto.clientReady` (fire-and-forget notification, no id)
 *   4. Server may push `verto.clientReady` back — treat as connected too
 *
 * Call flow (outgoing):
 *   Client sends `verto.invite` (with full gathered SDP)
 *   Server sends `verto.media`  (early media / ringing SDP) ← remote is ringing
 *   Server sends `verto.answer` (final answer SDP)          ← call connected
 *   Either side sends `verto.bye` notification to hang up
 *
 * SDP rule: remote description is set ONCE (on the first SDP we receive —
 * either verto.media or verto.answer). Subsequent SDPs are ignored unless
 * ICE needs to restart. Setting it twice causes a silent DOMException and
 * is the #1 cause of one-way or no-audio calls.
 */

export interface VertoConfig {
  wsUrl: string;
  domain: string;
  extension: number;
  login: string;      // "extension@domain"
  password: string;
  coins: number;
  configured: boolean;
  phone?: string;       // verified mobile number — used as caller-ID instead of extension
  iceServers?: RTCIceServer[];
}

export interface HangupCause {
  cause:     string;
  causeCode: number;
}

export interface VertoCallbacks {
  onIncoming:     (callId: string, callerNumber: string, sdp: string) => void;
  onRinging:      (callId: string) => void;
  onAnswer:       (callId: string, sdp: string) => void;
  onHangup:       (callId: string, hangupCause: HangupCause) => void;
  onConnected:    () => void;
  onDisconnected: () => void;
  onError:        (err: string) => void;
}

interface Pending {
  resolve: (val: unknown) => void;
  reject:  (err: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const RPC_TIMEOUT_MS      = 10_000;
const ICE_TIMEOUT_MS      = 8_000;
// Fast reconnect: this is a phone that must be reachable for incoming calls.
// Mobile browsers routinely drop the WebSocket on backgrounding / network
// transitions, so a long backoff leaves the user "unregistered" — and any call
// landing in that window goes straight to missed. Reconnect quickly after a
// transient drop; the exponential growth + cap still prevent hammering during a
// real outage, and repeated -32601 auth failures use the longer PERM pause.
const RECONNECT_BASE_MS   = 1_500;   // 1.5 s initial backoff
const RECONNECT_MAX_MS    = 15_000;  // 15 s cap
const RECONNECT_PERM_MS   = 5 * 60_000; // 5 min backoff after repeated -32601

/**
 * Rewrite the SDP offer/answer to prefer the Opus codec and enable
 * voice-optimised parameters: in-band FEC, 48 kHz, mono, generous bitrate.
 * If Opus is absent (e.g. the server didn't include it) the SDP is returned
 * unchanged so the call still works.
 */
function preferOpusCodec(sdp: string): string {
  const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (!opusMatch) return sdp;
  const pt = opusMatch[1];

  // Move Opus payload type to the front of the m=audio line.
  // IMPORTANT: use [ \t\d]+ (spaces/tabs only, NOT \s) so we never consume the
  // \r\n line ending.  If \s were used the trailing newline would be swallowed
  // and the next SDP line (e.g. "c=IN IP4 …") would be concatenated directly
  // onto the last payload type → "126c=IN" → FreeSWITCH rejects the invite
  // with "Invalid value: 126c=IN."
  sdp = sdp.replace(
    /^(m=audio\s+\d+\s+\S+)([ \t\d]+)/m,
    (_m, prefix, payloads) => {
      const pts = payloads.trim().split(/\s+/);
      const reordered = [pt, ...pts.filter((p: string) => p !== pt)];
      return `${prefix} ${reordered.join(" ")}`;
    },
  );

  // Build the fmtp line for voice quality
  const fmtp = `a=fmtp:${pt} minptime=10;useinbandfec=1;maxaveragebitrate=510000;stereo=0;maxplaybackrate=48000`;
  if (sdp.includes(`a=fmtp:${pt} `) || sdp.includes(`a=fmtp:${pt}\r`)) {
    sdp = sdp.replace(new RegExp(`a=fmtp:${pt}[^\r\n]*`), fmtp);
  } else {
    sdp = sdp.replace(
      new RegExp(`(a=rtpmap:${pt} opus/[^\r\n]*)`),
      `$1\r\n${fmtp}`,
    );
  }

  return sdp;
}

const PING_INTERVAL_MS = 15_000; // 15 s — matches proxy heartbeat; keeps WS alive on mobile networks

export class VertoClient {
  private ws:             WebSocket | null = null;
  private pc:             RTCPeerConnection | null = null;
  private localStream:    MediaStream | null = null;
  private remoteStream:   MediaStream | null = null;
  private remoteAudio:    HTMLAudioElement | null = null;
  private sessId:         string;
  private pending =       new Map<string, Pending>();
  private currentCallId:  string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer:      ReturnType<typeof setInterval> | null = null;
  private destroyed =     false;
  private reconnectAttempt = 0;          // for exponential backoff
  private permDeniedCount  = 0;         // consecutive -32601 failures
  // Track whether we have already applied the remote SDP so we never call
  // setRemoteDescription twice on the same PeerConnection.
  private remoteSdpSet =  false;

  constructor(
    private config:    VertoConfig,
    private callbacks: VertoCallbacks,
  ) {
    this.sessId = crypto.randomUUID();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  connect() {
    if (!this.config.wsUrl) {
      this.callbacks.onError("FreeSWITCH WebSocket URL not configured");
      return;
    }
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) return;

    try {
      console.log("[Verto] Connecting to", this.config.wsUrl);
      this.ws = new WebSocket(this.config.wsUrl, ["verto"]);
      this.ws.onopen    = ()  => this.handleOpen();
      this.ws.onmessage = (e) => this.handleMessage(e);
      this.ws.onclose   = (e) => this.handleClose(e);
      this.ws.onerror   = (e) => {
        console.error("[Verto] WebSocket error", e);
        this.callbacks.onError("WebSocket connection error");
      };
    } catch (err: unknown) {
      this.callbacks.onError((err as Error)?.message ?? "Failed to connect");
    }
  }

  disconnect() {
    this.destroyed = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearAllPending(new Error("Client disconnected"));
    if (this.currentCallId) {
      this.sendNotify("verto.bye", { callID: this.currentCallId, sessid: this.sessId });
    }
    this.cleanupMedia();
    this.ws?.close();
    this.ws = null;
  }

  // ─── Keepalive ping ───────────────────────────────────────────────────────

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      // Send a fire-and-forget verto.info notification with just the sessid.
      // FreeSWITCH handles it silently; the real purpose is to send a WebSocket
      // data frame so browsers and intermediary proxies don't close the idle
      // connection — which would make the callee appear unregistered.
      this.sendNotify("verto.info", { sessid: this.sessId });
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  async makeCall(to: string, presetCallId?: string): Promise<string> {
    const callId = presetCallId ?? crypto.randomUUID();
    this.currentCallId = callId;
    this.remoteSdpSet  = false;
    this.remoteStream  = null;

    try {
      const pc = await this.setupPeerConnection();

      const rawOffer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      const offer = { type: rawOffer.type, sdp: preferOpusCodec(rawOffer.sdp ?? "") };
      await pc.setLocalDescription(offer);
      await this.waitForIce(pc);

      await this.request("verto.invite", {
        callID:       callId,
        sessid:       this.sessId,
        sdp:          pc.localDescription!.sdp,
        dialogParams: this.buildDialogParams(callId, to),
      });

      return callId;
    } catch (err) {
      // Reset state so a stale callId is never used by a subsequent hangup()
      this.currentCallId = null;
      this.cleanupMedia();
      throw err;
    }
  }

  async answerCall(callId: string, remoteSdp: string): Promise<void> {
    this.remoteSdpSet  = false;
    const pc = await this.setupPeerConnection();

    await pc.setRemoteDescription({ type: "offer", sdp: remoteSdp });
    this.remoteSdpSet = true;

    const rawAnswer = await pc.createAnswer();
    const answer = { type: rawAnswer.type, sdp: preferOpusCodec(rawAnswer.sdp ?? "") };
    await pc.setLocalDescription(answer);
    await this.waitForIce(pc);

    await this.request("verto.answer", {
      callID:       callId,
      sessid:       this.sessId,
      sdp:          pc.localDescription!.sdp,
      dialogParams: { callID: callId },
    });
  }

  hangup(callId?: string, cause = "NORMAL_CLEARING", causeCode = 16) {
    const id = callId ?? this.currentCallId;
    if (id) {
      this.sendNotify("verto.bye", {
        callID:       id,
        sessid:       this.sessId,
        cause,
        causeCode,
        dialogParams: { callID: id },
      });
    }
    this.cleanupMedia();
    this.currentCallId = null;
    this.remoteSdpSet  = false;
  }

  /** Signal FreeSWITCH to place the current call on hold (music-on-hold). */
  holdCall() {
    if (!this.currentCallId) return;
    this.sendNotify("verto.hold", {
      callID: this.currentCallId,
      sessid: this.sessId,
    });
    console.info("[Verto] holdCall sent for", this.currentCallId);
  }

  /** Resume a held call. */
  resumeCall() {
    if (!this.currentCallId) return;
    this.sendNotify("verto.unhold", {
      callID: this.currentCallId,
      sessid: this.sessId,
    });
    console.info("[Verto] resumeCall sent for", this.currentCallId);
  }

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !muted;
  }

  setSpeakerEnabled(enabled: boolean) {
    if (!this.remoteAudio) return;
    // Do NOT mute the audio element here — speaker toggling is about routing
    // audio to the loudspeaker vs earpiece, not about silencing the call.
    // Setting muted=true when speaker=false would cut the caller's audio off.
    // On platforms that support setSinkId (desktop Chrome/Edge), route to the
    // default output device ("") — mobile browsers ignore this gracefully.
    if (typeof (this.remoteAudio as any).setSinkId === "function") {
      (this.remoteAudio as any).setSinkId("").catch(() => {});
    }
    // Ensure audio is always playing (unblock any autoplay suspension).
    if (this.remoteAudio.paused && this.remoteAudio.srcObject) {
      this.remoteAudio.play().catch(() => {});
    }
    console.info("[Verto] setSpeakerEnabled:", enabled, "(routing note: setSinkId used where supported)");
  }

  sendDtmf(digit: string) {
    const callId = this.currentCallId;
    if (!callId) return;

    if (this.pc) {
      const sender = this.pc.getSenders().find((s) => s.track?.kind === "audio");
      if (sender && (sender as any).dtmf) {
        try { (sender as any).dtmf.insertDTMF(digit, 100, 70); } catch (dtmfErr) {
          console.warn("[Verto] DTMF insertDTMF failed, falling back to verto.info only:", dtmfErr);
        }
      }
    }

    this.sendNotify("verto.info", {
      callID: callId,
      sessid: this.sessId,
      dtmf:   digit,
      params: { message: { type: "dtmf", params: { dtmf: digit, duration: 100 } } },
    });
  }

  // ─── WebSocket Handlers ───────────────────────────────────────────────────

  private async handleOpen() {
    console.info("[Verto] WebSocket open — sending login", {
      login:  this.config.login,
      sessid: this.sessId,
    });
    try {
      await this.request("login", {
        login:         this.config.login,
        passwd:        this.config.password,
        sessid:        this.sessId,
        loginParams:   {},
        userVariables: { coins: this.config.coins },
      });
      // Successful login — reset backoff counters
      this.reconnectAttempt = 0;
      this.permDeniedCount  = 0;
      console.info("[Verto] Login OK — sending verto.clientReady");
      this.sendNotify("verto.clientReady", { sessid: this.sessId });
      console.info("[Verto] verto.clientReady sent — marking connected");
      this.startPing();
      this.callbacks.onConnected();
    } catch (err: unknown) {
      const rpcErr = err as Record<string, unknown> | null;
      const code   = typeof rpcErr?.code === "number" ? rpcErr.code : 0;

      if (code === -32601) {
        // -32601 = "Invalid Method / Permission Denied" — FreeSWITCH cannot
        // look up the user (mod_xml_curl not configured or user not found).
        // Repeated fast retries are useless; back off aggressively.
        this.permDeniedCount++;
        const msg =
          `FreeSWITCH rejected login (-32601 Permission Denied). ` +
          `This usually means the FreeSWITCH directory config (mod_xml_curl) ` +
          `needs to be pushed. Ask an admin to run POST /api/freeswitch/configure. ` +
          `Attempt ${this.permDeniedCount}.`;
        console.error("[Verto]", msg);
        this.callbacks.onError(msg);
      } else {
        console.error("[Verto] Handshake failed:", err);
        this.callbacks.onError(`Verto handshake failed: ${(err as Error)?.message ?? String(err)}`);
      }

      this.ws?.close();
    }
  }

  private handleClose(ev: CloseEvent) {
    console.info("[Verto] WebSocket closed", { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
    this.stopPing();
    this.callbacks.onDisconnected();
    this.clearAllPending(new Error("WebSocket closed"));
    // Reset call state so stale IDs don't block new incoming calls after reconnect
    if (this.currentCallId) {
      this.callbacks.onHangup(this.currentCallId, { cause: "NORMAL_CLEARING", causeCode: 16 });
    }
    this.currentCallId = null;
    this.remoteSdpSet  = false;
    this.cleanupMedia();

    if (!this.destroyed) {
      // Rotate the sessId on every reconnect so FreeSWITCH always performs a
      // fresh directory lookup instead of re-connecting to a stale/broken
      // session from a previous connection attempt.
      this.sessId = crypto.randomUUID();

      // Exponential backoff: 5s, 10s, 20s, 40s, 60s (capped).
      // After 3+ consecutive -32601 failures use a longer pause (5 min) to
      // avoid hammering FreeSWITCH when the directory config is broken.
      let delayMs: number;
      if (this.permDeniedCount >= 3) {
        delayMs = RECONNECT_PERM_MS;
        console.warn(`[Verto] ${this.permDeniedCount} consecutive permission-denied failures — ` +
                     `pausing reconnect for ${delayMs / 1000}s`);
      } else {
        this.reconnectAttempt++;
        delayMs = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt - 1),
          RECONNECT_MAX_MS,
        );
      }
      console.info(`[Verto] Reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})`);
      this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
    }
  }

  private handleMessage(e: MessageEvent) {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(e.data as string); } catch { return; }

    // JSON-RPC response to a client-originated request.
    // Our client IDs are always "client_<UUID>" strings — a string ID in the
    // pending map is unambiguously a response to one of our own requests and
    // can NEVER collide with FreeSWITCH server-push IDs (which are numeric).
    if (typeof msg.id === "string" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timeout);
      if (msg.error) p.reject(msg.error);
      else           p.resolve(msg.result);
      return;
    }

    // Server-initiated JSON-RPC request (FreeSWITCH → client).
    // FreeSWITCH always uses numeric IDs for its server-push requests
    // (verto.invite, verto.bye, verto.info etc.). Since our client IDs are
    // "client_<UUID>" strings, numeric IDs can NEVER be confused with a
    // pending client request — they are always server-originated.
    const serverRequestId = typeof msg.id === "number" ? msg.id : null;

    const method = (msg.method as string) ?? "";
    const params  = (msg.params as Record<string, unknown>) ?? {};

    switch (method) {
      case "verto.clientReady":
        this.callbacks.onConnected();
        break;

      case "verto.invite": {
        const callId    = params.callID as string;
        const sdp       = (params.sdp as string) ?? "";
        const dp        = (params.dialogParams as Record<string, string>) ?? {};
        const callerNum = dp.caller_id_number ?? dp.from ?? "Unknown";

        console.info("[Verto] INVITE_RECEIVED", {
          callId, callerNum,
          serverRequestId,
          hasSdp: Boolean(sdp),
          ts: Date.now(),
        });

        this.currentCallId = callId;
        this.remoteSdpSet  = false;

        // Acknowledge the invite immediately so FreeSWITCH knows we received it.
        // Without this ACK FreeSWITCH considers delivery failed and the callee
        // never sees the incoming call. The ACK must be sent BEFORE onIncoming
        // so any reconnect/race between ACK and UI render cannot cause a missed ACK.
        if (serverRequestId !== null) {
          this.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: serverRequestId, result: { method } }));
          console.info("[Verto] INVITE_ACK_SENT", { callId, serverRequestId, ts: Date.now() });
        } else {
          console.warn("[Verto] INVITE_RECEIVED with no numeric serverRequestId — FreeSWITCH may not receive ACK", { callId });
        }

        console.info("[Verto] INVITE_DELIVERING_TO_APP", { callId, callerNum, ts: Date.now() });
        this.callbacks.onIncoming(callId, callerNum, sdp);
        console.info("[Verto] INVITE_DELIVERED_TO_APP", { callId, ts: Date.now() });
        break;
      }

      case "verto.media": {
        // Early media — remote side is ringing, FreeSWITCH sends the first SDP.
        // Apply it exactly once. This is the critical fix: if we set it here
        // we must NOT set it again in verto.answer.
        const sdp = (params.sdp as string) ?? "";
        if (this.pc && sdp && !this.remoteSdpSet) {
          console.info("[Verto] verto.media — applying early-media SDP");
          this.remoteSdpSet = true;
          this.pc.setRemoteDescription({ type: "answer", sdp })
            .then(() => console.info("[Verto] verto.media: remote description set OK"))
            .catch((err: unknown) => {
              console.error("[Verto] verto.media: setRemoteDescription failed:", (err as Error)?.message);
            });
        }
        // Notify context that the remote side is ringing
        const mediaCallId = (params.callID as string) ?? this.currentCallId ?? "";
        this.callbacks.onRinging(mediaCallId);
        break;
      }

      case "verto.answer": {
        const callId = (params.callID as string) ?? "";
        const sdp    = (params.sdp as string) ?? "";

        if (this.pc && sdp) {
          if (this.remoteSdpSet) {
            // Remote SDP was already applied (by verto.media early media).
            // Applying it a second time would throw "InvalidStateError: Cannot
            // set remote answer in state have-remote-answer" and kill audio.
            // The existing RTP session is already flowing — nothing to do.
            console.info("[Verto] verto.answer: remote SDP already set (early media) — skipping setRemoteDescription");
          } else {
            console.info("[Verto] verto.answer — applying answer SDP (no early media)");
            this.remoteSdpSet = true;
            this.pc.setRemoteDescription({ type: "answer", sdp })
              .then(() => console.info("[Verto] verto.answer: remote description set OK"))
              .catch((err: unknown) => {
                console.error("[Verto] verto.answer: setRemoteDescription failed:", (err as Error)?.message);
              });
          }
        }

        this.callbacks.onAnswer(callId, sdp);
        break;
      }

      case "verto.bye": {
        const callId   = (params.callID as string) ?? "";
        const cause    = (params.cause as string) ?? "NORMAL_CLEARING";
        const causeCode = typeof params.causeCode === "number"
          ? params.causeCode
          : (typeof params.cause_code === "number" ? params.cause_code : 16);
        if (serverRequestId !== null) {
          this.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: serverRequestId, result: { method } }));
        }
        this.callbacks.onHangup(callId, { cause, causeCode });
        this.cleanupMedia();
        this.currentCallId = null;
        this.remoteSdpSet  = false;
        break;
      }

      case "verto.info":
        if (serverRequestId !== null) {
          this.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: serverRequestId, result: { method } }));
        }
        break;

      default:
        if (serverRequestId !== null) {
          this.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: serverRequestId, result: { method } }));
        }
        break;
    }
  }

  // ─── JSON-RPC Helpers ─────────────────────────────────────────────────────

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"));
        return;
      }
      // Prefix client IDs with "client_" so they occupy a completely separate
      // ID space from FreeSWITCH server-push request IDs (which are numeric).
      // This eliminates the class of bug where FS sends verto.invite with id=1
      // while the client has a pending login/verto.invite with id=1, causing the
      // server's invite to be silently consumed as the response to our request.
      const id = `client_${crypto.randomUUID()}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout for method "${method}"`));
      }, RPC_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout: timer });

      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      try {
        this.ws.send(msg);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  private sendNotify(method: string, params: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    } catch {}
  }

  private sendRaw(data: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(data); } catch {}
  }

  private clearAllPending(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timeout);
      p.reject(err);
    }
    this.pending.clear();
  }

  // ─── WebRTC Helpers ───────────────────────────────────────────────────────

  private async setupPeerConnection(): Promise<RTCPeerConnection> {
    this.cleanupMedia();

    // Pre-create the audio element NOW, while we are synchronously inside the
    // user-gesture call stack (tap "Call" / "Accept"). Android Chrome requires
    // that HTMLAudioElement.play() be first called from a user-gesture context
    // or autoplay will be blocked when the remote track arrives later via ontrack.
    if (!this.remoteAudio) {
      const audio = new Audio();
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");  // required for inline playback on iOS / Android
      audio.style.display = "none";
      document.body.appendChild(audio);
      this.remoteAudio = audio;
      // "Unlock" autoplay on Android Chrome by calling play() now (with no src).
      // The call will fail harmlessly — what matters is that the browser registers
      // a play-intent from within a user gesture so subsequent plays are allowed.
      audio.play().catch(() => {});
    }

    // Guard: navigator.mediaDevices is undefined on non-secure origins (HTTP)
    // and on very old browsers. Give a clear error rather than a cryptic crash.
    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = window.isSecureContext === false
        ? "Calls require a secure connection (HTTPS). Please open PRaww+ over HTTPS."
        : "Your browser does not support audio calls. Please use Chrome, Edge, Firefox, or Safari 15+.";
      this.callbacks.onError(msg);
      throw new Error(msg);
    }

    // Attempt getUserMedia with voice-optimised constraints.  If the browser
    // rejects the constraints (OverconstrainedError — common on some Android
    // devices) we retry with a bare { audio: true } fallback so the call can
    // still proceed, just without the extra quality hints.
    const richConstraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl:  { ideal: true },
        sampleRate:       { ideal: 48000 },
        channelCount:     { ideal: 1 },
      },
      video: false,
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(richConstraints);
    } catch (err: unknown) {
      const e = err as DOMException;
      // On OverconstrainedError, silently retry with minimal constraints.
      if (e?.name === "OverconstrainedError" || e?.name === "ConstraintNotSatisfiedError") {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          console.warn("[Verto] Fell back to minimal audio constraints (OverconstrainedError)");
        } catch (fallbackErr: unknown) {
          const fe = fallbackErr as DOMException;
          const msg = fe?.message ?? "Could not access microphone.";
          this.callbacks.onError(msg);
          throw new Error(msg);
        }
      } else {
        let msg: string;
        if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
          msg = "Microphone permission was denied. Please allow microphone access in your browser settings and try again.";
        } else if (e?.name === "NotFoundError" || e?.name === "DevicesNotFoundError") {
          msg = "No microphone found. Please connect a microphone and try again.";
        } else if (e?.name === "NotReadableError" || e?.name === "TrackStartError") {
          msg = "Your microphone is in use by another application. Please close it and try again.";
        } else {
          msg = e?.message ?? "Microphone permission denied or device unavailable";
        }
        this.callbacks.onError(msg);
        throw new Error(msg);
      }
    }

    const defaultIceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
    ];

    const pc = new RTCPeerConnection({
      iceServers: (this.config.iceServers && this.config.iceServers.length > 0)
        ? this.config.iceServers
        : defaultIceServers,
    });
    this.pc = pc;

    for (const track of this.localStream.getTracks()) {
      pc.addTrack(track, this.localStream);
    }

    pc.ontrack = (e) => {
      console.log("[Verto] Remote track received:", e.track.kind, "streams:", e.streams.length, "readyState:", e.track.readyState);

      // Build a stable MediaStream. FreeSWITCH sometimes sends tracks without
      // a stream (e.streams is empty) so we construct one manually.
      if (!this.remoteStream) {
        this.remoteStream = e.streams[0] ? new MediaStream(e.streams[0].getTracks()) : new MediaStream();
      }

      // Add the track if not already present
      const existing = this.remoteStream.getTracks().find((t) => t.id === e.track.id);
      if (!existing) {
        this.remoteStream.addTrack(e.track);
        console.log("[Verto] Track added to remoteStream:", e.track.kind, e.track.id);
      }

      // Only audio matters for VoIP
      if (e.track.kind !== "audio") return;

      if (!this.remoteAudio) {
        this.remoteAudio = new Audio();
        this.remoteAudio.autoplay = true;
        this.remoteAudio.setAttribute("playsinline", "");
        this.remoteAudio.style.display = "none";
        document.body.appendChild(this.remoteAudio);
      }

      if (this.remoteAudio.srcObject !== this.remoteStream) {
        this.remoteAudio.srcObject = this.remoteStream;
      }

      const tryPlay = () => {
        const audio = this.remoteAudio;
        if (!audio) return;
        audio.play().then(() => {
          console.log("[Verto] Audio playback started");
        }).catch((err: Error) => {
          console.warn("[Verto] Autoplay blocked:", err.message, "— will retry on next user gesture");
          const resume = () => {
            this.remoteAudio?.play().catch(() => {});
            document.removeEventListener("click", resume);
            document.removeEventListener("keydown", resume);
            document.removeEventListener("touchstart", resume);
          };
          document.addEventListener("click",      resume, { once: true });
          document.addEventListener("keydown",    resume, { once: true });
          document.addEventListener("touchstart", resume, { once: true });
        });
      };

      // Give the track a moment to become live before playing
      if (e.track.readyState === "live") {
        tryPlay();
      } else {
        e.track.addEventListener("unmute", tryPlay, { once: true });
        // Fallback: try after a short delay regardless
        setTimeout(tryPlay, 500);
      }
    };

    // Log ICE and connection state changes to help diagnose RTP issues
    let iceRestartAttempts = 0;
    pc.oniceconnectionstatechange = () => {
      console.log("[Verto] ICE connection state:", pc.iceConnectionState);
      if (pc.iceConnectionState === "failed") {
        if (iceRestartAttempts < 2 && typeof pc.restartIce === "function") {
          iceRestartAttempts++;
          console.warn(`[Verto] ICE failed — attempting ICE restart (attempt ${iceRestartAttempts})`);
          // Reset remoteSdpSet so that FreeSWITCH's re-INVITE with new ICE
          // credentials is accepted. Without this, the new SDP from FS is
          // silently ignored (remoteSdpSet is still true) and audio stays dead.
          this.remoteSdpSet = false;
          pc.restartIce();
        } else {
          console.error("[Verto] ICE failed permanently — RTP will not flow. Check firewall / TURN server config.");
          this.callbacks.onError("Call audio lost. Check your network connection.");
          // Auto-hangup: leaving the UI "connected" with dead audio is worse
          // than a clean hangup.  Send verto.bye so FreeSWITCH releases the leg.
          const deadCallId = this.currentCallId;
          if (deadCallId) {
            this.hangup(deadCallId, "MEDIA_TIMEOUT", 127);
            this.callbacks.onHangup(deadCallId, { cause: "MEDIA_TIMEOUT", causeCode: 127 });
          }
        }
      }
      if (pc.iceConnectionState === "disconnected") {
        console.warn("[Verto] ICE disconnected — may recover automatically");
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[Verto] Peer connection state:", pc.connectionState);
    };

    pc.onicegatheringstatechange = () => {
      console.log("[Verto] ICE gathering state:", pc.iceGatheringState);
    };

    return pc;
  }

  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") { resolve(); return; }
      let iceTimer: ReturnType<typeof setTimeout>;
      const done = () => {
        clearTimeout(iceTimer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === "complete") done(); };
      pc.addEventListener("icegatheringstatechange", check);
      iceTimer = setTimeout(done, ICE_TIMEOUT_MS);
    });
  }

  private buildDialogParams(callId: string, to: string): Record<string, unknown> {
    const ext = String(this.config.extension);
    // caller_id_number MUST be the extension (internal routing key), not the phone.
    // The FreeSWITCH dialplan uses user_data(${caller_id_number}@domain var ...) to
    // resolve the caller's real mobile number from the directory.  If we send the
    // phone number here instead, user_data cannot find the user (directory is keyed
    // by extension, not phone) and effective_caller_id_number stays as the extension.
    //
    // caller_id_name uses the verified phone/extension for the display name field —
    // FreeSWITCH will override this too via the directory variable lookup, but it
    // serves as a human-readable hint in SIP traces / CDR.
    const displayName = this.config.phone ?? ext;
    // destination_number is THE field mod_verto reads to route the call. Without
    // it, FreeSWITCH falls back to its default destination ("service"), which our
    // dialplan matches to "invalid_number" (early media → the caller just hears
    // ringing) and never bridges to the dialed extension. Always send the bare
    // number/extension (strip any @domain) so internal_extensions can match it.
    const cleanedTo = to.trim();
    const destinationNumber = cleanedTo.includes("@") ? cleanedTo.split("@")[0] : cleanedTo;
    return {
      callID:             callId,
      destination_number: destinationNumber,
      to:               to.includes("@") ? to : `${to}@${this.config.domain}`,
      from:             `${ext}@${this.config.domain}`,
      caller_id_name:   displayName,
      caller_id_number: ext,
      outgoingBandwidth: "default",
      incomingBandwidth: "default",
      audioParams: {
        googAutoGainControl:  true,
        googNoiseSuppression: true,
        googHighpassFilter:   true,
        googEchoCancellation: true,
      },
      screenShare: false,
      useVideo:    false,
      useStereo:   false,
      useCamera:   false,
      useMic:      "any",
      useSpeak:    "any",
    };
  }

  private cleanupMedia() {
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    if (this.remoteStream) {
      for (const t of this.remoteStream.getTracks()) t.stop();
      this.remoteStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      // Remove from DOM if attached
      if (this.remoteAudio.parentNode) {
        this.remoteAudio.parentNode.removeChild(this.remoteAudio);
      }
      this.remoteAudio = null;
    }
    this.remoteSdpSet = false;
  }
}
