/**
 * WebSocket proxy for FreeSWITCH SIP/WS protocol (mod_sofia).
 *
 * Mobile JsSIP clients connect via:
 *   wss://APP_URL/api/sip/ws  →  ws://freeswitch:5066
 *
 * In addition to proxying raw WebSocket frames, this module inspects the
 * SIP messages that flow through the connection to maintain the in-memory
 * SIP session map (callSession.ts).  Tracking here provides low-latency
 * session state even before the FreeSWITCH ESL sofia::register event fires.
 *
 * Registration flow tracked:
 *   Client → Upstream:  REGISTER with Expires > 0  → store pendingExt
 *   Upstream → Client:  SIP/2.0 200 OK + CSeq REGISTER → confirm session
 *   Client → Upstream:  REGISTER with Expires: 0     → immediate deregister
 *   Client disconnect:                                → deregister cleanup
 *
 * The ESL sofia::register/unregister events in freeswitchESL.ts act as an
 * authoritative second source and will overwrite whatever this proxy sets,
 * so both can safely coexist without coordination.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { logger } from "./logger";
import { getSshForwardUrl } from "./sshForwardServer";
import { metrics } from "./metrics";
import {
  registerSipSession,
  unregisterSipSession,
  buildSipSession,
} from "./callSession";

const RECEIVE_ONLY_CODES = new Set([1005, 1006, 1015]);

function safeCloseCode(code: number): number {
  return RECEIVE_ONLY_CODES.has(code) ? 1001 : code;
}

function isLocalWsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function wsPort(raw: string, fallback: number): number {
  try {
    const url = new URL(raw);
    return parseInt(url.port || String(fallback), 10);
  } catch {
    return fallback;
  }
}

async function getSipWsUrl(): Promise<string> {
  // Priority:
  // 1. FREESWITCH_SIP_WS_URL — explicit internal WS URL (e.g. ws://127.0.0.1:5066)
  // 2. Derive from FREESWITCH_ESL_HOST:FREESWITCH_SIP_WS_PORT (both internal)
  //    Never use FREESWITCH_DOMAIN — that may be the public IP, but FreeSWITCH
  //    WS profile only listens on 127.0.0.1 inside the VPS.
  const explicit = process.env.FREESWITCH_SIP_WS_URL?.trim();
  if (explicit) {
    if (isLocalWsUrl(explicit)) return (await getSshForwardUrl(wsPort(explicit, 5066))) ?? explicit;
    return explicit;
  }

  const host = process.env.FREESWITCH_ESL_HOST?.trim() || "127.0.0.1";
  const port = process.env.FREESWITCH_SIP_WS_PORT?.trim() ?? "5066";
  const configured = `ws://${host}:${port}/`;
  if (isLocalWsUrl(configured)) return (await getSshForwardUrl(wsPort(configured, 5066))) ?? configured;
  return configured;
}

const PENDING_BUFFER_LIMIT = 50;
const HEARTBEAT_INTERVAL_MS = 30_000;

// Upstream retry — mirrors the Verto proxy retry strategy.
// When FreeSWITCH's SIP/WS profile is briefly unavailable (e.g. config reload),
// retry the upstream connection before closing the mobile client.
const MAX_UPSTREAM_RETRIES   = 4;
const UPSTREAM_RETRY_BASE_MS = 2_000; // 2 s, 4 s, 6 s, 8 s

// ── SIP message inspection helpers ───────────────────────────────────────────

/**
 * Extract the SIP extension (4-digit, 1000–9999) from the From: header.
 * Handles both `From: <sip:1001@domain>` and `From: "Name" <sip:1001@domain>`.
 */
function parseSipFromExtension(msg: string): number | null {
  const m = msg.match(/^From:\s*(?:"[^"]*"\s*)?<sip:(\d+)@/im);
  if (!m) return null;
  const ext = parseInt(m[1], 10);
  return ext >= 1000 && ext <= 9999 ? ext : null;
}

/**
 * Parse the Expires value from a SIP message.
 * Checks the top-level `Expires:` header first, then the Contact `expires=` param.
 */
function parseSipExpires(msg: string): number {
  const hdr = msg.match(/^Expires:\s*(\d+)/im);
  if (hdr) return parseInt(hdr[1], 10);
  const contact = msg.match(/;expires=(\d+)/i);
  if (contact) return parseInt(contact[1], 10);
  return 3600;
}

/** True when the SIP message is a REGISTER request. */
function isSipRegister(msg: string): boolean {
  return /^REGISTER\s+sip:/i.test(msg.trimStart());
}

/** True when the SIP message is a 200 OK response to a REGISTER (CSeq method check). */
function isSip200OkToRegister(msg: string): boolean {
  return (
    /^SIP\/2\.0\s+200\b/i.test(msg.trimStart()) &&
    /^CSeq:\s*\d+\s+REGISTER\b/im.test(msg)
  );
}

/** True when this is a de-registration (REGISTER with Expires: 0). */
function isSipDeregister(msg: string): boolean {
  return isSipRegister(msg) && /^Expires:\s*0\b/im.test(msg);
}

/**
 * Extract the SIP Contact URI from a message.
 * Returns just the URI inside the angle brackets, e.g. "sip:1001@ws.client".
 */
function parseSipContact(msg: string): string | undefined {
  const m = msg.match(/^Contact:\s*<([^>]+)>/im);
  return m?.[1];
}

// ── Per-connection SIP session state ─────────────────────────────────────────

interface SipConnectionState {
  /** Extension extracted from the most recent REGISTER From: header. */
  pendingExt: number | null;
  /** Extension whose session is currently active (post-200 OK confirmation). */
  activeExt:  number | null;
}

// ── Proxy factory ─────────────────────────────────────────────────────────────

export function createSipProxy(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (client: WebSocket, _req: IncomingMessage) => {
    let upstreamUrl: string;
    try {
      upstreamUrl = await getSipWsUrl();
    } catch (err) {
      logger.warn({ err }, "SIP proxy: upstream configuration failed");
      client.close(1011, Buffer.from("upstream configuration failed"));
      return;
    }
    metrics.activeSipClients++;
    logger.info({ upstreamUrl, activeClients: metrics.activeSipClients }, "SIP proxy: client connected, opening upstream");

    // Per-connection state for SIP registration tracking
    const sipState: SipConnectionState = { pendingExt: null, activeExt: null };

    // Buffer messages that arrive from the mobile client while the upstream
    // WebSocket is still in CONNECTING state.  Without this the SIP REGISTER
    // sent immediately on connect is silently dropped, causing registration
    // failures (the primary "mobile SIP not connecting" bug).
    // Capped at PENDING_BUFFER_LIMIT to prevent OOM from misbehaving clients.
    const pendingToUpstream: Array<{ data: Parameters<WebSocket["send"]>[0]; isBinary: boolean }> = [];

    // Ping/pong heartbeat — detects zombie half-open sockets on mobile networks.
    const heartbeat = setInterval(() => {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }, HEARTBEAT_INTERVAL_MS);
    client.on("pong", () => { /* connection alive — no-op */ });
    const cleanup = () => clearInterval(heartbeat);

    // Mutable upstream reference — updated each retry so the client message
    // handler always sends to the active upstream WebSocket.
    let upstream: WebSocket;
    let upstreamRetryCount = 0;
    let clientDestroyed    = false;
    let retryScheduled     = false;

    function attachUpstream(ws: WebSocket): void {
      upstream = ws;

      ws.on("open", () => {
        upstreamRetryCount = 0;
        retryScheduled     = false;
        logger.debug({ attempt: upstreamRetryCount + 1 }, "SIP proxy: upstream connected");
        // Flush any messages buffered while we were connecting / retrying.
        for (const msg of pendingToUpstream.splice(0)) {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(msg.data, { binary: msg.isBinary });
          }
        }
      });

      // ── Upstream → Client (responses from FreeSWITCH) ──────────────────────
      ws.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }

        // Inspect text frames only — binary SIP over WS is uncommon but possible
        if (!isBinary) {
          try {
            const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);

            if (isSip200OkToRegister(text) && sipState.pendingExt !== null) {
              // FreeSWITCH confirmed the registration
              const ext = sipState.pendingExt;
              const expiresSec = parseSipExpires(text);
              const contact = parseSipContact(text);

              if (expiresSec > 0) {
                registerSipSession(buildSipSession(ext, { contact, expiresSec }));
                sipState.activeExt  = ext;
                sipState.pendingExt = null;
                logger.info({ ext, expiresSec, contact }, "SIP proxy: registration confirmed via 200 OK");
              } else {
                // 200 OK to a de-REGISTER
                unregisterSipSession(ext);
                sipState.activeExt  = null;
                sipState.pendingExt = null;
                logger.info({ ext }, "SIP proxy: de-registration confirmed via 200 OK Expires=0");
              }
            }
          } catch {
            // Non-fatal — inspection errors must never break the proxy
          }
        }
      });

      ws.on("error", (err) => {
        if (!clientDestroyed && upstreamRetryCount < MAX_UPSTREAM_RETRIES) {
          upstreamRetryCount++;
          retryScheduled = true;
          logger.warn(
            { err: err.message, attempt: upstreamRetryCount, max: MAX_UPSTREAM_RETRIES, upstreamUrl },
            "SIP proxy: upstream error — will retry after delay",
          );
        } else {
          retryScheduled = false;
          logger.warn(
            { err: err.message, attempt: upstreamRetryCount, upstreamUrl },
            "SIP proxy: upstream error — all retries exhausted, closing client",
          );
        }
      });

      ws.on("close", (code, reason) => {
        if (retryScheduled && !clientDestroyed) {
          const delayMs = UPSTREAM_RETRY_BASE_MS * upstreamRetryCount;
          logger.info(
            { delayMs, attempt: upstreamRetryCount, max: MAX_UPSTREAM_RETRIES },
            "SIP proxy: upstream closed — scheduling retry",
          );
          setTimeout(() => {
            if (!clientDestroyed) {
              attachUpstream(new WebSocket(upstreamUrl, ["sip"]));
            }
          }, delayMs);
          retryScheduled = false;
        } else {
          metrics.upstreamDisconnectsSip++;
          const safe = safeCloseCode(code);
          logger.info({ code, safe, reason: reason.toString() }, "SIP proxy: upstream closed");
          if (client.readyState === WebSocket.OPEN) client.close(safe, reason);
        }
      });
    }

    // Kick off the first upstream connection.
    attachUpstream(new WebSocket(upstreamUrl, ["sip"]));

    // ── Client → Upstream (requests from JsSIP/mobile) ───────────────────────
    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        // Upstream not yet open — buffer so the SIP REGISTER isn't lost.
        // Drop oldest when cap is reached to prevent OOM.
        if (pendingToUpstream.length >= PENDING_BUFFER_LIMIT) pendingToUpstream.shift();
        pendingToUpstream.push({ data, isBinary });
      }

      // Inspect text frames for SIP REGISTER messages
      if (!isBinary) {
        try {
          const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);

          if (isSipRegister(text)) {
            const ext = parseSipFromExtension(text);
            if (ext !== null) {
              if (isSipDeregister(text)) {
                // Client is explicitly de-registering — remove immediately.
                // The 200 OK handler will also fire and is idempotent.
                unregisterSipSession(ext);
                sipState.activeExt  = null;
                sipState.pendingExt = null;
                logger.info({ ext }, "SIP proxy: REGISTER Expires:0 — immediate deregister");
              } else {
                // Normal registration or refresh — record pending extension;
                // session is only confirmed when FreeSWITCH responds 200 OK.
                sipState.pendingExt = ext;
                logger.debug({ ext }, "SIP proxy: REGISTER seen — awaiting 200 OK from FS");
              }
            }
          }
        } catch {
          // Non-fatal — inspection errors must never break the proxy
        }
      }
    });

    client.on("close", (code, reason) => {
      clientDestroyed = true;
      cleanup();
      metrics.wsDisconnectsSip++;
      metrics.activeSipClients = Math.max(0, metrics.activeSipClients - 1);
      const safe = safeCloseCode(code);
      logger.info({ code, safe, reason: reason.toString(), activeClients: metrics.activeSipClients }, "SIP proxy: client closed");
      if (upstream.readyState === WebSocket.OPEN) upstream.close(safe, reason);

      // Clean up SIP session on disconnect — covers cases where:
      //   - Client closed the tab/app without sending de-REGISTER
      //   - Network was cut (keepalive detected disconnect)
      // The ESL sofia::expire event will also fire when FS detects the
      // registration has lapsed, providing a redundant cleanup path.
      if (sipState.activeExt !== null) {
        unregisterSipSession(sipState.activeExt);
        logger.info({ ext: sipState.activeExt }, "SIP proxy: client disconnected — SIP session removed");
        sipState.activeExt = null;
      }
      sipState.pendingExt = null;
    });

    client.on("error", (err) => {
      clientDestroyed = true;
      cleanup();
      logger.warn({ err: err.message }, "SIP proxy: client error");
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1011, Buffer.from("client error"));
    });
  });

  return wss;
}

export function attachSipProxy(
  server: import("http").Server,
  wss: WebSocketServer,
): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith("/api/sip/ws")) {
      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      } catch (err) {
        logger.error({ err }, "SIP proxy: handleUpgrade threw — destroying socket");
        socket.destroy();
      }
    }
  });
}
