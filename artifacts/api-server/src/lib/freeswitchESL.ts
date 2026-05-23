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
import { ringingCall, answerCall, finalizeCall, setEslCommandFn, setEslTraceFn, clearAllHangupTimers } from "./callOrchestrator";
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

// ── In-memory ESL event trace ─────────────────────────────────────────────────
// Keyed by FreeSWITCH channel UUID. Entries are capped and purged on CHANNEL_DESTROY.
const MAX_TRACE_ENTRIES = 30;

export interface EslTraceEntry {
  event:  string;
  ts:     number; // Unix ms
  cause?: string; // FS hangup/destroy cause when available (CHANNEL_HANGUP_COMPLETE, CHANNEL_DESTROY)
}

const eslTraceMap = new Map<string, EslTraceEntry[]>();

function recordEslTrace(uuid: string, event: string, cause?: string): void {
  if (!uuid) return;
  const entries = eslTraceMap.get(uuid) ?? [];
  const entry: EslTraceEntry = { event, ts: Date.now() };
  if (cause) entry.cause = cause;
  entries.push(entry);
  if (entries.length > MAX_TRACE_ENTRIES) entries.shift();
  eslTraceMap.set(uuid, entries);
}

/** Augment the last trace entry for a UUID with a hangup/destroy cause. */
function augmentLastEslTrace(uuid: string, cause: string): void {
  if (!uuid || !cause) return;
  const entries = eslTraceMap.get(uuid);
  if (!entries || entries.length === 0) return;
  entries[entries.length - 1].cause = cause;
}

/** Returns the full ESL event trace for a channel UUID (A-leg or B-leg). */
export function getEslTrace(uuid: string): EslTraceEntry[] {
  return uuid ? (eslTraceMap.get(uuid) ?? []) : [];
}

/** Returns the last ESL event seen for a channel UUID, or null if none. */
export function getLastEslEvent(uuid: string): EslTraceEntry | null {
  if (!uuid) return null;
  const entries = eslTraceMap.get(uuid);
  if (!entries || entries.length === 0) return null;
  return entries[entries.length - 1];
}

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
  androidNotification?: { title: string; body: string },
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
            android: {
              priority: "HIGH",
              ttl: "30s",
              ...(androidNotification ? {
                notification: {
                  title: androidNotification.title,
                  body: androidNotification.body,
                  channelId: "calls",
                  sound: "default",
                  defaultVibrateTimings: false,
                  vibrateTimingsMillis: ["0", "250", "250", "250"],
                },
              } : {}),
            },
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

async function sendWebPush(
  subscription: { endpoint: string; keys: { auth: string; p256dh: string } },
  data: Record<string, string>,
  userId?: string,
): Promise<void> {
  const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublicKey || !vapidPrivateKey) return;

  try {
    const webpush = await import("web-push");
    const appUrl  = process.env.APP_URL ?? "";
    const subject = appUrl ? `mailto:admin@${new URL(appUrl).hostname}` : "mailto:admin@praww.co.za";
    webpush.setVapidDetails(subject, vapidPublicKey, vapidPrivateKey);
    await webpush.sendNotification(subscription as Parameters<typeof webpush.sendNotification>[0], JSON.stringify(data), { TTL: 60 });
    logger.info({ endpointPrefix: subscription.endpoint.slice(0, 40) }, "[Push] Web push sent OK");
  } catch (err: any) {
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      logger.info({ userId, endpointPrefix: subscription.endpoint.slice(0, 40) }, "[Push] Web push subscription expired/gone — removing");
      if (userId) {
        await UserModel.updateOne({ _id: userId }, { $unset: { webPushSubscription: 1 } }).catch((dbErr: unknown) => {
          logger.warn({ dbErr }, "[Push] Failed to remove stale web push subscription");
        });
      }
    } else {
      logger.error({ err }, "[Push] Failed to send web push notification");
    }
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
    const eslHostBare = bareHost(ESL_HOST);
    const isLocal = eslHostBare === "127.0.0.1" || eslHostBare === "localhost";

    // Only use SSH tunnel when ESL host is localhost (i.e. FreeSWITCH is on the
    // same machine as this server). When connecting to a remote VPS directly,
    // connect via TCP — SSH tunneling to a remote host is not needed
    // and the key auth would target the wrong machine.
    if (sshKey && isLocal) {
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
    // Log call-control commands at INFO so they appear in standard logs
    const isCallCmd = apiCmd.startsWith("uuid_kill")    ||
                      apiCmd.startsWith("uuid_bridge")   ||
                      apiCmd.startsWith("uuid_transfer") ||
                      apiCmd.startsWith("originate")     ||
                      apiCmd.startsWith("sofia");
    if (isCallCmd) {
      logger.info({ apiCmd }, "[ESL] ▶ sending ESL command");
    } else {
      logger.debug({ apiCmd }, "[ESL] sending API command");
    }
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
        this.sendLine("event plain CHANNEL_CREATE CHANNEL_PROGRESS CHANNEL_PROGRESS_MEDIA CHANNEL_ORIGINATE CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE CHANNEL_DESTROY MESSAGE_WAITING");
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
      const uuid    = body["Unique-ID"] ?? "";

      // Always record every channel event to the in-memory trace so the admin
      // diagnostics panel can show exactly where the call flow stopped.
      if (uuid) recordEslTrace(uuid, evtName);

      if (evtName === "CHANNEL_CREATE") {
        // Root-cause indicator: if no CHANNEL_CREATE fires, the ESL subscription
        // or originate command itself failed.  If CREATE fires but no PROGRESS
        // follows, the issue is routing/SIP delivery.
        logger.info({
          uuid,
          channelName:    body["Channel-Name"]              ?? "",
          callerDest:     body["Caller-Destination-Number"] ?? "",
          callerContext:  body["Caller-Context"]            ?? "",
          callDirection:  body["Call-Direction"]            ?? "",
          callerNetAddr:  body["Caller-Network-Addr"]       ?? "",
        }, "[ESL] CHANNEL_CREATE — channel created; ESL subscription confirmed working");

      } else if (evtName === "CHANNEL_PROGRESS" || evtName === "CHANNEL_PROGRESS_MEDIA") {
        // FreeSWITCH fires CHANNEL_PROGRESS (SIP 180) or CHANNEL_PROGRESS_MEDIA
        // (SIP 183) when the B-leg receives an early media response from the SIP UA.
        // Seeing either means: dial-string resolved + callee UA is reachable.
        // If PROGRESS fires but no ANSWER: callee UA is ringing but not picking up.
        logger.info({
          uuid,
          evtName,
          channelName:   body["Channel-Name"]              ?? "",
          callerDest:    body["Caller-Destination-Number"] ?? "",
          answerState:   body["variable_answer_state"]     ?? body["Answer-State"]      ?? "",
          sipStatus:     body["variable_sip_term_status"]  ?? "",
          callDirection: body["Call-Direction"]            ?? "",
        }, "[ESL] Channel progress — SIP 180/183 received; callee UA is reachable");

      } else if (evtName === "CHANNEL_DESTROY") {
        // CHANNEL_DESTROY fires immediately after CHANNEL_HANGUP_COMPLETE.
        // If it fires right after CREATE with no PROGRESS: dialplan rejected or
        // auth failure.  Hangup cause is the definitive FS reason.
        const destroyHangupCause = body["Hangup-Cause"]          ?? body["variable_hangup_cause"] ?? "";
        const destroyAnswerState = body["variable_answer_state"] ?? body["Answer-State"]           ?? "";
        logger.info({
          uuid,
          hangupCause:   destroyHangupCause || "(none)",
          answerState:   destroyAnswerState  || "(none)",
          callDirection: body["Call-Direction"] ?? "",
          channelName:   body["Channel-Name"]   ?? "",
          billsec:       body["variable_billsec"] ?? "0",
        }, "[ESL] CHANNEL_DESTROY");
        if (destroyHangupCause) augmentLastEslTrace(uuid, destroyHangupCause);
        // Keep trace available briefly for the admin panel after the channel is gone.
        if (uuid) setTimeout(() => eslTraceMap.delete(uuid), 60_000);

      } else if (evtName === "CHANNEL_ORIGINATE") {
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

        // ── Full SIP diagnostic log ───────────────────────────────────────────
        // These channel variables reveal the exact FS/SIP failure reason and are
        // critical for root-cause isolation when calls fail in INITIATED state.
        //
        // sip_hangup_disposition:  "send_bye" | "recv_bye" | "recv_cancel" | ...
        // endpoint_disposition:    "ANSWER" | "USER_NOT_REGISTERED" | "INVALID_PROFILE" | ...
        // originate_disposition:   "ORIGINATOR_CANCEL" | "ALLOTTED_TIMEOUT" | ...
        // answer_state:            "ringing" | "early" | "answered" | "hangup"
        // sip_term_status:         SIP response code (e.g. "404", "480", "486")
        // sip_term_cause:          Q.850 cause code as integer string
        const sipHangupDisposition = body["variable_sip_hangup_disposition"] ?? body["sip_hangup_disposition"] ?? "";
        const endpointDisposition  = body["variable_endpoint_disposition"]   ?? "";
        const originateDisposition = body["variable_originate_disposition"]  ?? "";
        const answerState          = body["variable_answer_state"]           ?? body["Answer-State"] ?? "";
        const sipTermStatus        = body["variable_sip_term_status"]        ?? "";
        const sipTermCause         = body["variable_sip_term_cause"]         ?? "";
        const callDirection        = body["Call-Direction"]                  ?? "";
        const channelName          = body["Channel-Name"]                    ?? "";

        logger.info({
          uuid, otherLegUuid, hangupCause, billsec,
          sipHangupDisposition, endpointDisposition, originateDisposition,
          answerState, sipTermStatus, sipTermCause, callDirection, channelName,
        }, "[ESL] CHANNEL_HANGUP_COMPLETE — full SIP diagnostic");

        // Augment the trace so the admin panel can show WHY the call ended
        if (hangupCause) augmentLastEslTrace(uuid, hangupCause);

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
            hangupCause === "DESTINATION_OUT_OF_ORDER" ||
            hangupCause === "NO_ROUTE_DESTINATION" ||
            hangupCause === "NORMAL_TEMPORARY_FAILURE"
          );

          // Prefer originateDestMap (populated by CHANNEL_ORIGINATE).
          // Fall back to HANGUP event body fields for calls where FreeSWITCH
          // rejected at dialplan level and CHANNEL_ORIGINATE never fired
          // (e.g. callee offline → USER_NOT_REGISTERED / NO_ROUTE_DESTINATION).
          let missedCallEntry = origEntry;
          if (!missedCallEntry && isMissedForCallee) {
            const fallbackDest   = body["Caller-Destination-Number"]           ?? body["Channel-Destination-Number"] ?? "";
            const fallbackCaller = body["variable_effective_caller_id_number"]  ?? body["Caller-Caller-ID-Number"]    ?? body["Channel-Caller-ID-Number"] ?? "";
            if (/^[1-9]\d{3}$/.test(fallbackDest) && fallbackCaller) {
              missedCallEntry = { destExt: fallbackDest, callerExt: fallbackCaller };
              logger.info(
                { uuid, fallbackDest, fallbackCaller, hangupCause },
                "[ESL] CHANNEL_HANGUP_COMPLETE: CHANNEL_ORIGINATE never fired — " +
                "using fallback dest/caller from event body for missed-call record",
              );
            } else {
              logger.warn(
                { uuid, hangupCause, fallbackDest, fallbackCaller },
                "[ESL] CHANNEL_HANGUP_COMPLETE: isMissedForCallee but cannot resolve " +
                "dest/caller — no originateDestMap entry and no usable body fields",
              );
            }
          }

          if (missedCallEntry && isMissedForCallee) {
            const { destExt, callerExt } = missedCallEntry;
            recordEslTrace(uuid, "MISSED_CALL_PENDING");
            this.sendMissedCallPush(uuid, destExt, callerExt)
              .catch((e) => logger.error({ err: e }, "[Push] Missed call push error"));
            this.createMissedCallRecordForCallee(uuid, destExt, callerExt, hangupCause)
              .then(() => recordEslTrace(uuid, "MISSED_CALL_CREATED"))
              .catch((e) => logger.error({ err: e }, "[ESL] Missed call record error"));
          }

          // Also notify the CALLER when the call could not be connected.
          // The Verto bye covers the case where the tab is in focus; this push
          // covers the case where the caller backgrounded their app after dialling.
          const shouldNotifyCaller = (
            hangupCause === "UNREGISTERED"             ||
            hangupCause === "USER_NOT_REGISTERED"      ||
            hangupCause === "SUBSCRIBER_ABSENT"        ||
            hangupCause === "DESTINATION_OUT_OF_ORDER" ||
            hangupCause === "NO_ROUTE_DESTINATION"     ||
            hangupCause === "NORMAL_TEMPORARY_FAILURE" ||
            hangupCause === "NO_ANSWER"                ||
            hangupCause === "RECOVERY_ON_TIMER_EXPIRE" ||
            hangupCause === "CALL_REJECTED"
          );
          if (missedCallEntry && shouldNotifyCaller) {
            const { destExt, callerExt } = missedCallEntry;
            this.sendCallerCallFailedPush(callerExt, destExt, hangupCause)
              .catch((e) => logger.error({ err: e }, "[Push] Caller call-failed push error"));
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
      .select("expoPushToken fcmToken webPushSubscription notificationPrefs")
      .lean();

    if (!user?.expoPushToken && !user?.fcmToken && !user?.webPushSubscription) return;
    if (user.notificationPrefs?.voicemail === false) return;

    const data = { type: "voicemail", extension: ext };

    if (user.fcmToken) {
      await sendFcmDataMessage(user.fcmToken, data);
    }
    if (user.webPushSubscription) {
      await sendWebPush(user.webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } }, data, String(user._id));
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

    // ── Full originate diagnostic log ─────────────────────────────────────────
    // Log everything FS tells us when it tries to ring the B-leg.
    // This is the "originate logging" equivalent for Verto/SIP platforms:
    // FS issues the originate internally via the dialplan, and we see the result here.
    //
    // Key fields for root-cause isolation:
    //   channelName   — sofia profile used (e.g. sofia/internal/1003@domain)
    //   callerContext — dialplan context (e.g. default, public)
    //   callerDialplan — dialplan type (XML / LUA)
    //   callerNetworkAddr — SIP UA IP (empty = Verto/WebRTC)
    //   callDirection — "inbound" (A-leg) / "outbound" (B-leg originate)
    logger.info({
      aLegUuid,
      bLegUuid,
      destExt,
      callerExt,
      channelName:       h["Channel-Name"]              ?? "",
      callerContext:     h["Caller-Context"]            ?? "",
      callerDialplan:    h["Caller-Dialplan"]           ?? "",
      callDirection:     h["Call-Direction"]            ?? "",
      callerNetworkAddr: h["Caller-Network-Addr"]       ?? "",
      callerDestFull:    h["Caller-Destination-Number"] ?? "",
      profileIndex:      h["Caller-Profile-Index"]      ?? "",
    }, "[ESL] CHANNEL_ORIGINATE — B-leg is being rung; call transitioning to RINGING");

    await connectDB();
    const destUser = await UserModel.findOne({ extension: parseInt(destExt) })
      .select("expoPushToken fcmToken webPushSubscription notificationPrefs dnd")
      .lean();

    if (!destUser?.expoPushToken && !destUser?.fcmToken && !destUser?.webPushSubscription) return;
    if (destUser.dnd) {
      logger.info({ destExt }, "[ESL] Push skipped — callee has DND enabled");
      return;
    }
    if (destUser.notificationPrefs?.incomingCalls === false) return;

    // Resolve caller's phone/name so push notifications never expose raw extensions
    const callerExtNum = /^[1-9]\d{3}$/.test(callerExt) ? parseInt(callerExt, 10) : null;
    let callerDisplay = callerExt;
    let callerPhone: string | undefined;
    if (callerExtNum) {
      const callerUser = await UserModel.findOne({ extension: callerExtNum })
        .select("phone phoneVerified name")
        .lean();
      // Only include phone in push data if verified — unverified numbers are
      // display-only guesses and must not be sent as authoritative caller ID.
      callerPhone   = callerUser?.phoneVerified ? (callerUser.phone ?? undefined) : undefined;
      callerDisplay = callerUser?.name ?? (callerUser?.phoneVerified ? callerUser.phone : undefined) ?? callerExt;
    }

    const pushData: Record<string, string> = {
      type:      "incoming_call",
      callUuid:  bLegUuid,
      ...(callerPhone ? { fromPhone: callerPhone } : { fromExtension: callerExt }),
      toExtension: destExt,
    };

    if (destUser.fcmToken) {
      await sendFcmDataMessage(destUser.fcmToken, pushData, {
        title: "📞 Incoming Call",
        body: `${callerDisplay} is calling you`,
      });
    }
    if (destUser.webPushSubscription) {
      await sendWebPush(
        destUser.webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } },
        { ...pushData, title: "Incoming Call", body: `${callerDisplay} is calling you` },
        String(destUser._id),
      );
    }
    if (destUser.expoPushToken) {
      await sendExpoPush(
        destUser.expoPushToken,
        "📞 Incoming Call",
        `${callerDisplay} is calling you`,
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
      // Resolve caller's phone number so call history never shows raw extensions
      const callerExtNum = /^[1-9]\d{3}$/.test(callerExt) ? parseInt(callerExt, 10) : null;
      let callerPhone = callerExt;
      let destPhone: string | undefined;
      if (callerExtNum) {
        const callerUser = await UserModel.findOne({ extension: callerExtNum })
          .select("phone phoneVerified")
          .lean();
        // Store verified phone in call record; fall back to extension string for unverified.
        if (callerUser?.phoneVerified && callerUser.phone) callerPhone = callerUser.phone;
      }
      // Also resolve the callee's phone for recipientNumber
      const destUserFull = await UserModel.findById(destUser._id).select("phone").lean();
      destPhone = destUserFull?.phone ?? destExt;

      const now = new Date();
      await CallModel.create({
        _id: randomUUID(),
        userId:          String(destUser._id),
        callerNumber:    callerPhone,
        recipientNumber: destPhone,
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

  /**
   * Notifies the CALLER via push when their outbound call could not be connected —
   * covers cases where the callee was unregistered, didn't answer, or declined.
   * The Verto bye already updates the caller's UI if the tab is in focus, but this
   * push ensures they are informed even when the app is backgrounded.
   */
  private async sendCallerCallFailedPush(callerExt: string, destExt: string, hangupCause: string) {
    if (!/^[1-9]\d{3}$/.test(callerExt)) return;
    await connectDB();
    const callerUser = await UserModel.findOne({ extension: parseInt(callerExt, 10) })
      .select("expoPushToken fcmToken webPushSubscription notificationPrefs")
      .lean();

    if (!callerUser?.expoPushToken && !callerUser?.fcmToken && !callerUser?.webPushSubscription) return;

    // Resolve callee's display name / number
    const destExtNum = /^[1-9]\d{3}$/.test(destExt) ? parseInt(destExt, 10) : null;
    let destDisplay = destExt;
    if (destExtNum) {
      const destUser = await UserModel.findOne({ extension: destExtNum })
        .select("name phone phoneVerified")
        .lean();
      destDisplay = destUser?.name ?? (destUser?.phoneVerified ? (destUser?.phone ?? destExt) : destExt);
    }

    let title: string;
    let body: string;
    let type: string;
    if (
      hangupCause === "UNREGISTERED" ||
      hangupCause === "USER_NOT_REGISTERED" ||
      hangupCause === "SUBSCRIBER_ABSENT" ||
      hangupCause === "DESTINATION_OUT_OF_ORDER" ||
      hangupCause === "NO_ROUTE_DESTINATION" ||
      hangupCause === "NORMAL_TEMPORARY_FAILURE"
    ) {
      title = "Call Not Connected";
      body  = `${destDisplay} is not available right now.`;
      type  = "call_failed_unavailable";
    } else if (hangupCause === "CALL_REJECTED") {
      title = "Call Declined";
      body  = `${destDisplay} is not available right now.`;
      type  = "call_failed_declined";
    } else {
      // NO_ANSWER / RECOVERY_ON_TIMER_EXPIRE
      title = "Call Not Answered";
      body  = `${destDisplay} did not answer your call.`;
      type  = "call_failed_no_answer";
    }

    logger.info({ callerExt, destExt, hangupCause }, "[Push] Sending caller call-failed notification");
    const pushData: Record<string, string> = { type, title, body, toExtension: destExt };

    if (callerUser.fcmToken) {
      await sendFcmDataMessage(callerUser.fcmToken, pushData, { title, body });
    }
    if (callerUser.webPushSubscription) {
      await sendWebPush(
        callerUser.webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } },
        pushData,
        String(callerUser._id),
      );
    }
    if (callerUser.expoPushToken) {
      await sendExpoPush(callerUser.expoPushToken, title, body, pushData);
    }
  }

  private async sendMissedCallPush(fsCallId: string, destExt: string, callerExt: string) {
    await connectDB();
    const destUser = await UserModel.findOne({ extension: parseInt(destExt) })
      .select("expoPushToken fcmToken webPushSubscription notificationPrefs")
      .lean();

    if (!destUser?.expoPushToken && !destUser?.fcmToken && !destUser?.webPushSubscription) return;
    if (destUser.notificationPrefs?.missedCalls === false) return;

    // Resolve caller's phone/name so the push body never exposes raw extensions
    const callerExtNum = /^[1-9]\d{3}$/.test(callerExt) ? parseInt(callerExt, 10) : null;
    let callerDisplay = callerExt;
    let callerPhone: string | undefined;
    if (callerExtNum) {
      const callerUser = await UserModel.findOne({ extension: callerExtNum })
        .select("phone phoneVerified name")
        .lean();
      // Only include phone in push data if verified — same rule as extension-lookup.
      callerPhone   = callerUser?.phoneVerified ? (callerUser.phone ?? undefined) : undefined;
      callerDisplay = callerUser?.name ?? (callerUser?.phoneVerified ? callerUser.phone : undefined) ?? callerExt;
    }

    logger.info({ fsCallId, destExt, callerExt }, "[Push] Sending missed call notification");
    const pushData: Record<string, string> = {
      type: "missed_call",
      toExtension: destExt,
      ...(callerPhone ? { fromPhone: callerPhone } : { fromExtension: callerExt }),
    };

    if (destUser.fcmToken) {
      await sendFcmDataMessage(destUser.fcmToken, pushData);
    }
    if (destUser.webPushSubscription) {
      await sendWebPush(
        destUser.webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } },
        { ...pushData, title: "Missed Call", body: `You missed a call from ${callerDisplay}` },
        String(destUser._id),
      );
    }
    if (destUser.expoPushToken) {
      await sendExpoPush(
        destUser.expoPushToken,
        "📵 Missed Call",
        `You missed a call from ${callerDisplay}`,
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
  // Wire the in-memory trace getter into the orchestrator so the watchdog
  // timeout can include the full ESL event history in its warning log.
  setEslTraceFn(getEslTrace);

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
