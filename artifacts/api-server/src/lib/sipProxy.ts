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
 * Hardening implemented:
 *   1. Per-client configurable buffer size cap (PROXY_BUFFER_LIMIT / env)
 *   2. Message TTL — stale REGISTER/INVITE packets evicted before replay
 *   3. Auth-gated flush — queue replayed only after FreeSWITCH confirms
 *      REGISTER (200 OK), not merely on WebSocket OPEN
 *   4. Metrics — buffered-drop count, reconnect duration, flush latency
 *   5. Reconnect storm protection — global cap on concurrent upstream reconnects
 *   6. Structured disconnect reasons — freeswitch_restart / network_loss /
 *      auth_rejection / upstream_timeout / normal_close
 *   7. Ordered replay — REGISTER sorted first in buffer so it always
 *      precedes SIP INVITE / re-INVITE on reconnect
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server }          from "http";
import type { IncomingMessage } from "http";
import type { Duplex }          from "stream";
import { logger } from "./logger";
import { getSshForwardUrl } from "./sshForwardServer";
import { metrics } from "./metrics";
import {
  registerSipSession,
  unregisterSipSession,
  buildSipSession,
} from "./callSession";
import {
  type BufferedMessage,
  type DisconnectReason,
  readProxyBufferConfig,
  enqueueMessage,
  evictStaleMessages,
  sortBufferForReplay,
  acquireReconnectSlot,
  releaseReconnectSlot,
  classifyDisconnectReason,
} from "./proxyBuffer";

// ── Constants ─────────────────────────────────────────────────────────────────

const RECEIVE_ONLY_CODES = new Set([1005, 1006, 1015]);

function safeCloseCode(code: number): number {
  return RECEIVE_ONLY_CODES.has(code) ? 1001 : code;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

const MAX_UPSTREAM_RETRIES   = 4;
const UPSTREAM_RETRY_BASE_MS = 2_000; // 2 s, 4 s, 6 s, 8 s

// Safety timeout: if no REGISTER 200 OK arrives within this window after
// sending the REGISTER frame, flush the buffer anyway so the session isn't stuck.
const AUTH_GATE_TIMEOUT_MS = 8_000;

// Buffer config — reads PROXY_BUFFER_LIMIT_SIP / PROXY_BUFFER_LIMIT /
// PROXY_BUFFER_TTL_MS_SIP / PROXY_BUFFER_TTL_MS from the environment.
const bufCfg = readProxyBufferConfig("sip");

// ── URL helpers ───────────────────────────────────────────────────────────────

/** Normalise a potentially protocol-relative URL (//host:port/) to a valid ws:// URL. */
function normaliseWsUrl(raw: string): string {
  if (raw.startsWith("//")) return `ws:${raw}`;
  return raw;
}

function isLocalWsUrl(raw: string): boolean {
  try {
    const url = new URL(normaliseWsUrl(raw));
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function wsPort(raw: string, fallback: number): number {
  try {
    const url = new URL(normaliseWsUrl(raw));
    return parseInt(url.port || String(fallback), 10);
  } catch {
    return fallback;
  }
}

async function getSipWsUrl(): Promise<string> {
  const explicit = process.env.FREESWITCH_SIP_WS_URL?.trim();
  if (explicit) {
    const normalised = normaliseWsUrl(explicit);
    if (isLocalWsUrl(normalised)) return (await getSshForwardUrl(wsPort(normalised, 5066))) ?? normalised;
    return normalised;
  }
  const host      = process.env.FREESWITCH_ESL_HOST?.trim() || "127.0.0.1";
  const port      = process.env.FREESWITCH_SIP_WS_PORT?.trim() ?? "5066";
  const configured = `ws://${host}:${port}/`;
  if (isLocalWsUrl(configured)) return (await getSshForwardUrl(wsPort(configured, 5066))) ?? configured;
  return configured;
}

// ── SIP message inspection helpers ───────────────────────────────────────────

function parseSipFromExtension(msg: string): number | null {
  const m = msg.match(/^From:\s*(?:"[^"]*"\s*)?<sip:(\d+)@/im);
  if (!m) return null;
  const ext = parseInt(m[1], 10);
  return ext >= 1000 && ext <= 9999 ? ext : null;
}

function parseSipExpires(msg: string): number {
  const hdr = msg.match(/^Expires:\s*(\d+)/im);
  if (hdr) return parseInt(hdr[1], 10);
  const contact = msg.match(/;expires=(\d+)/i);
  if (contact) return parseInt(contact[1], 10);
  return 3600;
}

function isSipRegister(msg: string): boolean {
  return /^REGISTER\s+sip:/i.test(msg.trimStart());
}

function isSip200OkToRegister(msg: string): boolean {
  return (
    /^SIP\/2\.0\s+200\b/i.test(msg.trimStart()) &&
    /^CSeq:\s*\d+\s+REGISTER\b/im.test(msg)
  );
}

function isSipDeregister(msg: string): boolean {
  return isSipRegister(msg) && /^Expires:\s*0\b/im.test(msg);
}

function parseSipContact(msg: string): string | undefined {
  const m = msg.match(/^Contact:\s*<([^>]+)>/im);
  return m?.[1];
}

/**
 * Returns priority=1 if data is a SIP REGISTER frame.
 * Priority=1 messages are sorted first in the replay queue so REGISTER
 * always reaches FreeSWITCH before any SIP INVITE on reconnect.
 */
function sipMessagePriority(data: BufferedMessage["data"], isBinary: boolean): 0 | 1 {
  if (isBinary) return 0;
  try {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    return isSipRegister(text) && !isSipDeregister(text) ? 1 : 0;
  } catch {
    return 0;
  }
}

// ── Per-connection SIP session state ─────────────────────────────────────────

interface SipConnectionState {
  pendingExt: number | null;
  activeExt:  number | null;
}

// ── Proxy factory ─────────────────────────────────────────────────────────────

export function createSipProxy(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
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
    logger.info(
      { upstreamUrl, activeClients: metrics.activeSipClients, bufLimit: bufCfg.limit, bufTtlMs: bufCfg.ttlMs },
      "SIP proxy: client connected, opening upstream",
    );

    // Per-connection SIP registration tracking.
    const sipState: SipConnectionState = { pendingExt: null, activeExt: null };

    // Per-client upstream message buffer.  Timestamped + priority-tagged so
    // we can evict stale frames and sort REGISTER to the front on replay.
    const pendingToUpstream: BufferedMessage[] = [];

    // Ping/pong heartbeat — detects zombie half-open sockets on mobile networks.
    const heartbeat = setInterval(() => {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }, HEARTBEAT_INTERVAL_MS);
    client.on("pong", () => { /* connection alive */ });
    const cleanup = () => clearInterval(heartbeat);

    // ── Per-connection upstream state ─────────────────────────────────────────
    let upstream: WebSocket;
    let upstreamRetryCount  = 0;
    let clientDestroyed     = false;
    let retryScheduled      = false;

    // Auth-gate state: prevent flushing the buffer until FreeSWITCH confirms
    // the REGISTER (200 OK) so SIP INVITE cannot arrive before registration.
    let upstreamReadyForData = false;
    let authGateActive       = false;
    let authGateTimer: ReturnType<typeof setTimeout> | null = null;

    // Reconnect duration tracking.
    let reconnectStartedAt   = 0;
    let lastUpstreamErr: Error | undefined;
    let lastDisconnectReason: DisconnectReason = "unknown";

    // ── Buffer helpers ────────────────────────────────────────────────────────

    function flushBuffer(): void {
      if (upstream.readyState !== WebSocket.OPEN) return;
      const staleDropped = evictStaleMessages(pendingToUpstream, bufCfg.ttlMs, "sip");
      if (staleDropped > 0) metrics.proxyMessagesDroppedSip += staleDropped;

      const flushStart = Date.now();
      const messages   = pendingToUpstream.splice(0);
      for (const msg of messages) {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(msg.data, { binary: msg.isBinary });
        }
      }
      const flushMs = Date.now() - flushStart;
      if (messages.length > 0) {
        metrics.recordProxyFlushLatency("sip", flushMs);
        logger.debug(
          { count: messages.length, flushMs },
          "SIP proxy: buffer flushed to upstream",
        );
      }
    }

    function activateAuthGate(): void {
      authGateActive = true;
      authGateTimer  = setTimeout(() => {
        authGateTimer = null;
        if (authGateActive) {
          logger.warn(
            { timeoutMs: AUTH_GATE_TIMEOUT_MS, upstreamUrl },
            "SIP proxy: auth gate timed out waiting for REGISTER 200 OK — flushing buffer anyway",
          );
          authGateActive       = false;
          upstreamReadyForData = true;
          flushBuffer();
        }
      }, AUTH_GATE_TIMEOUT_MS);
    }

    function clearAuthGate(): void {
      if (authGateTimer) {
        clearTimeout(authGateTimer);
        authGateTimer = null;
      }
      authGateActive       = false;
      upstreamReadyForData = true;
    }

    // ── attachUpstream ────────────────────────────────────────────────────────

    function attachUpstream(ws: WebSocket): void {
      upstream             = ws;
      upstreamReadyForData = false;
      authGateActive       = false;
      if (authGateTimer) { clearTimeout(authGateTimer); authGateTimer = null; }

      ws.on("open", () => {
        const reconnectMs  = reconnectStartedAt > 0 ? Date.now() - reconnectStartedAt : 0;
        upstreamRetryCount = 0;
        retryScheduled     = false;

        if (reconnectMs > 0) {
          metrics.recordProxyReconnectDuration("sip", reconnectMs);
          metrics.reconnectSuccesses++;
          logger.info(
            { reconnectMs, disconnectReason: lastDisconnectReason, upstreamUrl },
            "SIP proxy: upstream reconnected to FreeSWITCH",
          );
        } else {
          logger.debug({ upstreamUrl }, "SIP proxy: upstream connected");
        }

        releaseReconnectSlot("sip");

        // Sort buffer: REGISTER first (priority=1) for ordering guarantee.
        sortBufferForReplay(pendingToUpstream);

        // Auth-gated flush:
        //   If the buffer's first entry is a REGISTER frame, send it alone
        //   and wait for FreeSWITCH's 200 OK before flushing the rest.
        //   This guarantees the client is registered before any INVITE arrives.
        const first = pendingToUpstream[0];
        if (first && first.priority === 1) {
          pendingToUpstream.shift();
          upstream.send(first.data, { binary: first.isBinary });
          activateAuthGate();
          logger.debug(
            { queuedAfterRegister: pendingToUpstream.length },
            "SIP proxy: REGISTER sent; auth gate active — remaining messages held",
          );
        } else {
          upstreamReadyForData = true;
          flushBuffer();
        }
      });

      // ── Upstream → client ─────────────────────────────────────────────────
      ws.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }

        if (!isBinary) {
          try {
            const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);

            if (isSip200OkToRegister(text) && sipState.pendingExt !== null) {
              const ext        = sipState.pendingExt;
              const expiresSec = parseSipExpires(text);
              const contact    = parseSipContact(text);

              if (expiresSec > 0) {
                registerSipSession(buildSipSession(ext, { contact, expiresSec }));
                sipState.activeExt  = ext;
                sipState.pendingExt = null;
                logger.info({ ext, expiresSec, contact }, "SIP proxy: registration confirmed via 200 OK");
              } else {
                unregisterSipSession(ext);
                sipState.activeExt  = null;
                sipState.pendingExt = null;
                logger.info({ ext }, "SIP proxy: de-registration confirmed via 200 OK Expires=0");
              }

              // Auth gate: REGISTER 200 OK confirms FS has the session —
              // now safe to flush the remaining queued messages.
              if (authGateActive) {
                clearAuthGate();
                logger.info(
                  { ext, expiresSec },
                  "SIP proxy: REGISTER 200 OK — auth gate cleared, flushing buffer",
                );
                flushBuffer();
              }
            }
          } catch {
            // Non-fatal — inspection errors must never break the proxy
          }
        }
      });

      ws.on("error", (err) => {
        lastUpstreamErr = err;
        if (!clientDestroyed && upstreamRetryCount < MAX_UPSTREAM_RETRIES) {
          upstreamRetryCount++;
          retryScheduled = true;
          metrics.reconnectAttempts++;
          logger.warn(
            { err: err.message, attempt: upstreamRetryCount, max: MAX_UPSTREAM_RETRIES, upstreamUrl },
            "SIP proxy: upstream error — will retry after delay",
          );
        } else {
          retryScheduled = false;
          metrics.reconnectFailures++;
          logger.warn(
            { err: err.message, attempt: upstreamRetryCount, upstreamUrl },
            "SIP proxy: upstream error — all retries exhausted, closing client",
          );
        }
      });

      ws.on("close", (code, reason) => {
        const disconnectReason = classifyDisconnectReason(code, reason.toString(), lastUpstreamErr);
        lastDisconnectReason   = disconnectReason;
        lastUpstreamErr        = undefined;

        if (retryScheduled && !clientDestroyed) {
          const gotSlot = acquireReconnectSlot("sip");
          const delayMs = UPSTREAM_RETRY_BASE_MS * upstreamRetryCount * (gotSlot ? 1 : 2);
          reconnectStartedAt = Date.now();

          logger.info(
            {
              delayMs,
              attempt:          upstreamRetryCount,
              max:              MAX_UPSTREAM_RETRIES,
              disconnectReason,
              code,
              stormSlotGranted: gotSlot,
            },
            "SIP proxy: upstream closed — scheduling retry",
          );

          setTimeout(() => {
            if (!clientDestroyed) {
              attachUpstream(new WebSocket(upstreamUrl, ["sip"]));
            } else {
              releaseReconnectSlot("sip");
            }
          }, delayMs);
          retryScheduled = false;
        } else {
          releaseReconnectSlot("sip");
          metrics.upstreamDisconnectsSip++;
          const safe = safeCloseCode(code);
          logger.info(
            { code, safe, disconnectReason, reason: reason.toString() },
            "SIP proxy: upstream closed",
          );
          if (client.readyState === WebSocket.OPEN) client.close(safe, reason);
        }
      });
    }

    // Kick off the first upstream connection.
    acquireReconnectSlot("sip");
    reconnectStartedAt = Date.now();
    attachUpstream(new WebSocket(upstreamUrl, ["sip"]));

    // ── Client → upstream ─────────────────────────────────────────────────────
    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN && upstreamReadyForData) {
        // Fast path: upstream is open and auth is confirmed.
        upstream.send(data, { binary: isBinary });
      } else {
        // Buffer: upstream not yet open, auth gate active, or retry window.
        // Priority=1 (REGISTER) frames are sorted to the front on flush so
        // REGISTER always precedes SIP INVITE on reconnect.
        const priority = sipMessagePriority(data, isBinary);
        const result   = enqueueMessage(pendingToUpstream, { data, isBinary, priority }, bufCfg.limit);
        if (result === "dropped_overflow") {
          metrics.proxyMessagesDroppedSip++;
          logger.warn(
            { queueLen: pendingToUpstream.length, limit: bufCfg.limit },
            "SIP proxy: buffer overflow — oldest message evicted",
          );
        }
      }

      // Inspect text frames for SIP REGISTER messages.
      if (!isBinary) {
        try {
          const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);

          if (isSipRegister(text)) {
            const ext = parseSipFromExtension(text);
            if (ext !== null) {
              if (isSipDeregister(text)) {
                unregisterSipSession(ext);
                sipState.activeExt  = null;
                sipState.pendingExt = null;
                logger.info({ ext }, "SIP proxy: REGISTER Expires:0 — immediate deregister");
              } else {
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
      clearAuthGate();
      metrics.wsDisconnectsSip++;
      metrics.activeSipClients = Math.max(0, metrics.activeSipClients - 1);
      const safe = safeCloseCode(code);
      logger.info(
        { code, safe, reason: reason.toString(), activeClients: metrics.activeSipClients },
        "SIP proxy: client closed",
      );
      if (upstream.readyState === WebSocket.OPEN) upstream.close(safe, reason);

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
      clearAuthGate();
      logger.warn({ err: err.message }, "SIP proxy: client error");
      // Guard: upstream may be uninitialized (error fired before first
      // attachUpstream call) or already closed — calling .close() on a
      // non-OPEN socket throws an unhandled exception that crashes the process.
      try {
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          upstream.close(1011, Buffer.from("client error"));
        }
      } catch (closeErr) {
        logger.warn({ closeErr }, "SIP proxy: upstream.close() failed on client error");
      }
    });
  });

  return wss;
}

export function attachSipProxy(
  server: Server,
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
