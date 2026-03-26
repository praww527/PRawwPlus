/**
 * FreeSWITCH Event Socket Layer (ESL) listener.
 *
 * Connects to FreeSWITCH's ESL port (8021) — direct TCP when
 * FREESWITCH_SSH_KEY is not set, or via an SSH tunnel when it is.
 *
 * Responsibilities:
 *  - Authenticate and subscribe to call events
 *  - On CHANNEL_ANSWER: mark call in-progress, schedule automatic hangup
 *    when user's coin balance is exhausted (external calls only)
 *  - On CHANNEL_HANGUP_COMPLETE: finalise call record and deduct coins
 *  - Expose sendApiCommand() for one-shot FreeSWITCH API calls
 */

import net from "net";
import { Client as SSHClient, type ClientChannel } from "ssh2";
import { logger } from "./logger";
import { connectDB, CallModel, UserModel } from "@workspace/db";

const COINS_PER_MINUTE = 1;
/** Minimum balance before a call is allowed to start (safety margin) */
const MIN_COINS_SAFETY  = 0.1;

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

class FreeSwitchESL {
  private socket:          net.Socket | null = null;
  private sshConn:         SSHClient | null  = null;
  private buffer =         "";
  private authenticated =  false;
  private destroyed =      false;
  private reconnectTimer:  ReturnType<typeof setTimeout> | null = null;
  /** Tracks scheduled balance-hangup timers so we can cancel on early hangup */
  private hangupTimers =   new Map<string, ReturnType<typeof setTimeout>>();

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
      if (evtName === "CHANNEL_ANSWER") {
        this.handleAnswer(body).catch((e) => logger.error({ err: e }, "[ESL] handleAnswer error"));
      } else if (evtName === "CHANNEL_HANGUP_COMPLETE") {
        this.handleHangup(body).catch((e) => logger.error({ err: e }, "[ESL] handleHangup error"));
      }
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
        // No balance at all — hang up immediately
        logger.warn({ fsCallId, coins }, "[ESL] Insufficient coins on answer — hanging up immediately");
        this.sendApiCommand(`uuid_kill ${fsCallId} ALLOTTED_TIMEOUT`);
        return;
      }

      // Schedule hangup when balance would be exhausted
      // 1 coin = 1 minute, add 5-second buffer so billing rounds up cleanly
      const allowedSecs = Math.floor((coins / COINS_PER_MINUTE) * 60);
      const schedHangup = Math.max(5, allowedSecs - 5);

      logger.info({ fsCallId, coins, allowedSecs, schedHangup }, "[ESL] Scheduling balance-based hangup");

      const timer = setTimeout(() => {
        this.hangupTimers.delete(fsCallId);
        logger.warn({ fsCallId }, "[ESL] Balance exhausted — sending uuid_kill");
        this.sendApiCommand(`uuid_kill ${fsCallId} ALLOTTED_TIMEOUT`);
      }, schedHangup * 1000);

      this.hangupTimers.set(fsCallId, timer);
    }
  }

  private async handleHangup(h: Record<string, string>) {
    const fsCallId = h["Unique-ID"];
    const billsec  = parseInt(h["billsec"] ?? "0");
    if (!fsCallId) return;

    // Cancel any pending balance hangup timer
    const timer = this.hangupTimers.get(fsCallId);
    if (timer) {
      clearTimeout(timer);
      this.hangupTimers.delete(fsCallId);
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

    logger.info({ fsCallId, billsec, coinsUsed }, "[ESL] CHANNEL_HANGUP_COMPLETE → completed");
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
