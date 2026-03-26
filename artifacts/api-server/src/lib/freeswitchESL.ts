/**
 * FreeSWITCH Event Socket Layer (ESL) listener.
 *
 * Connects to FreeSWITCH's ESL port (8021) — direct TCP when
 * FREESWITCH_SSH_KEY is not set, or via an SSH tunnel when it is.
 *
 * Responsibilities:
 *  - Authenticate and subscribe to call events
 *  - On CHANNEL_ORIGINATE: send push notification to callee (incoming call alert)
 *  - On CHANNEL_ANSWER: mark call in-progress, schedule automatic hangup
 *    when user's coin balance is exhausted (external calls only), with voice
 *    announcement before disconnecting
 *  - On CHANNEL_HANGUP_COMPLETE: finalise call record, deduct coins,
 *    send push notification for missed calls
 *  - Expose sendApiCommand() for one-shot FreeSWITCH API calls
 */

import net from "net";
import { Client as SSHClient, type ClientChannel } from "ssh2";
import { logger } from "./logger";
import { connectDB, CallModel, UserModel } from "@workspace/db";

const COINS_PER_MINUTE = 1;
/** Minimum balance before a call is allowed to start (safety margin) */
const MIN_COINS_SAFETY  = 0.1;
/** Seconds to wait after speaking the insufficient-balance message before killing the call */
const INSUFFICIENT_BALANCE_VOICE_DELAY = 9_000;

const ESL_HOST     = process.env.FREESWITCH_ESL_HOST ?? process.env.FREESWITCH_DOMAIN ?? "";
const ESL_PORT     = parseInt(process.env.FREESWITCH_ESL_PORT ?? "8021");
const ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD ?? "ClueCon";
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

/** Send an Expo push notification via the Expo push gateway */
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
    });
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

/**
 * Send a high-priority FCM data-only message to an Android device.
 * Data-only messages bypass the notification tray and wake the app in the
 * background/terminated state so react-native-callkeep can show the system call UI.
 *
 * Requires env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * Falls back to Expo push if Firebase credentials are not configured.
 */
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
    // Build a JWT assertion for Firebase service account
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientEmail,
      sub: clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    };

    // Build unsigned JWT
    const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claims  = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signing = `${header}.${claims}`;

    // Sign with RSA-SHA256 using Node.js crypto
    const { createSign } = await import("node:crypto");
    const signer = createSign("RSA-SHA256");
    signer.update(signing);
    const sig = signer.sign(privateKey, "base64url");
    const jwt = `${signing}.${sig}`;

    // Exchange JWT for an access token
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    const tokenData = await tokenResp.json() as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("Failed to obtain FCM access token");

    // Send FCM message
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
            android: {
              priority: "HIGH",
              ttl: "30s",
            },
          },
        }),
      },
    );

    if (!fcmResp.ok) {
      const err = await fcmResp.text();
      logger.warn({ err }, "[FCM] FCM HTTP v1 API returned error");
    } else {
      logger.info({ tokenPrefix: fcmToken.slice(0, 20) }, "[FCM] Data message sent OK");
    }
  } catch (err) {
    logger.error({ err }, "[FCM] Failed to send FCM data message");
  }
}

class FreeSwitchESL {
  private socket:          net.Socket | null = null;
  private sshConn:         SSHClient | null  = null;
  private buffer =         "";
  private authenticated =  false;
  private destroyed =      false;
  private reconnectTimer:  ReturnType<typeof setTimeout> | null = null;
  /** Tracks scheduled balance-hangup timers so we can cancel on early hangup */
  private hangupTimers =   new Map<string, ReturnType<typeof setTimeout>>();
  /** Maps B-leg UUID → destination extension for push notifications */
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
    for (const t of this.hangupTimers.values()) clearTimeout(t);
    this.hangupTimers.clear();
    this.originateDestMap.clear();
    this.socket?.destroy?.();
    this.sshConn?.end();
    this.socket  = null;
    this.sshConn = null;
  }

  isConnected() {
    return this.authenticated;
  }

  /** Send a raw ESL command line (appends \n\n) */
  private sendLine(cmd: string) {
    if (!this.socket) return;
    try {
      (this.socket as unknown as { write: (d: string) => void }).write(`${cmd}\n\n`);
    } catch (err) {
      logger.warn({ err }, "[ESL] sendLine failed");
    }
  }

  /**
   * Send a FreeSWITCH API command via ESL (fire-and-forget).
   * Example: sendApiCommand("uuid_kill abc-123-456 ALLOTTED_TIMEOUT")
   */
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
        this.handleOriginate(body).catch((e) => logger.error({ err: e }, "[ESL] handleOriginate error"));
      } else if (evtName === "CHANNEL_ANSWER") {
        this.handleAnswer(body).catch((e) => logger.error({ err: e }, "[ESL] handleAnswer error"));
      } else if (evtName === "CHANNEL_HANGUP_COMPLETE") {
        this.handleHangup(body).catch((e) => logger.error({ err: e }, "[ESL] handleHangup error"));
      }
    }
  }

  /**
   * CHANNEL_ORIGINATE fires when FreeSWITCH attempts to ring the B-leg.
   * Use this to send push notifications to the callee on their mobile device.
   */
  private async handleOriginate(h: Record<string, string>) {
    const uuid = h["Unique-ID"];
    const destExt = h["Caller-Destination-Number"] ?? h["Channel-Destination-Number"] ?? "";
    const callerExt = h["Caller-Caller-ID-Number"] ?? h["Channel-Caller-ID-Number"] ?? "Unknown";

    if (!uuid || !destExt) return;

    // Only care about internal extension calls (4-digit extensions)
    if (!/^[1-9]\d{3}$/.test(destExt)) return;

    // Track this originate so we know the destination on hangup (for missed call push)
    this.originateDestMap.set(uuid, destExt);

    logger.info({ uuid, destExt, callerExt }, "[ESL] CHANNEL_ORIGINATE — checking push token");

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

    const pushData = { type: "incoming_call", fromExtension: callerExt, toExtension: destExt, callUuid: uuid };

    // Send FCM data-only message (wakes app in background/terminated for callkeep)
    if (destUser.fcmToken) {
      await sendFcmDataMessage(destUser.fcmToken, pushData);
    }

    // Also send Expo push as fallback (shows notification if FCM not configured or for iOS)
    if (destUser.expoPushToken) {
      await sendExpoPush(
        destUser.expoPushToken,
        "📞 Incoming Call",
        `Extension ${callerExt} is calling you`,
        pushData,
      );
    }
  }

  private async handleAnswer(h: Record<string, string>) {
    const fsCallId = h["Unique-ID"];
    if (!fsCallId) return;

    await connectDB();
    const call = await CallModel.findOne({ fsCallId });
    if (!call || call.endedAt) return;

    await CallModel.updateOne({ fsCallId }, { status: "in-progress", startedAt: new Date() });
    logger.info({ fsCallId }, "[ESL] CHANNEL_ANSWER → in-progress");

    // Mid-call balance enforcement for external calls
    if (call.callType === "external") {
      const user = await UserModel.findById(call.userId).select("coins").lean();
      const coins = user?.coins ?? 0;

      if (coins < MIN_COINS_SAFETY) {
        // No balance at all — play voice announcement then hang up
        logger.warn({ fsCallId, coins }, "[ESL] Insufficient coins on answer — announcing and hanging up");
        this.sendApiCommand(
          `uuid_broadcast ${fsCallId} speak:flite|kal|Your balance is insufficient to make this call. Please top up your account. The call will be disconnected.`,
        );
        setTimeout(() => {
          this.sendApiCommand(`uuid_kill ${fsCallId} ALLOTTED_TIMEOUT`);
        }, INSUFFICIENT_BALANCE_VOICE_DELAY);
        return;
      }

      // Schedule hangup when balance would be exhausted
      // 1 coin = 1 minute, add 5-second buffer so billing rounds up cleanly
      const allowedSecs = Math.floor((coins / COINS_PER_MINUTE) * 60);
      const schedHangup = Math.max(5, allowedSecs - 5);

      logger.info({ fsCallId, coins, allowedSecs, schedHangup }, "[ESL] Scheduling balance-based hangup");

      const timer = setTimeout(() => {
        this.hangupTimers.delete(fsCallId);
        logger.warn({ fsCallId }, "[ESL] Balance exhausted — announcing and sending uuid_kill");
        // Warn the caller 10 seconds before cut (if balance drops near zero during the call)
        this.sendApiCommand(
          `uuid_broadcast ${fsCallId} speak:flite|kal|Your balance has been exhausted. The call will be disconnected now.`,
        );
        setTimeout(() => {
          this.sendApiCommand(`uuid_kill ${fsCallId} ALLOTTED_TIMEOUT`);
        }, INSUFFICIENT_BALANCE_VOICE_DELAY);
      }, schedHangup * 1000);

      this.hangupTimers.set(fsCallId, timer);
    }
  }

  private async handleHangup(h: Record<string, string>) {
    const fsCallId    = h["Unique-ID"];
    const billsec     = parseInt(h["billsec"] ?? "0");
    const hangupCause = h["Hangup-Cause"] ?? "";
    if (!fsCallId) return;

    // Cancel any pending balance hangup timer
    const timer = this.hangupTimers.get(fsCallId);
    if (timer) {
      clearTimeout(timer);
      this.hangupTimers.delete(fsCallId);
    }

    // Send missed call push notification to callee if they didn't answer
    const destExt = this.originateDestMap.get(fsCallId);
    this.originateDestMap.delete(fsCallId);

    if (destExt && (hangupCause === "NO_ANSWER" || hangupCause === "ORIGINATOR_CANCEL")) {
      this.sendMissedCallPush(fsCallId, destExt, h["Caller-Caller-ID-Number"] ?? "Unknown").catch(
        (e) => logger.error({ err: e }, "[Push] Missed call push error"),
      );
    }

    await connectDB();
    const call = await CallModel.findOne({ fsCallId });
    if (!call || call.endedAt) return;

    let coinsUsed = 0;
    if (call.callType === "external" && billsec > 0) {
      coinsUsed = Math.ceil((billsec / 60) * COINS_PER_MINUTE);
    }

    await CallModel.updateOne(
      { _id: call._id },
      { status: "completed", duration: billsec, cost: coinsUsed, endedAt: new Date() },
    );

    if (coinsUsed > 0) {
      await UserModel.updateOne({ _id: call.userId }, [
        {
          $set: {
            coins:          { $max: [0, { $subtract: ["$coins", coinsUsed] }] },
            totalCallsUsed: { $add: ["$totalCallsUsed", 1] },
            totalCoinsUsed: { $add: ["$totalCoinsUsed", coinsUsed] },
          },
        },
      ]);
    } else {
      await UserModel.updateOne({ _id: call.userId }, { $inc: { totalCallsUsed: 1 } });
    }

    logger.info({ fsCallId, billsec, coinsUsed, hangupCause }, "[ESL] CHANNEL_HANGUP_COMPLETE → completed");
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

export function startESL() {
  if (!ESL_HOST) return;
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

/** Send a one-shot FreeSWITCH API command via the active ESL connection */
export function sendEslApiCommand(cmd: string): boolean {
  if (!eslClient?.isConnected()) return false;
  eslClient.sendApiCommand(cmd);
  return true;
}
