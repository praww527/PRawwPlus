export interface VertoConfig {
  wsUrl: string;
  domain: string;
  extension: number;
  login: string;
  password: string;
  configured: boolean;
}

export interface VertoCallbacks {
  onIncoming: (callId: string, callerNumber: string, sdp: string) => void;
  onAnswer: (callId: string, sdp: string) => void;
  onHangup: (callId: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (err: string) => void;
}

interface PendingMsg {
  resolve: (val: any) => void;
  reject: (err: any) => void;
}

export class VertoClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private sessId: string;
  private msgId = 1;
  private pending = new Map<number, PendingMsg>();
  private currentCallId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private config: VertoConfig,
    private callbacks: VertoCallbacks
  ) {
    this.sessId = crypto.randomUUID();
  }

  connect() {
    if (!this.config.wsUrl) {
      this.callbacks.onError("FreeSWITCH WebSocket URL not configured");
      return;
    }
    try {
      this.ws = new WebSocket(this.config.wsUrl, "verto");
      this.ws.onopen = () => this.onOpen();
      this.ws.onmessage = (e) => this.onMessage(e);
      this.ws.onclose = () => this.onClose();
      this.ws.onerror = () => this.callbacks.onError("WebSocket connection error");
    } catch (e: any) {
      this.callbacks.onError(e?.message ?? "Failed to connect");
    }
  }

  private onOpen() {
    this.send("login", {
      login: this.config.login,
      passwd: this.config.password,
      sessid: this.sessId,
    });
  }

  private onClose() {
    this.callbacks.onDisconnected();
    if (!this.destroyed) {
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    }
  }

  private onMessage(e: MessageEvent) {
    let msg: any;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(msg.error);
      else p.resolve(msg.result);
      return;
    }

    const method: string = msg.method ?? "";
    const params = msg.params ?? {};

    if (method === "verto.clientReady") {
      this.callbacks.onConnected();
    } else if (method === "verto.invite") {
      const callId: string = params.callID;
      const sdp: string = params.sdp ?? "";
      const caller: string = params.dialogParams?.caller_id_number ?? params.dialogParams?.from ?? "Unknown";
      this.currentCallId = callId;
      this.callbacks.onIncoming(callId, caller, sdp);
    } else if (method === "verto.answer") {
      const callId: string = params.callID;
      const sdp: string = params.sdp ?? "";
      this.callbacks.onAnswer(callId, sdp);
    } else if (method === "verto.bye") {
      const callId: string = params.callID;
      this.callbacks.onHangup(callId);
      this.cleanupPeerConnection();
    } else if (method === "verto.media") {
      const sdp: string = params.sdp ?? "";
      if (this.pc) {
        this.pc.setRemoteDescription({ type: "answer", sdp }).catch(() => {});
      }
    }
  }

  private send(method: string, params: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      try {
        this.ws?.send(msg);
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  private sendNotify(method: string, params: Record<string, any>) {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    try { this.ws?.send(msg); } catch {}
  }

  private async setupPeerConnection(): Promise<RTCPeerConnection> {
    this.cleanupPeerConnection();

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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
      this.remoteAudio.srcObject = e.streams[0];
    };

    return pc;
  }

  async makeCall(to: string): Promise<string> {
    const callId = crypto.randomUUID();
    this.currentCallId = callId;

    const pc = await this.setupPeerConnection();
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") { resolve(); return; }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") resolve();
      };
      setTimeout(resolve, 3000);
    });

    const finalSdp = pc.localDescription!.sdp;

    this.sendNotify("verto.invite", {
      callID: callId,
      sdp: finalSdp,
      dialogParams: {
        callID: callId,
        to: `${to}@${this.config.domain}`,
        from: `${this.config.extension}@${this.config.domain}`,
        caller_id_name: String(this.config.extension),
        caller_id_number: String(this.config.extension),
        remoteSdp: "",
      },
    });

    return callId;
  }

  async answerCall(callId: string, remoteSdp: string): Promise<void> {
    const pc = await this.setupPeerConnection();

    await pc.setRemoteDescription({ type: "offer", sdp: remoteSdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") { resolve(); return; }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") resolve();
      };
      setTimeout(resolve, 3000);
    });

    this.sendNotify("verto.answer", {
      callID: callId,
      sdp: pc.localDescription!.sdp,
      dialogParams: { callID: callId },
    });
  }

  hangup(callId?: string) {
    const id = callId ?? this.currentCallId;
    if (id) {
      this.sendNotify("verto.bye", {
        callID: id,
        dialogParams: { callID: id },
      });
    }
    this.cleanupPeerConnection();
    this.currentCallId = null;
  }

  setMuted(muted: boolean) {
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
  }

  setSpeakerEnabled(_enabled: boolean) {
    if (this.remoteAudio) {
      this.remoteAudio.volume = 1;
    }
  }

  private cleanupPeerConnection() {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }

  disconnect() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.hangup();
    this.ws?.close();
    this.ws = null;
  }
}
