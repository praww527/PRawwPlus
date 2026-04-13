/**
 * FreeSWITCH Event Socket Layer (ESL) listener.
 *
 * Connects to FreeSWITCH's ESL port (8021) — direct TCP when
 * FREESWITCH_SSH_KEY is not set, or via an SSH tunnel when it is.
 *
 * Responsibilities:
 *  - Authenticate and subscribe to call events
 *  - On CHANNEL_ORIGINATE: send push notification to callee (incoming call alert)
 *  - On CHANNEL_ANSWER: hand off to CallOrchestrator via ESL event buffer
 *  - On CHANNEL_HANGUP_COMPLETE: hand off to CallOrchestrator via ESL event buffer
 *  - Expose sendApiCommand() for one-shot FreeSWITCH API calls
 *
 * Call state transitions and billing are now owned by CallOrchestrator.
 * Zero-event-loss buffering is handled by eslEventBuffer.
 */

import net from "net";
import { Client as SSHClient, type ClientChannel } from "ssh2";
import { logger } from "./logger";
import { connectDB, UserModel, CallModel } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { enqueueEslEvent } from "./eslEventBuffer";
import { ringingCall, answerCall, finalizeCall, setEslCommandFn, clearAllHangupTimers } from "./callOrchestrator";
import { linkCallRecordToFsALeg } from "./mobileCallLink";

const ESL_HOST     = process.env.FREESWITCH_ESL_HOST ?? process.env.FREESWITCH_DOMAIN ?? "";
const ESL_PORT     = parseInt(process.env.FREESWITCH_ESL_PORT ?? "8021");
const ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD ?? "ClueCon";
const isProduction = process.env.NODE_ENV === "production";
const SSH_USER     = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
const SSH_PORT     = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");

/** Strip protocol (wss://, ws://, https://, http://) and path/port from a host string
 *  so it can be used as a bare hostname for SSH/TCP connections. */
function bareHost(raw: string): string {
  try {
    // If it looks like a URL, parse it
    if (/^[a-z]+:\/\//i.test(raw)) {
      return new URL(raw).hostname;
    }
  } catch { /* fall through */ }
  // Otherwise strip trailing port (:NNN) if present
  return raw.split(":")[0].replace(/\/$/, "");
}

const RECONNECT_BASE_MS = parseInt(process.env.ESL_RECONNECT_BASE_MS ?? "2000", 10);
const RECONNECT_MAX_MS  = parseInt(process.env.ESL_RECONNECT_MAX_MS  ?? "60000", 10);

let eslClient: FreeSwitchESL | null = null;
let eslEnabled = false;

let lastConnectedAt: number | null = null;
let lastDisconnectedAt: number | null = null;
let lastEventAt: number | null = null;
let lastDisconnectReason: string | null = null;

function cleanKey(raw: string): string {
  let s = raw.trim();

  // Handle literal \n escape sequences (e.g. stored as single-line in some secret panels)
  if (s.includes("\\n")) {
    s = s.replace(/\\n/g, "\n");
  }

  // Handle keys stored as a single line with spaces replacing newlines.
  // e.g. "-----BEGIN OPENSSH PRIVATE KEY-----   base64...   -----END OPENSSH PRIVATE KEY-----"
  // We extract header/footer separately so their internal spaces are preserved.
  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const headerMatch = s.match(/(-----BEGIN [^-]+-----)/);
    const footerMatch = s.match(/(-----END [^-]+-----)/);
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      const contentStart = s.indexOf(header) + header.length;
      const contentEnd = s.indexOf(footer);
      const body = s.slice(contentStart, contentEnd).trim().replace(/\s+/g, "\n");
      s = `${header}\n${body}\n${footer}`;
    }
  }

  return s
    .split("\n")
    .map((l) => l.trimStart())
    .join("\n")
    .trim();
}

// ─── Push notification helpers ─────────────────────────────────────────────

async function sendExpoPush(
  pushToken: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<void> {
  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: pushToken, title, body, data, sound: "default", priority: "high" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "[Push] Expo gateway HTTP error");
      return;
    }
    const result = await resp.json() as { data?: { status: string; message?: string } };
    if (result?.data?.status === "error") {
      logger.warn({ result }, "[Push] Expo gateway returned error");
    } else {
      logger.info({ tokenPrefix: pushToken.slice(0, 30) }, "[Push] Expo notification sent OK");
    }
  } catch (err) {
    logger.error({ err }, "[Push] Failed to send Expo push notification");
  }
}

async function sendFcmDataMessage(
  fcmToken: string,
  data: Record<string, string>,
): Promise<void> {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    logger.debug("[FCM] Firebase credentials not set — skipping FCM data message");
    return;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientEmail, sub: clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    };
    const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claims  = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signing = `${header}.${claims}`;

    const { createSign } = await import("node:crypto");
    const signer = createSign("RSA-SHA256");
    signer.update(signing);
    const sig = signer.sign(privateKey, "base64url");
    const jwt = `${signing}.${sig}`;

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResp.ok) {
      logger.warn({ status: tokenResp.status }, "[FCM] OAuth token HTTP error");
      return;
    }
    const tokenData = await tokenResp.json() as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("Failed to obtain FCM access token");

    const fcmResp = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            data,
            android: { priority: "HIGH", ttl: "30s" },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!fcmResp.ok) {
      logger.warn({ err: await fcmResp.text() }, "[FCM] FCM HTTP v1 API returned error");
    } else {
      logger.info({ tokenPrefix: fcmToken.slice(0, 20) }, "[FCM] Data message sent OK");
    }
  } catch (err) {
    logger.error({ err }, "[FCM] Failed to send FCM data message");
  }
}

// ─── FreeSwitchESL class ───────────────────────────────────────────────────

class FreeSwitchESL {
  private socket:          net.Socket | null = null;
  private sshConn:         SSHClient | null  = null;
  private buffer =         "";
  private authenticated =  false;
  private destroyed =      false;
  private reconnectTimer:  ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** Maps B-leg UUID → { destExt, callerExt } for missed-call push + DB record */
  private originateDestMap = new Map<string, { destExt: string; callerExt: string }>();

  connect() {
    if (!ESL_HOST) {
      logger.warn("[ESL] FREESWITCH_DOMAIN not set — ESL disabled");
      return;
    }
    if (this.socket && !this.socket.destroyed) return;

    const sshKey = process.env.FREESWITCH_SSH_KEY;
    if (sshKey) {
      this.connectViaSsh(sshKey);
    } else {
      this.connectDirect();
    }
  }

  private connectDirect() {
    logger.info({ host: ESL_HOST, port: ESL_PORT }, "[ESL] Direct TCP connecting");
    const sock = new net.Socket();
    sock.setEncoding("utf8");
    this.attachSocket(sock);
    sock.connect(ESL_PORT, ESL_HOST);
  }

  private connectViaSsh(rawKey: string) {
    logger.info({ host: ESL_HOST, sshPort: SSH_PORT }, "[ESL] SSH tunnel connecting");
    const conn = new SSHClient();
    this.sshConn = conn;

    conn.on("ready", () => {
      logger.info("[ESL] SSH ready — opening tunnel to 127.0.0.1:8021");
      conn.forwardOut("127.0.0.1", 0, "127.0.0.1", ESL_PORT, (err, channel) => {
        if (err) {
          logger.error({ err: err.message }, "[ESL] SSH tunnel forwardOut failed");
          this.scheduleReconnect();
          return;
        }
        logger.info("[ESL] SSH tunnel open — attaching ESL");
        this.attachChannel(channel);
      });
    });

    conn.on("error", (err) => {
      logger.error({ err: err.message }, "[ESL] SSH connection error");
      this.scheduleReconnect();
    });

    conn.on("close", () => {
      logger.warn("[ESL] SSH connection closed");
      this.authenticated = false;
      this.scheduleReconnect("ssh_close");
    });

    const cleaned = cleanKey(rawKey);
    const keyHeader = cleaned.split("\n")[0] ?? "(empty)";
    logger.info({ keyHeader }, "[ESL] Parsed SSH key header");

    try {
      conn.connect({
        host:         bareHost(ESL_HOST),
        port:         SSH_PORT,
        username:     SSH_USER,
        privateKey:   cleaned,
        readyTimeout: 15_000,
      });
    } catch (err) {
      logger.error(
        { err: (err as Error).message, keyHeader },
        "[ESL] SSH key parse failed — check FREESWITCH_SSH_KEY format. " +
        "Key must be a PEM or OpenSSH private key (RSA, ECDSA, or Ed25519). " +
        "If stored with literal \\n, re-paste the key with real newlines.",
      );
      this.sshConn = null;
    }
  }

  private attachChannel(channel: ClientChannel) {
    this.buffer = "";
    this.authenticated = false;

    channel.on("data", (data: Buffer | string) => {
      this.buffer += typeof data === "string" ? data : data.toString("utf8");
      this.processBuffer();
    });

    channel.stderr?.on("data", (d: Buffer) => {
      logger.warn({ data: d.toString() }, "[ESL] channel stderr");
    });

    channel.on("close", () => {
      logger.warn("[ESL] SSH channel closed");
      this.authenticated = false;
      this.scheduleReconnect("ssh_channel_close");
    });

    channel.on("error", (err: Error) => {
      logger.error({ err: err.message }, "[ESL] SSH channel error");
    });

    this.socket = channel as unknown as net.Socket;
  }

  private attachSocket(sock: net.Socket) {
    this.socket        = sock;
    this.buffer        = "";
    this.authenticated = false;

    sock.on("connect", () => {
      logger.info("[ESL] TCP connected");
    });

    sock.on("data", (data: Buffer | string) => {
      this.buffer += typeof data === "string" ? data : data.toString("utf8");
      this.processBuffer();
    });

    sock.on("close", () => {
      logger.warn("[ESL] TCP connection closed");
      this.authenticated = false;
      this.scheduleReconnect("tcp_close");
    });

    sock.on("error", (err) => {
      logger.error({ err: err.message }, "[ESL] TCP error");
      // error is often followed by close, but schedule defensively
      this.scheduleReconnect(`tcp_error:${err.message}`);
    });
  }

  disconnect() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    clearAllHangupTimers();
    this.originateDestMap.clear();
    this.socket?.destroy?.();
    this.sshConn?.end();
    this.socket  = null;
    this.sshConn = null;
  }

  isConnected() {
    return this.authenticated;
  }

  getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  private sendLine(cmd: string) {
    if (!this.socket) return;
    try {
      (this.socket as unknown as { write: (d: string) => void }).write(`${cmd}\n\n`);
    } catch (err) {
      logger.warn({ err }, "[ESL] sendLine failed");
    }
  }

  sendApiCommand(apiCmd: string) {
    if (!this.authenticated) {
      logger.warn({ apiCmd }, "[ESL] sendApiCommand called while not authenticated — ignored");
      return;
    }
    logger.debug({ apiCmd }, "[ESL] sending API command");
    this.sendLine(`bgapi ${apiCmd}`);
  }

  private scheduleReconnect(reason?: string) {
    if (this.destroyed) return;
    this.socket  = null;
    this.sshConn?.end();
    this.sshConn = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    lastDisconnectedAt = Date.now();
    lastDisconnectReason = reason ?? "unknown";

    this.reconnectAttempt++;
    const base = Number.isFinite(RECONNECT_BASE_MS) ? Math.max(250, RECONNECT_BASE_MS) : 2000;
    const max  = Number.isFinite(RECONNECT_MAX_MS)  ? Math.max(base, RECONNECT_MAX_MS) : 60000;
    const exp  = Math.min(max, base * Math.pow(2, Math.min(10, this.reconnectAttempt - 1)));
    const jitter = Math.floor(exp * (0.25 * Math.random()));
    const delay = exp + jitter;

    logger.info(
      { attempt: this.reconnectAttempt, delayMs: delay, reason },
      "[ESL] Scheduling reconnect",
    );

    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private processBuffer() {
    while (true) {
      const blockEnd = this.buffer.indexOf("\n\n");
      if (blockEnd === -1) break;

      const block = this.buffer.slice(0, blockEnd);
      this.buffer = this.buffer.slice(blockEnd + 2);

      const headers    = this.parseHeaders(block);
      const contentLen = parseInt(headers["Content-Length"] ?? "0");

      if (contentLen > 0) {
        if (this.buffer.length < contentLen) { this.buffer = block + "\n\n" + this.buffer; break; }
        const body  = this.buffer.slice(0, contentLen);
        this.buffer = this.buffer.slice(contentLen);
        this.handleEvent({ headers, body });
      } else {
        this.handleEvent({ headers, body: "" });
      }
    }
  }

  private parseHeaders(block: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    return out;
  }

  private handleEvent(event: { headers: Record<string, string>; body: string }) {
    const ct = event.headers["Content-Type"] ?? "";

    if (ct === "auth/request") {
      logger.info("[ESL] Auth requested — sending password");
      this.sendLine(`auth ${ESL_PASSWORD}`);
      return;
    }

    if (ct === "command/reply") {
      const reply = event.headers["Reply-Text"] ?? "";
      if (reply.startsWith("+OK accepted")) {
        logger.info("[ESL] Authenticated — subscribing to call events");
        this.authenticated = true;
        this.reconnectAttempt = 0;
        lastConnectedAt = Date.now();
        // Wire the orchestrator's ESL command function now that we are authenticated
        setEslCommandFn((cmd) => this.sendApiCommand(cmd));
        this.sendLine("event plain CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE CHANNEL_ORIGINATE MESSAGE_WAITING");
      } else if (reply.startsWith("+OK")) {
        // Subscription/command ACK — ignore
      } else if (reply.startsWith("-ERR")) {
        logger.error({ reply }, "[ESL] Auth/command error");
      }
      return;
    }

    if (ct === "text/event-plain") {
      lastEventAt = Date.now();
      const body    = this.parseHeaders(event.body);
      const evtName = body["Event-Name"] ?? "";

      if (evtName === "CHANNEL_ORIGINATE") {
        this.handleOriginate(body).catch((e) =>
          logger.error({ err: e }, "[ESL] handleOriginate error"));

      } else if (evtName === "CHANNEL_ANSWER") {
        // FreeSWITCH fires CHANNEL_ANSWER on both A-leg and B-leg when a call
        // is truly bridged to a callee.
        //
        // IMPORTANT: When the dialplan `answer`s the A-leg to play an error
        // announcement (e.g. "number does not exist"), CHANNEL_ANSWER fires but
        // Other-Leg-Unique-ID is absent — there is no real bridge partner.
        // We must skip answerCall() in that case so the DB stays "ringing"
        // and only transitions to "failed" via CHANNEL_HANGUP_COMPLETE.
        const uuid         = body["Unique-ID"] ?? "";
        const otherLegUuid = body["Other-Leg-Unique-ID"] ?? "";

        if (uuid && otherLegUuid) {
          // Real bridge: enqueue on this leg's UUID; whichever leg fires first
          // wins and the second is a no-op (already "answered").
          enqueueEslEvent(
            uuid,
            "CHANNEL_ANSWER",
            () => answerCall(uuid, otherLegUuid),
            { otherLegId: otherLegUuid },
          );
        } else if (uuid) {
          logger.debug(
            { uuid },
            "[ESL] CHANNEL_ANSWER with no Other-Leg — announcement playback, skipping answerCall",
          );
        }

      } else if (evtName === "CHANNEL_HANGUP_COMPLETE") {
        const uuid         = body["Unique-ID"] ?? "";
        const otherLegUuid = body["Other-Leg-Unique-ID"] ?? "";

        // FreeSWITCH stores call duration in variable_billsec (channel variable).
        // The top-level "billsec" field may not exist in all versions.
        const billsecRaw = parseInt(
          body["variable_billsec"] ?? body["billsec"] ?? "0",
          10,
        );
        const billsec = Number.isFinite(billsecRaw) ? billsecRaw : 0;
        const hangupCause = body["Hangup-Cause"] ?? body["variable_hangup_cause"] ?? "";

        if (uuid) {
          // Send missed-call push + create callee DB record before handing off to orchestrator
          const origEntry = this.originateDestMap.get(uuid) ?? this.originateDestMap.get(otherLegUuid);
          if (origEntry) {
            this.originateDestMap.delete(uuid);
            this.originateDestMap.delete(otherLegUuid);
          }
          // Treat the following as "missed" for the callee:
          //   NO_ANSWER / RECOVERY_ON_TIMER_EXPIRE — callee didn't pick up in time
          //   ORIGINATOR_CANCEL — caller hung up before callee answered
          //   ATTENDED_TRANSFER — went to voicemail (counted as missed for callee)
          //   UNREGISTERED / USER_NOT_REGISTERED / SUBSCRIBER_ABSENT /
          //   DESTINATION_OUT_OF_ORDER — callee was offline / not registered
          //   These are all situations where the callee should see a missed call entry.
          const isMissedForCallee = (
            hangupCause === "NO_ANSWER" ||
            hangupCause === "ORIGINATOR_CANCEL" ||
            hangupCause === "ATTENDED_TRANSFER" ||
            hangupCause === "RECOVERY_ON_TIMER_EXPIRE" ||
            hangupCause === "UNREGISTERED" ||
            hangupCause === "USER_NOT_REGISTERED" ||
            hangupCause === "SUBSCRIBER_ABSENT" ||
            hangupCause === "DESTINATION_OUT_OF_ORDER"
          );
          if (origEntry && isMissedForCallee) {
            const { destExt, callerExt } = origEntry;
            this.sendMissedCallPush(uuid, destExt, callerExt)
              .catch((e) => logger.error({ err: e }, "[Push] Missed call push error"));
            this.createMissedCallRecordForCallee(uuid, destExt, callerExt, hangupCause)
              .catch((e) => logger.error({ err: e }, "[ESL] Missed call record error"));
          }

          enqueueEslEvent(
            uuid,
            "CHANNEL_HANGUP_COMPLETE",
            () => finalizeCall(uuid, billsec, hangupCause, otherLegUuid || undefined),
            {
              billsec,
              hangupCause,
              otherLegId: otherLegUuid || undefined,
            },
          );
        }
      } else if (evtName === "MESSAGE_WAITING") {
        this.handleMessageWaiting(body).catch((e) =>
          logger.error({ err: e }, "[ESL] handleMessageWaiting error"));
      }
    }
  }

  private async handleMessageWaiting(h: Record<string, string>) {
    // FreeSWITCH sends MWI events when mailbox state changes.
    // We notify when messages-waiting indicates new voicemail.
    const waiting = (h["MWI-Messages-Waiting"] ?? h["Messages-Waiting"] ?? "").toLowerCase();
    if (waiting !== "yes" && waiting !== "true") return;

    const account = h["MWI-Account"] ?? h["mwi-account"] ?? "";
    // Typical format: 1000@domain
    const m = account.match(/^([1-9]\d{3})@/);
    if (!m) return;
    const ext = m[1];

    await connectDB();
    const user = await UserModel.findOne({ extension: parseInt(ext, 10) })
      .select("expoPushToken fcmToken notificationPrefs")
      .lean();

    if (!user?.expoPushToken && !user?.fcmToken) return;
    if (user.notificationPrefs?.voicemail === false) return;

    const data = { type: "voicemail", extension: ext };

    if (user.fcmToken) {
      await sendFcmDataMessage(user.fcmToken, data);
    }
    if (user.expoPushToken) {
      await sendExpoPush(
        user.expoPushToken,
        "New voicemail",
        "You have a new voicemail message",
        data,
      );
    }
  }

  /**
   * CHANNEL_ORIGINATE fires when FreeSWITCH attempts to ring the B-leg.
   * Updates call state to "ringing" and sends push notifications.
   *
   * In FreeSWITCH:
   *   Unique-ID            = B-leg UUID (the new outgoing channel)
   *   Other-Leg-Unique-ID  = A-leg UUID (the Verto channel = fsCallId stored in DB)
   */
  private async handleOriginate(h: Record<string, string>) {
    const bLegUuid  = h["Unique-ID"] ?? "";
    const aLegUuid  = h["Other-Leg-Unique-ID"] ?? h["variable_origination_uuid"] ?? "";
    const destExt   = h["Caller-Destination-Number"] ?? h["Channel-Destination-Number"] ?? "";
    const callerExt = h["Caller-Caller-ID-Number"] ?? h["Channel-Caller-ID-Number"] ?? "Unknown";

    // Mobile JsSIP: align Mongo fsCallId with FS A-leg UUID before orchestration.
    if (aLegUuid) {
      try {
        await linkCallRecordToFsALeg(h, aLegUuid);
      } catch (err) {
        logger.warn({ err }, "[ESL] linkCallRecordToFsALeg failed — continuing");
      }
    }

    // Update call DB to "ringing" state using A-leg UUID (= fsCallId)
    if (aLegUuid || bLegUuid) {
      const effectiveALeg = aLegUuid || bLegUuid;
      enqueueEslEvent(
        effectiveALeg,
        "CHANNEL_ORIGINATE",
        () => ringingCall(effectiveALeg, bLegUuid),
        { aLegUuid: effectiveALeg, bLegUuid },
      );
    }

    if (!bLegUuid || !destExt) return;
    if (!/^[1-9]\d{3}$/.test(destExt)) return;

    this.originateDestMap.set(bLegUuid, { destExt, callerExt });
    logger.info({ bLegUuid, aLegUuid, destExt, callerExt }, "[ESL] CHANNEL_ORIGINATE — checking push token");

    await connectDB();
    const destUser = await UserModel.findOne({ extension: parseInt(destExt) })
      .select("expoPushToken fcmToken notificationPrefs dnd")
      .lean();

    if (!destUser?.expoPushToken && !destUser?.fcmToken) return;
    if (destUser.dnd) {
      logger.info({ destExt }, "[ESL] Push skipped — callee has DND enabled");
      return;
    }
    if (destUser.notificationPrefs?.incomingCalls === false) return;

    const pushData = {
      type: "incoming_call",
      fromExtension: callerExt,
      toExtension: destExt,
      callUuid: bLegUuid,
    };

    if (destUser.fcmToken) {
      await sendFcmDataMessage(destUser.fcmToken, pushData);
    }
    if (destUser.expoPushToken) {
      await sendExpoPush(
        destUser.expoPushToken,
        "📞 Incoming Call",
        `Extension ${callerExt} is calling you`,
        pushData,
      );
    }
  }

  /**
   * Creates a "missed" inbound call record in MongoDB for the callee so the
   * call appears in their Recent Calls history even when they never picked up.
   */
  private async createMissedCallRecordForCallee(
    bLegUuid: string,
    destExt: string,
    callerExt: string,
    hangupCause: string,
  ): Promise<void> {
    try {
      await connectDB();
      const destUser = await UserModel.findOne({ extension: parseInt(destExt, 10) })
        .select("_id")
        .lean();
      if (!destUser) {
        logger.debug({ destExt }, "[ESL] Callee not found — skipping missed call record");
        return;
      }
      // Avoid duplicate if the callee already has a record for this B-leg UUID
      const existing = await CallModel.findOne({ fsCallId: bLegUuid, userId: String(destUser._id) }).lean();
      if (existing) {
        logger.debug({ bLegUuid }, "[ESL] Missed call record already exists — skipping");
        return;
      }
      const now = new Date();
      await CallModel.create({
        _id: randomUUID(),
        userId:          String(destUser._id),
        callerNumber:    callerExt,
        recipientNumber: destExt,
        callType:        "internal",
        direction:       "inbound",
        status:          "missed",
        duration:        0,
        cost:            0,
        fsCallId:        bLegUuid,
        hangupCause,
        startedAt:       now,
        endedAt:         now,
      });
      logger.info({ destExt, callerExt, hangupCause }, "[ESL] Missed call record created for callee");
    } catch (err) {
      logger.error({ err, destExt, callerExt }, "[ESL] Failed to create missed call record for callee");
    }
  }

  private async sendMissedCallPush(fsCallId: string, destExt: string, callerExt: string) {
    await connectDB();
    const destUser = await UserModel.findOne({ extension: parseInt(destExt) })
      .select("expoPushToken fcmToken notificationPrefs")
      .lean();

    if (!destUser?.expoPushToken && !destUser?.fcmToken) return;
    if (destUser.notificationPrefs?.missedCalls === false) return;

    logger.info({ fsCallId, destExt, callerExt }, "[Push] Sending missed call notification");
    const pushData = { type: "missed_call", fromExtension: callerExt, toExtension: destExt };

    if (destUser.fcmToken) {
      await sendFcmDataMessage(destUser.fcmToken, pushData);
    }
    if (destUser.expoPushToken) {
      await sendExpoPush(
        destUser.expoPushToken,
        "📵 Missed Call",
        `You missed a call from extension ${callerExt}`,
        pushData,
      );
    }
  }
}

// ─── Module-level exports ──────────────────────────────────────────────────

export function startESL() {
  if (!ESL_HOST) return;
  if (
    isProduction &&
    (!process.env.FREESWITCH_ESL_PASSWORD || ESL_PASSWORD === "ClueCon")
  ) {
    logger.error(
      "[ESL] Production requires a strong FREESWITCH_ESL_PASSWORD (not default ClueCon); ESL disabled",
    );
    return;
  }
  eslEnabled = true;
  eslClient  = new FreeSwitchESL();
  eslClient.connect();
}

export function stopESL() {
  eslClient?.disconnect();
  eslClient  = null;
  eslEnabled = false;
}

export function eslStatus(): {
  enabled: boolean;
  connected: boolean;
  host: string;
  port: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastEventAt: number | null;
  lastDisconnectReason: string | null;
  reconnectAttempt: number;
} {
  return {
    enabled:   eslEnabled,
    connected: eslClient?.isConnected() ?? false,
    host:      ESL_HOST,
    port:      ESL_PORT,
    lastConnectedAt,
    lastDisconnectedAt,
    lastEventAt,
    lastDisconnectReason,
    reconnectAttempt: eslClient?.getReconnectAttempt() ?? 0,
  };
}

export function sendEslApiCommand(cmd: string): boolean {
  if (!eslClient?.isConnected()) return false;
  eslClient.sendApiCommand(cmd);
  return true;
}
