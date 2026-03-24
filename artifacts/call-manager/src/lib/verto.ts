/**
 * FreeSWITCH Verto WebRTC Client
 *
 * Protocol: JSON-RPC 2.0 over WebSocket (subprotocol "verto")
 *
 * Handshake sequence:
 *   1. Client connects → sends `login`
 *   2. Server responds to `login` with result
 *   3. Client sends `verto.clientReady`       ← REQUIRED — current client missing this!
 *   4. Server responds to `verto.clientReady` → we fire onConnected()
 *
 * Call flow (outgoing):
 *   Client sends `verto.invite` (with SDP offer)
 *   Server sends `verto.media`  (early media / ringing SDP)
 *   Server sends `verto.answer` (answer SDP)
 *   Either side sends `verto.bye` to hang up
 */

export interface VertoConfig {
  wsUrl: string;
  domain: string;
  extension: number;
  login: string;      // "extension@domain"
  password: string;
  coins: number;
  configured: boolean;
}

export interface VertoCallbacks {
  onIncoming:     (callId: string, callerNumber: string, sdp: string) => void;
  onAnswer:       (callId: string, sdp: string) => void;
  onHangup:       (callId: string) => void;
  onConnected:    () => void;
  onDisconnected: () => void;
  onError:        (err: string) => void;
}

interface Pending {
  resolve: (val: unknown) => void;
  reject:  (err: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const RPC_TIMEOUT_MS  = 10_000;
const ICE_TIMEOUT_MS  = 4_000;
const RECONNECT_MS    = 5_000;

export class VertoClient {
  private ws:           WebSocket | null = null;
  private pc:           RTCPeerConnection | null = null;
  private localStream:  MediaStream | null = null;
  private remoteAudio:  HTMLAudioElement | null = null;
  private sessId:       string;
  private msgId =       1;
  private pending =     new Map<number, Pending>();
  private currentCallId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed =   false;

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
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) return; // already open

    try {
      // "verto" MUST be the negotiated sub-protocol
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
    if (this.currentCallId) this.sendNotify("verto.bye", { callID: this.currentCallId, sessid: this.sessId });
    this.cleanupMedia();
    this.ws?.close();
    this.ws = null;
  }

  async makeCall(to: string): Promise<string> {
    const callId = crypto.randomUUID();
    this.currentCallId = callId;

    const pc = await this.setupPeerConnection(callId);

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
    const pc = await this.setupPeerConnection(callId);

    await pc.setRemoteDescription({ type: "offer", sdp: remoteSdp });
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

  hangup(callId?: string) {
    const id = callId ?? this.currentCallId;
    if (id) {
      this.request("verto.bye", {
        callID: id,
        sessid: this.sessId,
        dialogParams: { callID: id },
      }).catch(() => {});
    }
    this.cleanupMedia();
    this.currentCallId = null;
  }

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !muted;
  }

  setSpeakerEnabled(_enabled: boolean) {
    if (this.remoteAudio) this.remoteAudio.volume = 1;
  }

  // ─── WebSocket Handlers ───────────────────────────────────────────────────

  private async handleOpen() {
    console.log("[Verto] WebSocket open — sending login", {
      login: this.config.login,
      sessid: this.sessId,
    });
    try {
      // Step 1: login — JSON-RPC request; FreeSWITCH responds with same id
      await this.request("login", {
        login:         this.config.login,   // "extension@domain"
        passwd:        this.config.password,
        sessid:        this.sessId,
        loginParams:   {},                   // required by mod_verto
        userVariables: {
          coins: this.config.coins,
        },
      });
      console.log("[Verto] Login OK — sending verto.clientReady");

      // Step 2: notify FreeSWITCH we are ready.
      // This MUST be a fire-and-forget notification (no id) — mod_verto does NOT
      // send a JSON-RPC response to verto.clientReady; if we await it we will
      // hit the 10-second RPC timeout and drop the connection.
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
    if (!this.destroyed) {
      console.log(`[Verto] Reconnecting in ${RECONNECT_MS}ms`);
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    }
  }

  private handleMessage(e: MessageEvent) {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(e.data as string); } catch { return; }

    // JSON-RPC response (has numeric id)
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timeout);
      if (msg.error) p.reject(msg.error);
      else           p.resolve(msg.result);
      return;
    }

    // Server-initiated notifications
    const method = (msg.method as string) ?? "";
    const params  = (msg.params as Record<string, unknown>) ?? {};

    switch (method) {
      case "verto.clientReady":
        // Some FS versions send this as a push (no id) — treat as connected too
        this.callbacks.onConnected();
        break;

      case "verto.invite": {
        const callId      = params.callID as string;
        const sdp         = (params.sdp as string) ?? "";
        const dp          = (params.dialogParams as Record<string, string>) ?? {};
        const callerNum   = dp.caller_id_number ?? dp.from ?? "Unknown";
        this.currentCallId = callId;
        this.callbacks.onIncoming(callId, callerNum, sdp);
        break;
      }

      case "verto.answer": {
        const callId = params.callID as string;
        const sdp    = (params.sdp as string) ?? "";
        if (this.pc && sdp) {
          this.pc.setRemoteDescription({ type: "answer", sdp }).catch(() => {});
        }
        this.callbacks.onAnswer(callId, sdp);
        break;
      }

      case "verto.media": {
        // Early media — ringing tone SDP
        const sdp = (params.sdp as string) ?? "";
        if (this.pc && sdp) {
          this.pc.setRemoteDescription({ type: "answer", sdp }).catch(() => {});
        }
        break;
      }

      case "verto.bye": {
        const callId = params.callID as string;
        this.callbacks.onHangup(callId);
        this.cleanupMedia();
        this.currentCallId = null;
        break;
      }

      case "verto.info":
        // Could carry DTMF, hold/resume, etc. — ignore for now
        break;

      default:
        break;
    }
  }

  // ─── JSON-RPC Helpers ─────────────────────────────────────────────────────

  /** Send a JSON-RPC request and wait for the response (with timeout). */
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

  /** Send a JSON-RPC notification (no id, fire-and-forget). */
  private sendNotify(method: string, params: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    } catch {}
  }

  private clearAllPending(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timeout);
      p.reject(err);
    }
    this.pending.clear();
  }

  // ─── WebRTC Helpers ───────────────────────────────────────────────────────

  private async setupPeerConnection(callId: string): Promise<RTCPeerConnection> {
    this.cleanupMedia();

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    this.pc = pc;

    for (const track of this.localStream.getTracks()) {
      pc.addTrack(track, this.localStream);
    }

    pc.ontrack = (e) => {
      if (!this.remoteAudio) {
        this.remoteAudio = new Audio();
        this.remoteAudio.autoplay = true;
      }
      this.remoteAudio.srcObject = e.streams[0] ?? null;
    };

    // Trickle ICE → send candidates via verto.info
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendNotify("verto.info", {
          callID:  callId,
          sessid:  this.sessId,
          params:  { message: { candidate: e.candidate } },
        });
      }
    };

    return pc;
  }

  /** Wait until ICE gathering is complete or ICE_TIMEOUT_MS elapses. */
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
      callID:              callId,
      to:                  to.includes("@") ? to : `${to}@${this.config.domain}`,
      from:                `${ext}@${this.config.domain}`,
      caller_id_name:      ext,
      caller_id_number:    ext,
      outgoingBandwidth:   "default",
      incomingBandwidth:   "default",
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
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
  }
}
