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

const RPC_TIMEOUT_MS = 10_000;
const ICE_TIMEOUT_MS = 8_000;
const RECONNECT_MS   = 5_000;

export class VertoClient {
  private ws:             WebSocket | null = null;
  private pc:             RTCPeerConnection | null = null;
  private localStream:    MediaStream | null = null;
  private remoteStream:   MediaStream | null = null;
  private remoteAudio:    HTMLAudioElement | null = null;
  private sessId:         string;
  private msgId =         1;
  private pending =       new Map<number, Pending>();
  private currentCallId:  string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed =     false;
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearAllPending(new Error("Client disconnected"));
    if (this.currentCallId) {
      this.sendNotify("verto.bye", { callID: this.currentCallId, sessid: this.sessId });
    }
    this.cleanupMedia();
    this.ws?.close();
    this.ws = null;
  }

  async makeCall(to: string, presetCallId?: string): Promise<string> {
    const callId = presetCallId ?? crypto.randomUUID();
    this.currentCallId = callId;
    this.remoteSdpSet  = false;
    this.remoteStream  = null;

    const pc = await this.setupPeerConnection();

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    await this.waitForIce(pc);

    await this.request("verto.invite", {
      callID:       callId,
      sessid:       this.sessId,
      sdp:          pc.localDescription!.sdp,
      dialogParams: this.buildDialogParams(callId, to),
    });

    return callId;
  }

  async answerCall(callId: string, remoteSdp: string): Promise<void> {
    this.remoteSdpSet  = false;
    const pc = await this.setupPeerConnection();

    await pc.setRemoteDescription({ type: "offer", sdp: remoteSdp });
    this.remoteSdpSet = true;

    const answer = await pc.createAnswer();
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

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !muted;
  }

  setSpeakerEnabled(_enabled: boolean) {
    if (this.remoteAudio) this.remoteAudio.volume = 1;
  }

  sendDtmf(digit: string) {
    const callId = this.currentCallId;
    if (!callId) return;

    if (this.pc) {
      const sender = this.pc.getSenders().find((s) => s.track?.kind === "audio");
      if (sender && (sender as any).dtmf) {
        try { (sender as any).dtmf.insertDTMF(digit, 100, 70); } catch {}
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
    console.log("[Verto] WebSocket open — sending login", {
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
      console.log("[Verto] Login OK — sending verto.clientReady");
      this.sendNotify("verto.clientReady", { sessid: this.sessId });
      console.log("[Verto] verto.clientReady sent — marking connected");
      this.callbacks.onConnected();
    } catch (err: unknown) {
      console.error("[Verto] Handshake failed:", err);
      this.callbacks.onError(`Verto handshake failed: ${(err as Error)?.message ?? err}`);
      this.ws?.close();
    }
  }

  private handleClose(ev: CloseEvent) {
    console.log("[Verto] WebSocket closed", { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
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
      console.log(`[Verto] Reconnecting in ${RECONNECT_MS}ms`);
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    }
  }

  private handleMessage(e: MessageEvent) {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(e.data as string); } catch { return; }

    // JSON-RPC response (has numeric id AND we are waiting for it)
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timeout);
      if (msg.error) p.reject(msg.error);
      else           p.resolve(msg.result);
      return;
    }

    // Server-initiated JSON-RPC request (has id but we did NOT send it).
    // FreeSWITCH sends verto.invite / verto.bye / verto.info as requests
    // expecting a JSON-RPC 2.0 acknowledgment. Without the ack FreeSWITCH
    // considers delivery failed and the callee never rings.
    const serverRequestId = (typeof msg.id === "number" && !this.pending.has(msg.id))
      ? msg.id as number
      : null;

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
        this.currentCallId = callId;
        this.remoteSdpSet  = false;
        // Acknowledge the invite so FreeSWITCH knows we received it.
        if (serverRequestId !== null) {
          this.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: serverRequestId, result: { method } }));
        }
        this.callbacks.onIncoming(callId, callerNum, sdp);
        break;
      }

      case "verto.media": {
        // Early media — remote side is ringing, FreeSWITCH sends the first SDP.
        // Apply it exactly once. This is the critical fix: if we set it here
        // we must NOT set it again in verto.answer.
        const sdp = (params.sdp as string) ?? "";
        if (this.pc && sdp && !this.remoteSdpSet) {
          console.log("[Verto] verto.media — applying early-media SDP");
          this.remoteSdpSet = true;
          this.pc.setRemoteDescription({ type: "answer", sdp })
            .then(() => console.log("[Verto] verto.media: remote description set OK"))
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
            console.log("[Verto] verto.answer: remote SDP already set (early media) — skipping setRemoteDescription");
          } else {
            console.log("[Verto] verto.answer — applying answer SDP (no early media)");
            this.remoteSdpSet = true;
            this.pc.setRemoteDescription({ type: "answer", sdp })
              .then(() => console.log("[Verto] verto.answer: remote description set OK"))
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
      const id = this.msgId++;
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

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? "Microphone permission denied or device unavailable";
      this.callbacks.onError(msg);
      throw err;
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
        // Attach to DOM so browser autoplay policies treat it as user-initiated
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
    pc.oniceconnectionstatechange = () => {
      console.log("[Verto] ICE connection state:", pc.iceConnectionState);
      if (pc.iceConnectionState === "failed") {
        console.error("[Verto] ICE failed — RTP will not flow. Check firewall UDP 16384-32768 on FreeSWITCH server.");
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
      const done = () => { pc.removeEventListener("icegatheringstatechange", check); resolve(); };
      const check = () => { if (pc.iceGatheringState === "complete") done(); };
      pc.addEventListener("icegatheringstatechange", check);
      setTimeout(done, ICE_TIMEOUT_MS);
    });
  }

  private buildDialogParams(callId: string, to: string): Record<string, unknown> {
    const ext = String(this.config.extension);
    return {
      callID:           callId,
      to:               to.includes("@") ? to : `${to}@${this.config.domain}`,
      from:             `${ext}@${this.config.domain}`,
      caller_id_name:   ext,
      caller_id_number: ext,
      outgoingBandwidth: "default",
      incomingBandwidth: "default",
      audioParams: {
        googAutoGainControl:  true,
        googNoiseSuppression: true,
        googHighpassFilter:   true,
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
