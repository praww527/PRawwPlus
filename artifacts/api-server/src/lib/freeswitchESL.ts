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
import { metrics } from "./metrics";
import { cleanPrivateKey } from "./sshKey";
import { connectDB, UserModel, CallModel } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { enqueueEslEvent } from "./eslEventBuffer";
import { ringingCall, answerCall, bridgeCall, finalizeCall, setEslCommandFn, setEslTraceFn, clearAllHangupTimers, recoverActiveCallsOnStartup } from "./callOrchestrator";
import { setALegEslCommandFn } from "./aLegManager";
import { linkCallRecordToFsALeg } from "./mobileCallLink";
import { pushFreeSwitchConfig } from "./freeswitchSSH";
import { appendCallEvent } from "./callEventLog";
import { cancelMediaWatchdog } from "./mediaWatchdog";
import { registerSipSession, unregisterSipSession, buildSipSession, unregisterVertoSession } from "./callSession";
import {
  notifyRegistration,
  recordOriginateConfirmed,
  recordBLegFailed,
  recordRecoveryAttempt,
} from "./bLegManager";
import { notifyALegSessionReconnected } from "./aLegManager";
import { sendIncomingCallWakeupByExt } from "./wakeupPush";

const ESL_HOST     = process.env.FREESWITCH_ESL_HOST ?? process.env.FREESWITCH_DOMAIN ?? "";
const ESL_PORT     = parseInt(process.env.FREESWITCH_ESL_PORT ?? "8021");
// ESL password MUST come from the environment — never fall back to the
// FreeSWITCH default ("ClueCon"). A silent default masks a misconfigured
// .env and lets the listener attempt auth with an insecure password.
const ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD ?? "";
if (!ESL_PASSWORD) {
  logger.error(
    "[ESL] FREESWITCH_ESL_PASSWORD is not set — the ESL listener cannot authenticate. " +
    "Set it in /home/ubuntu/PRawwPlus/.env to match event_socket.conf.xml.",
  );
}
const isProduction = process.env.NODE_ENV === "production";
const SSH_USER     = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
const SSH_PORT     = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
// SSH must connect to the public VPS IP — FREESWITCH_DOMAIN is the public IP.
// FREESWITCH_ESL_HOST is often 127.0.0.1 (the ESL bind address on the server),
// which is correct for the tunnel destination but wrong for the SSH host itself.
// Always use FREESWITCH_DOMAIN as the SSH target; fall back to ESL_HOST only
// when FREESWITCH_DOMAIN is not set (e.g. a single-machine dev setup).
const SSH_HOST = process.env.FREESWITCH_DOMAIN
  ? bareHost(process.env.FREESWITCH_DOMAIN)
  : bareHost(ESL_HOST);

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
const RECONNECT_MAX_MS  = parseInt(process.env.ESL_RECONNECT_MAX_MS  ?? "15000", 10);

/**
 * Returns true when the FreeSWITCH hangup cause indicates the callee was
 * offline / unreachable in a way that may be transient and recoverable via the
 * hold-window retry path.
 *
 * Exported so it can be unit-tested independently of the ESL event loop.
 *
 * Causes covered:
 *   UNREGISTERED             — SIP/Q.850 cause 20: extension not registered
 *   USER_NOT_REGISTERED      — FreeSWITCH alias for the same condition
 *   SUBSCRIBER_ABSENT        — SIP 480 Temporarily Unavailable
 *   DESTINATION_OUT_OF_ORDER — SIP 502 Bad Gateway; endpoint reachable but
 *                              destination reports it is out of service.
 *                              Also seen when a Verto/SIP session exists on
 *                              paper but the underlying transport is gone.
 */
export function isHangupCauseOffline(cause: string): boolean {
  return (
    cause === "UNREGISTERED"             ||
    cause === "USER_NOT_REGISTERED"      ||
    cause === "SUBSCRIBER_ABSENT"        ||
    cause === "DESTINATION_OUT_OF_ORDER"
  );
}

// ── Auto-recovery debounce for USER_NOT_REGISTERED ───────────────────────────
// Limits how often the expensive operations fire across all concurrent calls.
const AUTO_RESCAN_DEBOUNCE_MS   = 60_000;        // sofia rescan — at most once/min
const AUTO_SSH_PUSH_DEBOUNCE_MS = 5 * 60_000;    // full SSH config push — at most once/5 min
let lastAutoRescanAt  = 0;
let lastAutoSshPushAt = 0;

let eslClient: FreeSwitchESL | null = null;
let eslEnabled = false;

let lastConnectedAt: number | null = null;
let lastDisconnectedAt: number | null = null;
let lastEventAt: number | null = null;
let lastDisconnectReason: string | null = null;

// Rolling event-throughput counters — used by the admin health dashboard
// to detect "event storms" and "silent event drains" in production.
let eslEventsThisMinute = 0;
let eslEventsLastMinute = 0;
let eslEventMinuteStart = Date.now();

// Stalled-throughput watchdog: counts consecutive heartbeat intervals where the
// ESL is authenticated but the event rate is suspiciously low.  FreeSWITCH should
// always emit at least a few events per minute (heartbeat responses, keepalives).
// Two consecutive stall detections (~60 s) fires a warning and increments the metric.
let eslStalledConsecutiveBeats = 0;
const ESL_STALL_MIN_EVENTS_PER_MIN = parseInt(
  process.env.ESL_STALL_MIN_EVENTS_PER_MIN ?? "2", 10,
);
const ESL_STALL_ALERT_BEATS = parseInt(
  process.env.ESL_STALL_ALERT_BEATS ?? "2", 10,
);

// SIP registration flood detection: track per-IP registration attempts within
// a rolling 60-second window and warn when the rate exceeds the threshold.
const SIP_FLOOD_THRESHOLD = parseInt(
  process.env.SIP_FLOOD_THRESHOLD_PER_MIN ?? "30", 10,
);
const sipRegCountByIp = new Map<string, { count: number; windowStart: number }>();

// Purge stale IP flood records every 10 minutes to prevent unbounded memory growth
// (a new IP per registration request would otherwise accumulate indefinitely).
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, record] of sipRegCountByIp.entries()) {
    if (record.windowStart < cutoff) sipRegCountByIp.delete(ip);
  }
}, 10 * 60_000).unref();

// ── In-memory ESL event trace ─────────────────────────────────────────────────
// Keyed by FreeSWITCH channel UUID. Entries are capped and purged on CHANNEL_DESTROY.
const MAX_TRACE_ENTRIES = 30;

export interface EslTraceEntry {
  event:  string;
  ts:     number; // Unix ms
  cause?: string; // FS hangup/destroy cause when available (CHANNEL_HANGUP_COMPLETE, CHANNEL_DESTROY)
}

const eslTraceMap = new Map<string, EslTraceEntry[]>();

// Safety-net: cap the map to at most 5 000 UUIDs every 10 minutes.
// Normal cleanup happens per-channel (60 s after CHANNEL_DESTROY), but a
// crashed channel that never fires CHANNEL_DESTROY would leak an entry.
// This periodic purge evicts entries whose last trace event is oldest,
// so long-lived "immortal" channels (never hung up) do not crowd out
// recently-active ones that would otherwise be purged by insertion order.
const ESL_TRACE_MAP_MAX = 5_000;
setInterval(() => {
  if (eslTraceMap.size <= ESL_TRACE_MAP_MAX) return;
  const excess = eslTraceMap.size - ESL_TRACE_MAP_MAX;
  // Build an array of [key, lastTs] sorted ascending by last-trace timestamp
  // so we evict the most stale entries first rather than the oldest-inserted.
  const sorted = Array.from(eslTraceMap.entries())
    .map(([k, entries]) => ({ k, lastTs: entries.length > 0 ? entries[entries.length - 1].ts : 0 }))
    .sort((a, b) => a.lastTs - b.lastTs);
  for (let i = 0; i < excess && i < sorted.length; i++) {
    eslTraceMap.delete(sorted[i].k);
  }
}, 10 * 60_000).unref();

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
            ...(androidNotification ? {
              notification: { title: androidNotification.title, body: androidNotification.body },
            } : {}),
            android: {
              priority: "HIGH",
              ttl: "30s",
              ...(androidNotification ? {
                notification: {
                  title: androidNotification.title,
                  body: androidNotification.body,
                  channel_id: "calls",
                  sound: "default",
                  default_vibrate_timings: false,
                  vibrate_timings_millis: ["0", "250", "250", "250"],
                },
              } : {}),
            },
            apns: {
              headers: { "apns-priority": "10" },
              payload: {
                aps: {
                  "content-available": 1,
                  ...(androidNotification ? {
                    alert: { title: androidNotification.title, body: androidNotification.body },
                    sound: "default",
                  } : {}),
                },
              },
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
    // web-push is CommonJS; under the esbuild CJS bundle `await import()` returns
    // a namespace whose API is on `.default`. Unwrap it so the functions are
    // callable (otherwise `setVapidDetails is not a function`).
    const webpushMod: any = await import("web-push");
    const webpush = webpushMod.default ?? webpushMod;
    if (typeof webpush?.setVapidDetails !== "function") {
      logger.error({ keys: Object.keys(webpushMod ?? {}) }, "[Push] web-push module shape unexpected — setVapidDetails missing");
      return;
    }
    const rawAppUrl = process.env.APP_URL ?? "";
    // Normalize: add https:// if APP_URL has no scheme (e.g. "rtc.praww.co.za")
    const appUrl  = rawAppUrl && !/^[a-z]+:\/\//i.test(rawAppUrl) ? `https://${rawAppUrl}` : rawAppUrl;
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

// How long to wait for FreeSWITCH to send the auth/request banner after the
// TCP/SSH channel opens.  If it doesn't arrive in this window the connection
// is silently dead (ACL drop, wrong port, or FS not running) — treat it as a
// disconnect and reconnect with backoff.
const AUTH_BANNER_TIMEOUT_MS = parseInt(
  process.env.ESL_AUTH_BANNER_TIMEOUT_MS ?? "12000", 10,
);

class FreeSwitchESL {
  private socket:          net.Socket | null = null;
  private sshConn:         SSHClient | null  = null;
  private buffer =         "";
  private authenticated =  false;
  private destroyed =      false;
  private reconnectTimer:  ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private authBannerTimer: ReturnType<typeof setTimeout> | null = null;
  /** Maps B-leg UUID → { destExt, callerExt } for missed-call push + DB record */
  private originateDestMap = new Map<string, { destExt: string; callerExt: string }>();
  /**
   * Tracks call-pair keys (sorted [uuid, otherLegUuid] joined with ':') for which
   * a missed-call record has already been created in this process lifetime.
   * Prevents double-creation when BOTH legs fire CHANNEL_HANGUP_COMPLETE with a
   * missed cause (e.g. both legs receive USER_NOT_REGISTERED).
   */
  private missedCallProcessed = new Set<string>();

  /**
   * Tracks in-flight NORMAL_TEMPORARY_FAILURE retry attempts.
   * Key: A-leg UUID (the still-alive caller channel).
   * Value: number of retries attempted (capped at 1 to prevent retry storms).
   */
  private retryAttempts = new Map<string, number>();

  /**
   * Tracks hold-window retry attempts for offline callees (UNREGISTERED /
   * USER_NOT_REGISTERED / SUBSCRIBER_ABSENT).
   * Key: A-leg UUID — the caller channel that is being held on ringback.
   * Value: number of re-originate retries already scheduled (0 = window just
   *   opened, MAX_HOLD_RETRIES = window exhausted).
   * Entry is deleted when the A-leg channel itself hangs up, ensuring scheduled
   * retries see a missing key and abort without touching a dead channel.
   */
  private holdWindowRetries = new Map<string, number>();

  /**
   * Pending caller ID injections — populated by registerCallerIdInjection()
   * when POST /calls resolves the correct outbound caller ID.
   * Key: FreeSWITCH channel UUID (= fsCallId / Verto session UUID).
   * Value: the caller ID variables to set via uuid_setvar_multi on CHANNEL_CREATE.
   *
   * Entries are consumed in the CHANNEL_CREATE handler and auto-evicted after
   * 30 s if CHANNEL_CREATE never fires (call rejected before FS creates channel).
   */
  pendingCallerIdInjections = new Map<string, {
    callerIdNumber: string;
    callerIdName:   string;
    callType:       string;
  }>();

  /**
   * Register caller ID variables to be injected when CHANNEL_CREATE fires
   * for the given FreeSWITCH channel UUID.
   */
  registerCallerIdInjection(
    fsCallId:       string,
    callerIdNumber: string,
    callerIdName:   string,
    callType:       string,
  ): void {
    this.pendingCallerIdInjections.set(fsCallId, { callerIdNumber, callerIdName, callType });
    setTimeout(() => this.pendingCallerIdInjections.delete(fsCallId), 30_000);
  }

  /** Periodic heartbeat — sends bgapi status every 30 s when authenticated
   *  to detect silently-dead TCP/SSH connections faster than OS keepalive alone. */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ── bgapi job tracking ──────────────────────────────────────────────────────
  // FreeSWITCH responds to every bgapi command with:
  //   command/reply  →  Reply-Text: +OK Job-UUID: <uuid>
  // Then later fires a BACKGROUND_JOB event with the actual result (+OK / -ERR).
  // We track in-flight commands in a FIFO queue so we can correlate Job-UUID
  // with the command that was sent (ESL socket is serial — replies are ordered).
  private bgapiCmdQueue: Array<{
    cmd:     string;
    sentAt:  number;
    resolve: ((result: string) => void) | undefined;
  }> = [];
  private bgapiJobMap = new Map<string, {
    cmd:     string;
    sentAt:  number;
    resolve: ((result: string) => void) | undefined;
  }>();

  connect() {
    if (!ESL_HOST) {
      logger.warn("[ESL] FREESWITCH_DOMAIN not set — ESL disabled");
      return;
    }
    // Guard against concurrent connections: during an SSH handshake this.socket
    // is null but this.sshConn is already assigned.  Without this guard a second
    // concurrent call to connect() would spawn a duplicate SSH tunnel and cause
    // a reconnect storm.
    if ((this.socket && !this.socket.destroyed) || this.sshConn) return;

    const sshKey = process.env.FREESWITCH_SSH_KEY;

    // ESL (mod_event_socket) is bound to 127.0.0.1 for security — it must never
    // be exposed on the public IP.  When we have an SSH key, always tunnel through
    // SSH to reach the ESL port on the remote server's loopback, regardless of
    // whether FREESWITCH_DOMAIN is localhost or a remote IP/hostname.
    // Only fall back to direct TCP if no SSH key is configured (e.g. ESL is
    // explicitly bound to 0.0.0.0 in a controlled lab environment).
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
    logger.info({ host: SSH_HOST, sshPort: SSH_PORT }, "[ESL] SSH tunnel connecting");
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

    const cleaned = cleanPrivateKey(rawKey);
    const keyHeader = cleaned.split("\n")[0] ?? "(empty)";
    logger.info({ keyHeader }, "[ESL] Parsed SSH key header");

    try {
      conn.connect({
        host:         SSH_HOST,
        port:         SSH_PORT,
        username:     SSH_USER,
        privateKey:   cleaned,
        readyTimeout: 15_000,
        // SSH-level keepalive: send a global request every 15 s and tear the
        // connection down after 3 unanswered (≈45 s). Without this the tunnel
        // was being silently reaped ~every 20 min by the cloud provider's idle
        // connection handling / sshd, causing brief ESL outages that surfaced as
        // "ESL connected" going red, USER_NOT_REGISTERED call failures, and a
        // degraded admin dashboard. Keepalives keep the link warm through
        // middleboxes AND detect a dead link far faster than waiting for TCP/app
        // timeouts, so reconnect kicks in within seconds instead of ~20 min.
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
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

  /** Start the auth-banner watchdog. If FreeSWITCH doesn't send auth/request
   *  within AUTH_BANNER_TIMEOUT_MS we treat it as a silent ACL drop or dead
   *  connection and schedule a reconnect.  Common cause: SSH forwardOut arrives
   *  on ::1 (IPv6 loopback) but event_socket.conf only allows 127.0.0.1. */
  private startAuthBannerTimer() {
    if (this.authBannerTimer) clearTimeout(this.authBannerTimer);
    this.authBannerTimer = setTimeout(() => {
      if (!this.authenticated) {
        logger.error(
          { timeoutMs: AUTH_BANNER_TIMEOUT_MS },
          "[ESL] Auth banner timeout — FreeSWITCH never sent auth/request. " +
          "Likely cause: event_socket.conf ACL dropped the connection (SSH forwardOut " +
          "may arrive as ::1; ensure apply-inbound-acl=loopback is set), or FreeSWITCH " +
          "is not running. Pushing updated config and reconnecting.",
        );
        this.scheduleReconnect("auth_banner_timeout");
      }
    }, AUTH_BANNER_TIMEOUT_MS);
  }

  private clearAuthBannerTimer() {
    if (this.authBannerTimer) {
      clearTimeout(this.authBannerTimer);
      this.authBannerTimer = null;
    }
  }

  /** Start the application-level ESL heartbeat.
   *
   *  Sends `bgapi status` every 30 s so we always have a BACKGROUND_JOB event
   *  in-flight.  A silently-dead TCP connection (firewall ACL drop, half-open)
   *  will stop responding and `lastEventAt` will grow stale — the next scheduled
   *  heartbeat will log a warning.  The OS-level TCP keepalive (`setKeepAlive`)
   *  is the complementary low-level mechanism; together they give two layers of
   *  dead-connection detection without depending solely on FreeSWITCH sending events.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.authenticated) return;
      const staleSec = lastEventAt ? Math.round((Date.now() - lastEventAt) / 1000) : null;

      if (staleSec !== null && staleSec > 90) {
        // No ESL event in >90 s despite three bgapi keepalive attempts — the
        // connection is a zombie (TCP half-open: appears alive at OS level, but
        // FreeSWITCH stopped delivering events through it).  Force a full
        // reconnect so the event subscription is re-established and call routing
        // works again.  This is the primary fix for "USER_NOT_REGISTERED" failures
        // caused by a silent ESL disconnect that the OS keepalive never detected.
        logger.error(
          { staleSec, host: ESL_HOST },
          "[ESL] Heartbeat: no ESL event in >90 s — zombie connection detected; forcing reconnect",
        );
        this.scheduleReconnect("heartbeat_zombie_90s");
        return;
      }

      if (staleSec !== null && staleSec > 60) {
        logger.warn(
          { staleSec, host: ESL_HOST },
          "[ESL] Heartbeat: no ESL event in >60 s — possible silent TCP death; sending keepalive",
        );
      }

      // ── Stalled-event-throughput watchdog ─────────────────────────────────
      // Roll over the per-minute counter every ~60 s (2× the 30 s heartbeat).
      // We track whether we rolled over this beat to use `eslEventsLastMinute`
      // for the stall check (avoids false positives mid-window).
      const now = Date.now();
      if (now - eslEventMinuteStart >= 60_000) {
        eslEventsLastMinute = eslEventsThisMinute;
        eslEventsThisMinute = 0;
        eslEventMinuteStart = now;

        // Only warn when the ESL is authenticated — disconnected state has
        // naturally zero events and is covered by the zombie watchdog above.
        if (this.authenticated && eslEventsLastMinute < ESL_STALL_MIN_EVENTS_PER_MIN) {
          eslStalledConsecutiveBeats++;
          if (eslStalledConsecutiveBeats >= ESL_STALL_ALERT_BEATS) {
            metrics.eslStalledThroughputCount++;
            logger.warn(
              {
                eventsLastMinute:      eslEventsLastMinute,
                stallThreshold:        ESL_STALL_MIN_EVENTS_PER_MIN,
                consecutiveLowMinutes: eslStalledConsecutiveBeats,
                host: ESL_HOST,
              },
              "[ESL] Stalled event throughput detected — FreeSWITCH may be unresponsive or dialplan is idle. " +
              "Check: freeswitch-cli> sofia status; show channels; show calls",
            );
          }
        } else {
          eslStalledConsecutiveBeats = 0;
        }
      }

      this.sendApiCommand("status");
    }, 30_000);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attachChannel(channel: ClientChannel) {
    this.buffer = "";
    this.authenticated = false;
    this.startAuthBannerTimer();

    channel.on("data", (data: Buffer | string) => {
      this.buffer += typeof data === "string" ? data : data.toString("utf8");
      this.processBuffer();
    });

    channel.stderr?.on("data", (d: Buffer) => {
      logger.warn({ data: d.toString() }, "[ESL] channel stderr");
    });

    channel.on("close", () => {
      logger.warn("[ESL] SSH channel closed");
      this.clearAuthBannerTimer();
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

    // Enable OS-level TCP keepalive so the kernel sends ACK probes every 30 s.
    // This detects half-open connections (e.g. firewall silently dropped the TCP
    // session) at the network layer, complementing our application-level heartbeat.
    sock.setKeepAlive(true, 30_000);

    sock.on("connect", () => {
      logger.info("[ESL] TCP connected");
      this.startAuthBannerTimer();
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
    this.clearAuthBannerTimer();
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    clearAllHangupTimers();
    this.originateDestMap.clear();
    this.holdWindowRetries.clear();
    // Flush pending bgapi promises so callers aren't left hanging
    for (const item of this.bgapiCmdQueue)  item.resolve?.("-ERR ESL disconnected");
    for (const item of this.bgapiJobMap.values()) item.resolve?.("-ERR ESL disconnected");
    this.bgapiCmdQueue = [];
    this.bgapiJobMap.clear();
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

  /** Combined depth of queued bgapi commands + in-flight job map entries.
   *  Non-zero during heavy call load; persistently non-zero signals backpressure. */
  getBgapiQueueDepth(): number {
    return this.bgapiCmdQueue.length + this.bgapiJobMap.size;
  }

  private sendLine(cmd: string) {
    if (!this.socket) return;
    try {
      (this.socket as unknown as { write: (d: string) => void }).write(`${cmd}\n\n`);
    } catch (err) {
      logger.warn({ err }, "[ESL] sendLine failed");
    }
  }

  sendApiCommand(apiCmd: string, resolve?: (result: string) => void) {
    if (!this.authenticated) {
      logger.warn({ apiCmd }, "[ESL] sendApiCommand called while not authenticated — ignored");
      resolve?.("-ERR not authenticated");
      return;
    }
    // Log call-control commands at INFO — include the FULL originate string so
    // admins can verify the dial-string, sofia profile, and domain are correct.
    const isCallCmd = apiCmd.startsWith("uuid_kill")    ||
                      apiCmd.startsWith("uuid_bridge")   ||
                      apiCmd.startsWith("uuid_transfer") ||
                      apiCmd.startsWith("originate")     ||
                      apiCmd.startsWith("sofia");
    if (isCallCmd) {
      logger.info({ apiCmd }, "[ESL] ▶ sending bgapi command (full originate string logged)");
    } else {
      logger.debug({ apiCmd }, "[ESL] sending bgapi API command");
    }
    // Push to the FIFO queue so we can correlate the Job-UUID that FreeSWITCH
    // returns in command/reply with this specific command.
    this.bgapiCmdQueue.push({ cmd: apiCmd, sentAt: Date.now(), resolve });
    this.sendLine(`bgapi ${apiCmd}`);
  }

  /**
   * Like sendApiCommand but returns a Promise that resolves with the
   * BACKGROUND_JOB result string (+OK … or -ERR …).
   * Used by the synchronous diagnostics endpoint.
   */
  sendApiCommandAwait(apiCmd: string, timeoutMs = 10_000): Promise<string> {
    return new Promise((resolve) => {
      if (!this.authenticated) {
        resolve("-ERR ESL not authenticated");
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve(`-ERR timeout after ${timeoutMs}ms`); }
      }, timeoutMs);
      this.sendApiCommand(apiCmd, (result) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(result); }
      });
    });
  }

  private scheduleReconnect(reason?: string) {
    if (this.destroyed) return;
    this.socket  = null;
    this.sshConn?.end();
    this.sshConn = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.clearAuthBannerTimer();
    this.stopHeartbeat();
    lastDisconnectedAt = Date.now();
    lastDisconnectReason = reason ?? "unknown";
    metrics.eslDisconnectedAt = Date.now();

    // Flush any in-flight bgapi commands so their promise callbacks are called
    // and callers aren't left hanging indefinitely.  New commands issued after
    // reconnect will get fresh entries.
    for (const item of this.bgapiCmdQueue)        item.resolve?.("-ERR ESL disconnected");
    for (const item of this.bgapiJobMap.values()) item.resolve?.("-ERR ESL disconnected");
    this.bgapiCmdQueue = [];
    this.bgapiJobMap.clear();

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
      const reply   = event.headers["Reply-Text"] ?? "";
      const jobUuid = event.headers["Job-UUID"]   ?? "";
      if (reply === "-ERR invalid" || reply.startsWith("-ERR")) {
        // Auth failed — wrong password.  Log clearly and schedule reconnect with backoff.
        logger.error(
          { reply, host: ESL_HOST, port: ESL_PORT },
          "[ESL] Authentication FAILED — check FREESWITCH_ESL_PASSWORD matches FreeSWITCH event_socket.conf.xml. " +
          "If you just changed the password, restart FreeSWITCH so it reloads event_socket.conf.xml.",
        );
        this.scheduleReconnect("auth_failed");
        return;
      }

      if (reply.startsWith("+OK accepted")) {
        logger.info("[ESL] Authenticated — subscribing to call events");
        this.clearAuthBannerTimer();
        this.authenticated    = true;
        this.reconnectAttempt = 0;
        lastConnectedAt = Date.now();
        metrics.eslDisconnectedAt = null;
        // Wire the orchestrator's and A-leg manager's ESL command functions now that
        // we are authenticated.  Both modules issue uuid_kill commands via these fns.
        setEslCommandFn((cmd) => this.sendApiCommand(cmd));
        setALegEslCommandFn((cmd) => this.sendApiCommand(cmd));
        // Subscribe to all channel events including CHANNEL_HANGUP for deep SIP debugging.
        // BACKGROUND_JOB captures bgapi originate results (including -ERR before channel creation).
        // CHANNEL_UNBRIDGE fires when a bridge is torn down — used to cancel media watchdog
        // and detect premature bridge loss (e.g. transfer failure, mid-call partition).
        this.sendLine(
          "event plain " +
          "HEARTBEAT " +
          "CHANNEL_CREATE CHANNEL_PROGRESS CHANNEL_PROGRESS_MEDIA " +
          "CHANNEL_ORIGINATE CHANNEL_ANSWER CHANNEL_BRIDGE CHANNEL_UNBRIDGE " +
          "CHANNEL_HANGUP CHANNEL_HANGUP_COMPLETE " +
          "CHANNEL_DESTROY MESSAGE_WAITING BACKGROUND_JOB " +
          "CUSTOM sofia::register sofia::unregister sofia::pre-register sofia::expire",
        );
        // Start application-level heartbeat to detect silently-dead connections.
        this.startHeartbeat();
        // Enable deep Sofia SIP tracing in development only.
        // In production this floods FreeSWITCH logs and can noticeably impact
        // performance under load. Gate on NODE_ENV so it never runs in prod.
        if (!isProduction) {
          this.sendApiCommand("sofia global siptrace on");
          this.sendApiCommand("sofia loglevel all 9");
          logger.info("[ESL] Deep Sofia tracing enabled (siptrace on, loglevel 9) — dev only");
        }
      } else if (reply.startsWith("+OK")) {
        // This is the bgapi Job-UUID ACK.  Pop the oldest queued command and
        // register it in the job map so we can correlate the BACKGROUND_JOB result.
        if (jobUuid) {
          const pending = this.bgapiCmdQueue.shift();
          if (pending) {
            logger.debug({ jobUuid, cmd: pending.cmd.slice(0, 120) },
              "[ESL] bgapi Job-UUID registered — awaiting BACKGROUND_JOB result");
            this.bgapiJobMap.set(jobUuid, {
              cmd:     pending.cmd,
              sentAt:  pending.sentAt,
              resolve: pending.resolve,
            });
          } else {
            logger.warn({ jobUuid }, "[ESL] command/reply Job-UUID but bgapiCmdQueue was empty");
          }
        }
        // else: subscription ACK (no Job-UUID) — ignore
      } else if (reply.startsWith("-ERR")) {
        logger.error({ reply }, "[ESL] command/reply -ERR from FreeSWITCH");
        // The front-of-queue command was rejected synchronously (before any BACKGROUND_JOB)
        const failedCmd = this.bgapiCmdQueue.shift();
        if (failedCmd) {
          logger.error({ cmd: failedCmd.cmd, reply }, "[ESL] bgapi command rejected immediately by FreeSWITCH");
          failedCmd.resolve?.(reply);
        }
      }
      return;
    }

    if (ct === "text/event-plain") {
      const _evtNow = Date.now();
      lastEventAt = _evtNow;
      if (_evtNow - eslEventMinuteStart >= 60_000) {
        eslEventsLastMinute = eslEventsThisMinute;
        eslEventsThisMinute = 0;
        eslEventMinuteStart = _evtNow;
      }
      eslEventsThisMinute++;
      const body    = this.parseHeaders(event.body);
      const evtName = body["Event-Name"] ?? "";
      const uuid    = body["Unique-ID"] ?? "";

      // Always record every channel event to the in-memory trace so the admin
      // diagnostics panel can show exactly where the call flow stopped.
      if (uuid) recordEslTrace(uuid, evtName);

      // ── Task 5-6: BACKGROUND_JOB — bgapi result (including originate -ERR) ──────
      if (evtName === "BACKGROUND_JOB") {
        const jobUuid = body["Job-UUID"] ?? "";
        // The job result lives in the nested body AFTER the BACKGROUND_JOB event
        // headers.  FreeSWITCH uses a double-\n separator between event headers
        // and the job result payload (just like the outer ESL envelope).
        const headerEnd = event.body.indexOf("\n\n");
        const jobResult = (headerEnd !== -1
          ? event.body.slice(headerEnd + 2)
          : "").trim();
        const isErr = jobResult.startsWith("-ERR");

        const pending = this.bgapiJobMap.get(jobUuid);
        if (pending) {
          this.bgapiJobMap.delete(jobUuid);
          const elapsedMs = Date.now() - pending.sentAt;
          if (isErr) {
            // Task 6: -ERR from FS means the originate (or other command) was
            // rejected BEFORE any channel was created — this is why ESL trace
            // is completely empty.  Log at ERROR with the full command so the
            // admin can see exactly what FS rejected and why.
            logger.error({
              jobUuid,
              cmd:       pending.cmd,
              result:    jobResult,
              elapsedMs,
            }, "[ESL] ▼ BACKGROUND_JOB -ERR — FreeSWITCH rejected command before channel creation; check originate string, sofia profile, and endpoint registration");
          } else {
            logger.info({
              jobUuid,
              cmd:       pending.cmd.slice(0, 120),
              result:    jobResult.slice(0, 200),
              elapsedMs,
            }, "[ESL] ▼ BACKGROUND_JOB +OK");
          }
          pending.resolve?.(jobResult);
        } else {
          // Spontaneous BACKGROUND_JOB from FS-initiated operations (not from
          // our bgapi commands, e.g. XML CDR, mod_event_socket built-ins).
          if (isErr) {
            logger.warn({ jobUuid, result: jobResult.slice(0, 200) },
              "[ESL] BACKGROUND_JOB -ERR (no pending job tracked — spontaneous FS event)");
          } else {
            logger.debug({ jobUuid, result: jobResult.slice(0, 80) },
              "[ESL] BACKGROUND_JOB +OK (spontaneous — no pending job)");
          }
        }
        return; // BACKGROUND_JOB is not a channel event — skip channel handlers below

      } else if (evtName === "CHANNEL_CREATE") {
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

        // ── Caller ID injection ───────────────────────────────────────────────
        // If POST /calls pre-selected a caller ID for this channel UUID,
        // inject it now via uuid_setvar_multi so the dialplan and PSTN gateway
        // receive the server-validated number — not whatever the UA sent.
        if (uuid) {
          const pendingInj = this.pendingCallerIdInjections.get(uuid);
          if (pendingInj) {
            this.pendingCallerIdInjections.delete(uuid);
            const { callerIdNumber, callerIdName, callType } = pendingInj;
            const vars: string[] = [
              `effective_caller_id_number=${callerIdNumber}`,
              `effective_caller_id_name=${callerIdName}`,
            ];
            if (callType === "external-pstn") {
              vars.push(`outbound_caller_id_number=${callerIdNumber}`);
              vars.push(`outbound_caller_id_name=${callerIdName}`);
            }
            const setVarCmd = `uuid_setvar_multi ${uuid} ${vars.join(";")}`;
            this.sendApiCommand(setVarCmd, (result) => {
              if (result.startsWith("-ERR")) {
                logger.warn(
                  { uuid, callerIdNumber, callerIdName, callType, result },
                  "[ESL] CHANNEL_CREATE: uuid_setvar_multi caller ID injection failed",
                );
              } else {
                logger.info(
                  { uuid, callerIdNumber, callerIdName, callType },
                  "[ESL] CHANNEL_CREATE: caller ID injected via uuid_setvar_multi",
                );
              }
            });
          }
        }

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

        // Persist progress/early_media event to DB call timeline
        if (uuid) {
          const isEarlyMedia = evtName === "CHANNEL_PROGRESS_MEDIA";
          connectDB().then(async () => {
            const { CallModel: CM } = await import("@workspace/db");
            const call = await CM.findOne({ fsCallId: uuid }).select("_id userId").lean();
            if (call) {
              appendCallEvent({
                callId:  String(call._id),
                fsCallId: uuid,
                userId:  String(call.userId),
                event:   isEarlyMedia ? "early_media" : "progress",
                metadata: { sipStatus: body["variable_sip_term_status"] ?? "" },
              }).catch(() => {});
            }
          }).catch(() => {});
        }

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

        // Persist destroy event to DB call timeline
        if (uuid) {
          connectDB().then(async () => {
            const { CallModel: CM } = await import("@workspace/db");
            const call = await CM.findOne({ fsCallId: uuid }).select("_id userId").lean();
            if (call) {
              appendCallEvent({
                callId:  String(call._id),
                fsCallId: uuid,
                userId:  String(call.userId),
                event:   "destroyed",
                metadata: { hangupCause: destroyHangupCause, answerState: destroyAnswerState },
              }).catch(() => {});
            }
          }).catch(() => {});
        }

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

      } else if (evtName === "CHANNEL_BRIDGE") {
        // CHANNEL_BRIDGE fires when FreeSWITCH truly connects both legs — this is
        // the definitive "two-way audio established" event.
        // It fires AFTER CHANNEL_ANSWER and confirms the bridge is active.
        const bridgeUuid     = body["Unique-ID"]           ?? "";
        const bridgeOtherLeg = body["Other-Leg-Unique-ID"] ?? body["Bridge-B-Unique-ID"] ?? "";
        const callerDest     = body["Caller-Destination-Number"] ?? "";
        const callerFrom     = body["variable_effective_caller_id_number"] ?? body["Caller-Caller-ID-Number"] ?? "";

        recordEslTrace(bridgeUuid, "CHANNEL_BRIDGE");
        if (bridgeOtherLeg) recordEslTrace(bridgeOtherLeg, "CHANNEL_BRIDGE");

        logger.info(
          { uuid: bridgeUuid, otherLeg: bridgeOtherLeg, callerDest, callerFrom },
          "[ESL] CHANNEL_BRIDGE — two-way audio established between legs",
        );

        if (bridgeUuid) {
          enqueueEslEvent(
            bridgeUuid,
            "CHANNEL_BRIDGE",
            () => bridgeCall(bridgeUuid, bridgeOtherLeg || undefined),
            { otherLegId: bridgeOtherLeg || undefined },
          );

          // Start recording the bridged call if a recordings directory is configured.
          // File naming matches the SSH-based listing format: call_<callerExt>_<destExt>_<uuid>.wav
          const recordingsDir = (
            process.env.FREESWITCH_RECORDINGS_DIR ??
            `${process.env.FREESWITCH_STORAGE_DIR ?? "/usr/local/freeswitch/storage"}/recordings/calls`
          );
          const callerExt = callerFrom.replace(/\D/g, "").slice(-4) || "unknown";
          const destExt   = callerDest.replace(/\D/g, "").slice(-4) || "unknown";
          const recPath   = `${recordingsDir}/call_${callerExt}_${destExt}_${bridgeUuid}.wav`;

          this.sendApiCommand(
            `uuid_record ${bridgeUuid} start ${recPath}`,
            (result) => {
              if (result.startsWith("-ERR")) {
                logger.warn(
                  { uuid: bridgeUuid, recPath, result },
                  "[ESL] CHANNEL_BRIDGE: uuid_record failed — check FREESWITCH_RECORDINGS_DIR and FS permissions",
                );
              } else {
                logger.info(
                  { uuid: bridgeUuid, recPath },
                  "[ESL] CHANNEL_BRIDGE: recording started",
                );
              }
            },
          );
        }

      } else if (evtName === "CHANNEL_UNBRIDGE") {
        // CHANNEL_UNBRIDGE fires when FreeSWITCH tears down the bridge between
        // two legs — BEFORE CHANNEL_HANGUP_COMPLETE.  Causes include:
        //   • One leg explicitly ending the call (normal flow)
        //   • Blind/attended transfer (the bridge moves, not the call)
        //   • Mid-call ICE/RTP failure without full hang-up
        //   • Dialplan `transfer` action splitting the bridge
        //
        // Seeing UNBRIDGE without a following HANGUP_COMPLETE means the A-leg
        // was re-bridged elsewhere (transfer) — the call is still "live" in FS.
        const ubUuid     = body["Unique-ID"]           ?? "";
        const ubOtherLeg = body["Other-Leg-Unique-ID"] ?? body["Bridge-B-Unique-ID"] ?? "";
        const ubCause    = body["Hangup-Cause"]        ?? "";

        if (ubUuid)     recordEslTrace(ubUuid,     "CHANNEL_UNBRIDGE", ubCause || undefined);
        if (ubOtherLeg) recordEslTrace(ubOtherLeg, "CHANNEL_UNBRIDGE", ubCause || undefined);

        logger.info(
          { uuid: ubUuid, otherLeg: ubOtherLeg, hangupCause: ubCause || "(none)" },
          "[ESL] CHANNEL_UNBRIDGE — bridge torn down between legs",
        );

        // Cancel the media watchdog on both legs — the bridge is gone so there
        // will be no more RTP packets on this pair regardless of final outcome.
        cancelMediaWatchdog(ubUuid);
        if (ubOtherLeg && ubOtherLeg !== ubUuid) {
          cancelMediaWatchdog(ubOtherLeg);
        }

      } else if (evtName === "CHANNEL_HANGUP") {
        // CHANNEL_HANGUP fires as soon as a channel starts hanging up,
        // before billing / CDR finalisation.  Logging it gives us the very
        // first indication of why a call ended — useful when HANGUP_COMPLETE
        // is delayed or never arrives.
        const hUuid        = body["Unique-ID"]             ?? "";
        const hOtherLeg    = body["Other-Leg-Unique-ID"]   ?? "";
        const hCause       = body["Hangup-Cause"]          ?? body["variable_hangup_cause"] ?? "";
        const hSipStatus   = body["variable_sip_term_status"]              ?? "";
        const hSipCause    = body["variable_sip_term_cause"]               ?? "";
        const hDisposition = body["variable_sip_hangup_disposition"]       ?? "";
        const hEndpointDisp= body["variable_endpoint_disposition"]         ?? "";
        const hOriginateDisp=body["variable_originate_disposition"]        ?? "";
        const hLastBridgeCause = body["variable_last_bridge_hangup_cause"] ?? "";
        const hInviteFailure   = body["variable_sip_invite_failure_status"]?? "";
        const hAnswerState = body["variable_answer_state"] ?? body["Answer-State"] ?? "";

        if (hUuid) recordEslTrace(hUuid, evtName, hCause || undefined);

        logger.info({
          uuid:              hUuid,
          otherLegUuid:      hOtherLeg,
          hangupCause:       hCause        || "(none)",
          sipTermStatus:     hSipStatus    || "(none)",
          sipTermCause_q850: hSipCause     || "(none)",
          sipHangupDisposition: hDisposition || "(none)",
          endpointDisposition:  hEndpointDisp || "(none)",
          originateDisposition: hOriginateDisp || "(none)",
          lastBridgeHangupCause: hLastBridgeCause || "(none)",
          sipInviteFailureStatus: hInviteFailure || "(none)",
          answerState:       hAnswerState  || "(none)",
          channelName:       body["Channel-Name"]   ?? "",
          callDirection:     body["Call-Direction"] ?? "",
        }, "[ESL] CHANNEL_HANGUP — early hangup signal; Q.850/SIP codes logged");

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
        // last_bridge_hangup_cause: hangup cause from the last bridge attempt
        // sip_invite_failure_status: SIP status of failed INVITE (carrier rejection)
        const sipHangupDisposition  = body["variable_sip_hangup_disposition"]        ?? body["sip_hangup_disposition"] ?? "";
        const endpointDisposition   = body["variable_endpoint_disposition"]           ?? "";
        const originateDisposition  = body["variable_originate_disposition"]          ?? "";
        const answerState           = body["variable_answer_state"]                   ?? body["Answer-State"] ?? "";
        const sipTermStatus         = body["variable_sip_term_status"]                ?? "";
        const sipTermCause          = body["variable_sip_term_cause"]                 ?? "";
        const lastBridgeHangupCause = body["variable_last_bridge_hangup_cause"]       ?? "";
        const sipInviteFailStatus   = body["variable_sip_invite_failure_status"]      ?? "";
        const callDirection         = body["Call-Direction"]                           ?? "";
        const channelName           = body["Channel-Name"]                             ?? "";

        // ── Stale Verto session eviction ─────────────────────────────────────
        //
        // When a Verto WebRTC channel fails with DESTINATION_OUT_OF_ORDER the
        // browser tab has closed / gone offline but FreeSWITCH still has the
        // verto_contact() entry in its endpoint table.  Every subsequent
        // hold-window retry will bridge to the same stale contact and fail
        // with DESTINATION_OUT_OF_ORDER again, wasting the entire 30-second
        // hold window.
        //
        // Fix: immediately evict the in-memory VertoSession for that extension
        // so the next hold-window re-originate skips verto_contact() and goes
        // straight to user/<ext>@domain (SIP/JsSIP mobile path).
        if (
          hangupCause === "DESTINATION_OUT_OF_ORDER" &&
          channelName.startsWith("verto.rtc/")
        ) {
          const rawExt = channelName.slice("verto.rtc/".length).split("@")[0];
          const staleExt = parseInt(rawExt, 10);
          if (staleExt >= 1000 && staleExt <= 9999) {
            unregisterVertoSession(staleExt);
            logger.info(
              { uuid, channelName, staleExt, hangupCause },
              "[ESL] DEST_OOO: evicted stale Verto session — hold-window retries will use SIP path",
            );
          }
        }

        const isFailedCall = hangupCause !== "NORMAL_CLEARING" &&
          hangupCause !== "ORIGINATOR_CANCEL" &&
          hangupCause !== "NO_ANSWER" &&
          hangupCause !== "ATTENDED_TRANSFER";

        logger.info({
          uuid, otherLegUuid, hangupCause, billsec,
          sipTermStatus,
          sipTermCause_q850:      sipTermCause,
          sipHangupDisposition,
          endpointDisposition,
          originateDisposition,
          lastBridgeHangupCause,
          sipInviteFailureStatus: sipInviteFailStatus,
          answerState, callDirection, channelName,
        }, "[ESL] CHANNEL_HANGUP_COMPLETE — full SIP diagnostic");

        // Dump ALL channel variables for failed calls so we have the complete
        // FreeSWITCH diagnostic picture in the logs (equivalent to uuid_dump in fs_cli).
        if (isFailedCall && uuid) {
          this.sendApiCommand(`uuid_dump ${uuid}`, (dumpResult) => {
            logger.info(
              { uuid, hangupCause, dumpLength: dumpResult.length },
              "[ESL] uuid_dump for failed call",
            );
            // Log first 4000 chars of dump — pino truncates objects so log as string
            logger.info(
              { uuid, dump: dumpResult.slice(0, 4000) },
              "[ESL] uuid_dump output (first 4000 chars)",
            );
          });
        }

        // Augment the trace so the admin panel can show WHY the call ended
        if (hangupCause) augmentLastEslTrace(uuid, hangupCause);

        if (uuid) {
          // ── Hold-window A-leg cancellation ────────────────────────────────────
          // If this channel IS the A-leg (caller) and it fires CHANNEL_HANGUP
          // while we have a hold-window open for it, cancel the window so that
          // any scheduled re-originate setTimeout callbacks see a missing key
          // and abort cleanly.  The holdWindowRetries map is keyed by A-leg UUID,
          // so `holdWindowRetries.has(uuid)` ≡ "this channel started a hold window".
          //
          // We also capture `wasHoldWindowALeg` so the holdWindowActive guard
          // below can exclude this event from ever re-opening a window — without
          // this flag, a dialplan-hangup A-leg with cause=UNREGISTERED and a
          // stale `otherLegUuid` pointing to a dead B-leg (whose UUID is NOT in
          // holdWindowRetries → returns 0 < MAX) would falsely set holdWindowActive.
          const wasHoldWindowALeg = this.holdWindowRetries.has(uuid);
          if (wasHoldWindowALeg) {
            logger.info(
              { uuid, hangupCause },
              "[ESL] HOLD_WINDOW: A-leg channel terminated — cancelling hold window",
            );
            this.holdWindowRetries.delete(uuid);
          }

          // ── Missed-call detection ────────────────────────────────────────────
          //
          // Treat the following as "missed" for the callee. Comments explain why
          // each cause is included:
          //   NO_ANSWER / ALLOTTED_TIMEOUT — callee didn't pick up in time.
          //     NO_ANSWER is the SIP/Q.850 standard; ALLOTTED_TIMEOUT is what
          //     FreeSWITCH fires when its own originate_timeout variable fires
          //     before the SIP layer sends a 408 — both mean the same thing.
          //   RECOVERY_ON_TIMER_EXPIRE — generic timer expiry (e.g. T1/B timer).
          //   ORIGINATOR_CANCEL — caller hung up before callee answered.
          //   ATTENDED_TRANSFER — went to voicemail (counted as missed for callee).
          //   USER_BUSY — callee was already on another call.
          //   UNREGISTERED / USER_NOT_REGISTERED / SUBSCRIBER_ABSENT /
          //   DESTINATION_OUT_OF_ORDER / NO_ROUTE_DESTINATION /
          //   NORMAL_TEMPORARY_FAILURE — callee was offline / not reachable.
          const isMissedForCallee = (
            hangupCause === "NO_ANSWER" ||
            hangupCause === "ALLOTTED_TIMEOUT" ||
            hangupCause === "ORIGINATOR_CANCEL" ||
            hangupCause === "ATTENDED_TRANSFER" ||
            hangupCause === "RECOVERY_ON_TIMER_EXPIRE" ||
            hangupCause === "USER_BUSY" ||
            hangupCause === "UNREGISTERED" ||
            hangupCause === "USER_NOT_REGISTERED" ||
            hangupCause === "SUBSCRIBER_ABSENT" ||
            hangupCause === "DESTINATION_OUT_OF_ORDER" ||
            hangupCause === "NO_ROUTE_DESTINATION" ||
            hangupCause === "NORMAL_TEMPORARY_FAILURE"
          );

          // ── originateDestMap lookup & conditional cleanup ─────────────────────
          //
          // The map is keyed by the B-leg UUID (set in handleOriginate).
          // CHANNEL_HANGUP_COMPLETE fires for BOTH legs; we receive whichever
          // arrives first — it could be the A-leg (uuid=A, otherLegUuid=B) or
          // the B-leg (uuid=B, otherLegUuid=A).
          //
          // Deletion strategy:
          //   • If this leg's cause IS missed  → consume the entry now and delete.
          //   • If this leg's cause is NOT missed (e.g. A-leg NORMAL_CLEARING) →
          //     leave the entry so the B-leg's event (ORIGINATOR_CANCEL etc.) can
          //     still find and consume it. Schedule a 2-minute TTL as a safety net.
          const origEntry = this.originateDestMap.get(uuid) ?? this.originateDestMap.get(otherLegUuid);
          if (origEntry) {
            if (isMissedForCallee) {
              // Consuming for missed-call — remove immediately.
              this.originateDestMap.delete(uuid);
              this.originateDestMap.delete(otherLegUuid);
            } else {
              // Non-missed leg (e.g. A-leg NORMAL_CLEARING).  Keep the entry so
              // the B-leg's missed-cause event can use it.  TTL prevents leaks.
              const bLegKey = this.originateDestMap.has(uuid) ? uuid : otherLegUuid;
              setTimeout(() => {
                this.originateDestMap.delete(bLegKey);
              }, 120_000);
            }
          }

          // ── Resolve dest/caller for missed-call record ────────────────────────
          //
          // Primary source: originateDestMap (most reliable; set by handleOriginate).
          // Fallback: HANGUP event body fields — used when CHANNEL_ORIGINATE never
          // fired (callee offline → FreeSWITCH rejected at dialplan level before
          // even ringing the B-leg) OR when the origEntry was already consumed by
          // the other leg's event.
          //
          // FreeSWITCH sometimes appends "@domain" to Caller-Destination-Number
          // (e.g. "1002@internal").  Strip that suffix before the regex test.
          let missedCallEntry = origEntry ?? null;
          if (!missedCallEntry && isMissedForCallee) {
            const rawDest      = body["Caller-Destination-Number"] ?? body["Channel-Destination-Number"] ?? "";
            const fallbackDest = rawDest.replace(/@.*$/, "").trim();
            const fallbackCaller =
              body["variable_effective_caller_id_number"] ??
              body["Caller-Caller-ID-Number"] ??
              body["Channel-Caller-ID-Number"] ??
              "";
            if (/^[1-9]\d{3}$/.test(fallbackDest)) {
              missedCallEntry = { destExt: fallbackDest, callerExt: fallbackCaller || "Unknown" };
              logger.info(
                { uuid, fallbackDest, fallbackCaller, hangupCause },
                "[ESL] CHANNEL_HANGUP_COMPLETE: using fallback dest/caller from event body for missed-call record",
              );
            } else {
              logger.warn(
                { uuid, hangupCause, rawDest, fallbackDest, fallbackCaller },
                "[ESL] CHANNEL_HANGUP_COMPLETE: isMissedForCallee but cannot resolve " +
                "dest/caller — no originateDestMap entry and no usable body fields",
              );
            }
          }

          // ── Hold-window: are we in an active retry window for an offline callee?
          //
          // When the B-leg fails with an "offline" cause AND the A-leg is still
          // alive (otherLegUuid present), we enter a 25–30 s hold window.
          // During that window we:
          //   1. Suppress the missed-call record and caller-failed push (the call
          //      may still connect on a later retry).
          //   2. Send an "incoming_call_wakeup" push on the first failure so the
          //      callee's device wakes up.  The existing autoRecoverUnregistered
          //      "please reopen" push still fires on the first failure too.
          //   3. Schedule a re-originate attempt every ~5 s.  Each attempt is
          //      sequential: the new B-leg's CHANNEL_HANGUP_COMPLETE fires this
          //      handler again, which schedules the next retry or gives up.
          //   4. Cap at MAX_HOLD_RETRIES to prevent infinite loops.
          //
          // The dialplan hold window in freeswitchConfig.ts plays ringback for
          // ~30 s before the unavailable announcement, giving this logic room to
          // bridge a reconnected callee without the caller hearing silence.
          const MAX_HOLD_RETRIES = 4;
          const isOfflineCause = isHangupCauseOffline(hangupCause);
          // holdWindowActive = true means: this B-leg failed with an offline cause,
          // the A-leg is still alive, and we have retries left.
          // Guard: exclude events where THIS channel is the A-leg (wasHoldWindowALeg).
          // That prevents the A-leg's own terminal CHANNEL_HANGUP_COMPLETE from
          // treating its stale otherLegUuid (a dead B-leg not in holdWindowRetries
          // → value = 0 < MAX) as a fresh hold-window opening.
          const holdWindowActive = (
            !wasHoldWindowALeg &&
            isOfflineCause &&
            !!otherLegUuid &&
            !!missedCallEntry &&
            (this.holdWindowRetries.get(otherLegUuid) ?? 0) < MAX_HOLD_RETRIES
          );

          // ── Create missed-call record (exactly once per call pair) ────────────
          //
          // Both A-leg and B-leg events may satisfy isMissedForCallee. Guard with
          // a per-call-pair key so we only create one DB record even if both legs
          // carry a missed cause (e.g. both get USER_NOT_REGISTERED).
          // SUPPRESSED while holdWindowActive — the call may still connect.
          if (missedCallEntry && isMissedForCallee && !holdWindowActive) {
            const callPairKey = [uuid, otherLegUuid].filter(Boolean).sort().join(":");
            if (!this.missedCallProcessed.has(callPairKey)) {
              this.missedCallProcessed.add(callPairKey);
              // Evict the key after 5 minutes to prevent unbounded Set growth.
              setTimeout(() => this.missedCallProcessed.delete(callPairKey), 300_000);

              const { destExt, callerExt } = missedCallEntry;
              recordEslTrace(uuid, "MISSED_CALL_PENDING");
              this.sendMissedCallPush(uuid, destExt, callerExt)
                .catch((e) => logger.error({ err: e }, "[Push] Missed call push error"));
              this.createMissedCallRecordForCallee(uuid, destExt, callerExt, hangupCause)
                .then(() => recordEslTrace(uuid, "MISSED_CALL_CREATED"))
                .catch((e) => logger.error({ err: e }, "[ESL] Missed call record error"));
            } else {
              logger.debug(
                { uuid, otherLegUuid, callPairKey },
                "[ESL] CHANNEL_HANGUP_COMPLETE: missed-call record already created for this call pair — skipping duplicate",
              );
            }
          }

          // Also notify the CALLER when the call could not be connected.
          // The Verto bye covers the case where the tab is in focus; this push
          // covers the case where the caller backgrounded their app after dialling.
          // SUPPRESSED while holdWindowActive — the call may still connect.
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
          if (missedCallEntry && shouldNotifyCaller && !holdWindowActive) {
            const { destExt, callerExt } = missedCallEntry;
            this.sendCallerCallFailedPush(callerExt, destExt, hangupCause)
              .catch((e) => logger.error({ err: e }, "[Push] Caller call-failed push error"));
          }

          // Auto-recover when the callee's extension was not registered.
          // Fires a lightweight sofia rescan (no SSH), sends the callee a
          // "please reopen the app" push, and — if the problem persists —
          // falls back to a full SSH config push (debounced to 5 min).
          // Only runs on the FIRST failure — suppressed on hold-window retries
          // (retries 2-4) to avoid spamming "please reopen" each 5 s.
          const alreadyInHoldWindow = isOfflineCause && !!otherLegUuid &&
            (this.holdWindowRetries.get(otherLegUuid) ?? 0) > 0;
          if (
            (hangupCause === "USER_NOT_REGISTERED" ||
             hangupCause === "UNREGISTERED"        ||
             hangupCause === "DESTINATION_OUT_OF_ORDER") &&
            missedCallEntry &&
            !alreadyInHoldWindow
          ) {
            this.autoRecoverUnregistered(missedCallEntry.destExt)
              .catch((e) => logger.error({ err: e }, "[ESL] AUTO_RECOVERY error"));
          }

          // ── One-time originate retry on NORMAL_TEMPORARY_FAILURE ──────────────
          //
          // This cause is a transient glitch (overloaded SIP server, briefly
          // unavailable endpoint, ICE failure during renegotiation). The A-leg
          // (caller) is almost certainly still alive — otherLegUuid is the
          // A-leg channel that is waiting for the bridge.
          //
          // Strategy: re-originate to the original B-leg destination and bridge
          // the result into the still-alive A-leg using &bridge(aLegUuid).
          // Capped at 1 retry to prevent loops.  A 1.5 s delay gives FreeSWITCH
          // time to clean up the failed B-leg channel before the new attempt.
          if (
            hangupCause === "NORMAL_TEMPORARY_FAILURE" &&
            otherLegUuid &&
            missedCallEntry &&
            (this.retryAttempts.get(otherLegUuid) ?? 0) < 1
          ) {
            const retryCount = (this.retryAttempts.get(otherLegUuid) ?? 0) + 1;
            this.retryAttempts.set(otherLegUuid, retryCount);
            // Evict retry counter after 30 s so the Map doesn't grow unbounded.
            setTimeout(() => this.retryAttempts.delete(otherLegUuid), 30_000);

            const { destExt, callerExt } = missedCallEntry;
            const domain = process.env.FREESWITCH_DOMAIN ?? "localhost";
            const aLegUuid = otherLegUuid;

            logger.info(
              { aLegUuid, destExt, callerExt, retryCount },
              "[ESL] NORMAL_TEMPORARY_FAILURE: scheduling 1-time re-originate after 1.5 s",
            );

            setTimeout(() => {
              // Originate a new B-leg and bridge it to the still-alive A-leg.
              // originate_timeout=25 gives the callee a reasonable ring window
              // without blocking the A-leg indefinitely.
              const retryInj     = this.pendingCallerIdInjections.get(aLegUuid);
              const retryCidNum  = retryInj?.callerIdNumber ?? callerExt;
              const retryCidName = retryInj?.callerIdName   ?? "";
              const retryCidVars = retryCidName
                ? `origination_caller_id_number=${retryCidNum},origination_caller_id_name=${retryCidName},originate_timeout=25`
                : `origination_caller_id_number=${retryCidNum},originate_timeout=25`;
              const retryCmd = [
                `originate`,
                `{${retryCidVars}}`,
                `user/${destExt}@${domain}`,
                `&bridge(${aLegUuid})`,
              ].join(" ");
              logger.info(
                { aLegUuid, destExt, callerExt, retryCmd },
                "[ESL] NORMAL_TEMPORARY_FAILURE retry: issuing re-originate",
              );
              this.sendApiCommand(retryCmd);
            }, 1_500);
          }

          // ── Hold-window retry for offline callee (UNREGISTERED) ───────────────
          //
          // Fires when the B-leg failed because the callee was offline AND we
          // have retries remaining.  Each retry is sequential: we schedule a
          // 5 s re-originate here; when THAT B-leg fires CHANNEL_HANGUP_COMPLETE
          // (offline again) this block runs again and schedules the next retry
          // until MAX_HOLD_RETRIES is reached.
          //
          // On the very first failure (retryCount will become 1):
          //   • Send an incoming-call wakeup push so the device wakes up.
          //   • The autoRecoverUnregistered "please reopen" push also fires above.
          //
          // The dialplan hold window (playback loops=5 ≈ 30 s) keeps the A-leg
          // on ringback for the duration; &bridge(A-leg) issued here interrupts
          // that playback and connects the call.
          if (holdWindowActive && otherLegUuid && missedCallEntry) {
            const aLegUuid = otherLegUuid;
            const priorRetries = this.holdWindowRetries.get(aLegUuid) ?? 0;
            const newRetryCount = priorRetries + 1;
            this.holdWindowRetries.set(aLegUuid, newRetryCount);
            // Evict after 60 s as a safety net (normal flow deletes on success
            // or A-leg hangup; this prevents unbounded Map growth on any edge case).
            setTimeout(() => {
              if ((this.holdWindowRetries.get(aLegUuid) ?? 0) === newRetryCount) {
                this.holdWindowRetries.delete(aLegUuid);
              }
            }, 60_000);

            const { destExt, callerExt } = missedCallEntry;
            const domain = process.env.FREESWITCH_DOMAIN ?? "localhost";

            logger.info(
              { aLegUuid, destExt, callerExt, hangupCause, retryNum: newRetryCount, maxRetries: MAX_HOLD_RETRIES },
              "[ESL] HOLD_WINDOW: callee offline — scheduling re-originate",
            );

            // On first failure only: send incoming-call wakeup push so the device
            // starts waking up in time for the first retry at t+5 s.
            if (newRetryCount === 1) {
              sendIncomingCallWakeupByExt(destExt, callerExt, aLegUuid)
                .catch((e) => logger.error({ err: e }, "[ESL] HOLD_WINDOW wakeup push failed"));
            }

            setTimeout(() => {
              // Guard: A-leg channel may have died while we were waiting (caller
              // hung up, dialplan timeout, etc.) — the A-leg cancellation block
              // above deletes the entry when the A-leg fires CHANNEL_HANGUP_COMPLETE.
              if (!this.holdWindowRetries.has(aLegUuid)) {
                logger.info(
                  { aLegUuid, destExt, retryNum: newRetryCount },
                  "[ESL] HOLD_WINDOW: A-leg gone before retry fired — aborting",
                );
                return;
              }
              // Re-originate to the callee and bridge the result into the A-leg.
              // originate_timeout=8: give the newly-registered callee enough time
              // to accept the incoming ring without blocking the A-leg too long.
              const hwInj     = this.pendingCallerIdInjections.get(aLegUuid);
              const hwCidNum  = hwInj?.callerIdNumber ?? callerExt;
              const hwCidName = hwInj?.callerIdName   ?? "";
              const hwCidVars = hwCidName
                ? `origination_caller_id_number=${hwCidNum},origination_caller_id_name=${hwCidName},originate_timeout=8`
                : `origination_caller_id_number=${hwCidNum},originate_timeout=8`;
              const hwCmd = `originate {${hwCidVars}}user/${destExt}@${domain} &bridge(${aLegUuid})`;
              logger.info(
                { aLegUuid, destExt, callerExt, retryNum: newRetryCount, hwCmd },
                "[ESL] HOLD_WINDOW: issuing re-originate",
              );
              this.sendApiCommand(hwCmd);
            }, 5_000);
          }

          // Notify B-leg manager about the failure so per-call state stays accurate.
          // We look up by B-leg UUID first; fall back to other-leg UUID.
          if (
            hangupCause === "USER_NOT_REGISTERED" ||
            hangupCause === "UNREGISTERED"         ||
            hangupCause === "SUBSCRIBER_ABSENT"    ||
            hangupCause === "DESTINATION_OUT_OF_ORDER" ||
            hangupCause === "NO_ROUTE_DESTINATION" ||
            hangupCause === "NORMAL_TEMPORARY_FAILURE" ||
            hangupCause === "NO_ANSWER"            ||
            hangupCause === "CALL_REJECTED"        ||
            hangupCause === "RECOVERY_ON_TIMER_EXPIRE"
          ) {
            // Resolve callId from DB asynchronously — best-effort
            connectDB().then(async () => {
              const { CallModel: CM } = await import("@workspace/db");
              const call = await CM.findOne({
                $or: [{ fsCallId: uuid }, { fsCallId: otherLegUuid }],
              }).select("_id").lean();
              if (call) {
                recordBLegFailed(String(call._id), hangupCause, uuid);
              }
            }).catch(() => {});
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

      } else if (evtName === "CUSTOM") {
        // FreeSWITCH fires CUSTOM events with an Event-Subclass for sofia
        // registration lifecycle.  These are the authoritative ground-truth
        // events — if ESL says a user registered/expired, we update the
        // SIP session map regardless of what the SIP proxy already recorded.
        const subclass = body["Event-Subclass"] ?? "";
        if (subclass === "sofia::register" || subclass === "sofia::pre-register") {
          this.handleSofiaRegister(body);
        } else if (subclass === "sofia::unregister" || subclass === "sofia::expire") {
          this.handleSofiaUnregister(body);
        }
      }
    }
  }

  private handleSofiaRegister(body: Record<string, string>): void {
    // FreeSWITCH populates several aliases; prefer sip-to-user, fall back to from-user.
    const rawExt = body["sip-to-user"] ?? body["from-user"] ?? body["sip-username"] ?? "";
    const ext    = parseInt(rawExt, 10);
    if (!ext || ext < 1000 || ext > 9999) return;

    const expiresSec = parseInt(body["expires"] ?? "3600", 10) || 3600;
    const contact    = body["contact"]    ?? body["sip-contact"] ?? undefined;
    const networkIp  = body["network-ip"] ?? body["sip-network-ip"] ?? undefined;

    // ── SIP registration flood detection ────────────────────────────────────
    // Track per-source-IP registration events within a 60-second rolling window.
    // A burst > SIP_FLOOD_THRESHOLD per minute from one IP is characteristic of
    // a registration scanner or misconfigured UA hammering the SIP stack.
    // We log a warning and bump the metric — actual blocking is enforced by
    // FreeSWITCH sofia ACL (configure sip-ip-blacklist in sofia.conf.xml).
    if (networkIp) {
      const now = Date.now();
      const record = sipRegCountByIp.get(networkIp);
      if (!record || now - record.windowStart >= 60_000) {
        sipRegCountByIp.set(networkIp, { count: 1, windowStart: now });
      } else {
        record.count++;
        if (record.count === SIP_FLOOD_THRESHOLD) {
          metrics.sipFloodBlocked++;
          logger.warn(
            {
              networkIp,
              registrationCount: record.count,
              windowSec: Math.round((now - record.windowStart) / 1000),
              threshold: SIP_FLOOD_THRESHOLD,
            },
            "[ESL] SIP registration flood detected — single IP exceeded threshold. " +
            "Recommend adding to FreeSWITCH sofia ACL blacklist to reject at protocol level.",
          );
        }
      }
    }

    registerSipSession(buildSipSession(ext, { contact, networkIp, expiresSec }));
    logger.info(
      { ext, expiresSec, networkIp, contact, subclass: body["Event-Subclass"] },
      "[ESL] SIP registration confirmed via sofia event",
    );

    // Notify any callers blocked in waitForRegistration() so the callee-ready
    // endpoint can return immediately instead of waiting for the poll interval.
    notifyRegistration(ext);

    // If this extension had an active call and its Verto/SIP session dropped
    // (e.g. browser reconnect, brief network flap), cancel the disconnect watchdog
    // now that the session is back — prevents a false uuid_kill on the A-leg.
    notifyALegSessionReconnected(ext);
  }

  private handleSofiaUnregister(body: Record<string, string>): void {
    const rawExt = body["sip-to-user"] ?? body["from-user"] ?? body["sip-username"] ?? "";
    const ext    = parseInt(rawExt, 10);
    if (!ext || ext < 1000 || ext > 9999) return;

    unregisterSipSession(ext);
    logger.info(
      { ext, subclass: body["Event-Subclass"] },
      "[ESL] SIP session removed via sofia unregister/expire event",
    );
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
    // FreeSWITCH sometimes includes "@domain" in the destination field
    // (e.g. "1002@internal.domain").  Strip it before the extension regex test.
    const rawDestExt = h["Caller-Destination-Number"] ?? h["Channel-Destination-Number"] ?? "";
    // Strip @domain suffix first, then any sofia/verto/ or user/ URI prefix so
    // the regex guard below sees a plain extension number.
    const destExt    = rawDestExt.replace(/@.*$/, "").replace(/^.*\//, "").trim();
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
    if (!/^[1-9]\d{3}$/.test(destExt)) {
      logger.warn(
        { bLegUuid, rawDestExt, destExt },
        "[ESL] CHANNEL_ORIGINATE — destExt failed 4-digit guard; callee push skipped",
      );
      return;
    }

    this.originateDestMap.set(bLegUuid, { destExt, callerExt });

    // Notify the B-leg manager that CHANNEL_ORIGINATE fired — B-leg confirmed.
    // Uses destExt + aLegUuid to find the matching per-call state.
    if (/^[1-9]\d{3}$/.test(destExt)) {
      recordOriginateConfirmed(bLegUuid, aLegUuid, parseInt(destExt, 10));
    }

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
      callerDisplay = callerUser?.name ?? (callerUser?.phoneVerified ? callerUser.phone : undefined) ?? "Unknown caller";
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
      if (callerExtNum) {
        const callerUser = await UserModel.findOne({ extension: callerExtNum })
          .select("phone phoneVerified")
          .lean();
        // Store verified phone in call record; fall back to extension string for unverified.
        if (callerUser?.phoneVerified && callerUser.phone) callerPhone = callerUser.phone;
      }
      // Also resolve the callee's phone for recipientNumber
      const destUserFull = await UserModel.findById(destUser._id).select("phone").lean();
      const destPhone = destUserFull?.phone ?? destExt;

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
      destDisplay = destUser?.name ?? (destUser?.phoneVerified ? (destUser?.phone ?? "Unknown caller") : "Unknown caller");
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

  /**
   * Auto-recovery triggered when a call fails with USER_NOT_REGISTERED or
   * UNREGISTERED.  Three actions, all debounced to prevent storms:
   *
   *  1. `sofia profile prawwplus_mobile rescan` via ESL — instant, no SSH,
   *     tells FreeSWITCH to re-check gateway/directory config.
   *  2. Push notification to the callee — tells them to reopen the app so
   *     their Verto WebSocket reconnects and the extension re-registers.
   *  3. Full SSH config push (lightReload) — heavy fallback that re-deploys
   *     xml_curl config; only fires when the rescan isn't enough.
   */
  private async autoRecoverUnregistered(destExt: string): Promise<void> {
    const now = Date.now();

    // 1. Lightweight sofia rescan — rescans the SIP/WS profile:
    //    prawwplus_mobile: JsSIP / SIP-over-WS registrations
    //    (mod_verto does not use sofia profile commands; its directory
    //    is refreshed automatically via xml_curl on each auth request)
    //    Debounced to once per minute to prevent rescan storms on repeated failures.
    if (now - lastAutoRescanAt >= AUTO_RESCAN_DEBOUNCE_MS) {
      lastAutoRescanAt = now;
      // Rescan all known SIP/WS profiles so registrations are refreshed.
      // prawwplus_mobile: JsSIP / SIP-over-WS (browser/mobile)
      // prawwplus:        fallback SIP profile used by some clients
      // Verto (mod_verto) does not use sofia profile commands; its directory
      // is refreshed automatically via xml_curl on each auth request.
      this.sendApiCommand("sofia profile prawwplus_mobile rescan");
      this.sendApiCommand("sofia profile prawwplus_verto rescan");
      logger.info(
        { destExt },
        "[ESL] AUTO_RECOVERY: sofia rescan triggered on prawwplus_mobile + prawwplus_verto profiles",
      );
    }

    // Track the recovery attempt in the B-leg manager so admin diagnostics
    // can show how many times recovery was triggered for this destination.
    const destExtNum = parseInt(destExt, 10);
    if (destExtNum >= 1000 && destExtNum <= 9999) {
      recordRecoveryAttempt(destExtNum);
    }

    // 2. Push notification to callee: "please reopen the app"
    try {
      await connectDB();
      const user = await UserModel.findOne({ extension: parseInt(destExt, 10) })
        .select("expoPushToken fcmToken webPushSubscription")
        .lean();
      if (user && (user.expoPushToken || user.fcmToken || user.webPushSubscription)) {
        const pushData = { type: "reopen_required", extension: destExt };
        const title = "Action Required";
        const body  = "Please reopen PRaww+ to receive calls.";
        if (user.fcmToken) {
          await sendFcmDataMessage(user.fcmToken, pushData, { title, body });
        }
        if (user.expoPushToken) {
          await sendExpoPush(user.expoPushToken, title, body, pushData);
        }
        if (user.webPushSubscription) {
          await sendWebPush(
            user.webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } },
            { ...pushData, title, body },
            "",
          );
        }
        logger.info({ destExt }, "[ESL] AUTO_RECOVERY: reopen push sent to callee");
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message, destExt }, "[ESL] AUTO_RECOVERY: reopen push failed");
    }

    // 3. Full SSH config push — lightReload only (no mod_verto/sofia restart)
    //    so active calls are not disrupted. Debounced to once per 5 minutes.
    if (now - lastAutoSshPushAt >= AUTO_SSH_PUSH_DEBOUNCE_MS) {
      lastAutoSshPushAt = now;
      logger.info({ destExt }, "[ESL] AUTO_RECOVERY: triggering SSH config push (lightReload, debounced 5 min)");
      pushFreeSwitchConfig({ lightReload: true })
        .then((r) => logger.info({ steps: r.steps, ok: r.success }, "[ESL] AUTO_RECOVERY: SSH config push done"))
        .catch((e) => logger.warn({ err: (e as Error).message }, "[ESL] AUTO_RECOVERY: SSH config push failed"));
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
      callerDisplay = callerUser?.name ?? (callerUser?.phoneVerified ? callerUser.phone : undefined) ?? "Unknown caller";
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

  // Recover any in-flight calls that were active before this process started.
  // Runs asynchronously so it does not block the ESL connection setup.
  recoverActiveCallsOnStartup().catch((err) =>
    logger.warn({ err }, "[ESL] startup: call recovery failed"),
  );
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
  eventsLastMinute: number;
  eventsThisMinute: number;
  bgapiQueueDepth: number;
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
    reconnectAttempt:  eslClient?.getReconnectAttempt() ?? 0,
    eventsLastMinute:  eslEventsLastMinute,
    eventsThisMinute:  eslEventsThisMinute,
    bgapiQueueDepth:   eslClient?.getBgapiQueueDepth() ?? 0,
  };
}

export function sendEslApiCommand(cmd: string): boolean {
  if (!eslClient?.isConnected()) return false;
  eslClient.sendApiCommand(cmd);
  return true;
}

/**
 * Send a bgapi command to FreeSWITCH and await the BACKGROUND_JOB result.
 * Returns the raw result string ("+OK ..." or "-ERR ...").
 * Resolves with "-ERR ESL not connected" if ESL is down.
 * Resolves with "-ERR timeout after Nms" if FreeSWITCH takes too long.
 *
 * Used by the synchronous diagnostics endpoint so admins see real FS output
 * directly in the HTTP response rather than having to read server logs.
 */
export function sendEslBgapiAwait(cmd: string, timeoutMs = 10_000): Promise<string> {
  if (!eslClient?.isConnected()) return Promise.resolve("-ERR ESL not connected");
  return eslClient.sendApiCommandAwait(cmd, timeoutMs);
}

/**
 * Register a server-selected caller ID to be injected into a FreeSWITCH
 * channel via uuid_setvar_multi when CHANNEL_CREATE fires.
 *
 * Must be called after POST /calls computes the caller ID and before the
 * Verto/SIP client sends invite (i.e. before CHANNEL_CREATE fires).
 *
 * Safe to call when ESL is not connected — the injection is simply skipped.
 */
export function registerCallerIdInjection(
  fsCallId:       string,
  callerIdNumber: string,
  callerIdName:   string,
  callType:       string,
): void {
  if (!eslClient) return;
  eslClient.registerCallerIdInjection(fsCallId, callerIdNumber, callerIdName, callType);
}
