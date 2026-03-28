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
import { connectDB, UserModel } from "@workspace/db";
import { enqueueEslEvent } from "./eslEventBuffer";
import { ringingCall, answerCall, finalizeCall, setEslCommandFn, clearAllHangupTimers } from "./callOrchestrator";
import { linkCallRecordToFsALeg } from "./mobileCallLink";

const ESL_HOST     = process.env.FREESWITCH_ESL_HOST ?? process.env.FREESWITCH_DOMAIN ?? "";
const ESL_PORT     = parseInt(process.env.FREESWITCH_ESL_PORT ?? "8021");
const ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD ?? "ClueCon";
const isProduction = process.env.NODE_ENV === "production";
const SSH_USER     = process.env.FREESWITCH_SSH_USER ?? "root";
const SSH_PORT     = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");

let eslClient: FreeSwitchESL | null = null;
let eslEnabled = false;

function cleanKey(raw: string): string {
  return raw
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
  /** Maps B-leg UUID → destination extension for missed-call push notifications */
  private originateDestMap = new Map<string, string>();

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
      this.scheduleReconnect();
    });

    conn.connect({
      host:         ESL_HOST,
      port:         SSH_PORT,
      username:     SSH_USER,
      privateKey:   cleanKey(rawKey),
      readyTimeout: 15_000,
    });
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
      this.scheduleReconnect();
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
      this.scheduleReconnect();
    });

    sock.on("error", (err) => {
      logger.error({ err: err.message }, "[ESL] TCP error");
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

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.socket  = null;
    this.sshConn?.end();
    this.sshConn = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    logger.info("[ESL] Reconnecting in 15s");
    this.reconnectTimer = setTimeout(() => this.connect(), 15_000);
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
        // Wire the orchestrator's ESL command function now that we are authenticated
        setEslCommandFn((cmd) => this.sendApiCommand(cmd));
        this.sendLine("event plain CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE CHANNEL_ORIGINATE");
      } else if (reply.startsWith("+OK")) {
        // Subscription/command ACK — ignore
      } else if (reply.startsWith("-ERR")) {
        logger.error({ reply }, "[ESL] Auth/command error");
      }
      return;
    }

    if (ct === "text/event-plain") {
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
          // Send missed-call push before handing off to orchestrator
          const destExt = this.originateDestMap.get(uuid) ?? this.originateDestMap.get(otherLegUuid);
          if (destExt) {
            this.originateDestMap.delete(uuid);
            this.originateDestMap.delete(otherLegUuid);
          }
          if (destExt && (hangupCause === "NO_ANSWER" || hangupCause === "ORIGINATOR_CANCEL")) {
            this.sendMissedCallPush(
              uuid, destExt, body["Caller-Caller-ID-Number"] ?? "Unknown",
            ).catch((e) => logger.error({ err: e }, "[Push] Missed call push error"));
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
      }
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

    this.originateDestMap.set(bLegUuid, destExt);
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

  private async sendMissedCallPush(fsCallId: string, destExt: string, callerExt: string) {
    await connectDB();
    const destUser = await UserModel.findOne({ extension: parseInt(destExt) })
      .select("expoPushToken notificationPrefs")
      .lean();

    if (!destUser?.expoPushToken) return;
    if (destUser.notificationPrefs?.missedCalls === false) return;

    logger.info({ fsCallId, destExt, callerExt }, "[Push] Sending missed call notification");
    await sendExpoPush(
      destUser.expoPushToken,
      "📵 Missed Call",
      `You missed a call from extension ${callerExt}`,
      { type: "missed_call", fromExtension: callerExt, toExtension: destExt },
    );
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

export function eslStatus(): { enabled: boolean; connected: boolean; host: string; port: number } {
  return {
    enabled:   eslEnabled,
    connected: eslClient?.isConnected() ?? false,
    host:      ESL_HOST,
    port:      ESL_PORT,
  };
}

export function sendEslApiCommand(cmd: string): boolean {
  if (!eslClient?.isConnected()) return false;
  eslClient.sendApiCommand(cmd);
  return true;
}
