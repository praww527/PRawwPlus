/**
 * WebSocket proxy for FreeSWITCH Verto protocol.
 *
 * Problem solved: FreeSWITCH's TLS (WSS) profile on port 8082 may be down
 * due to certificate issues. The plain WS profile on port 8081 is reliable.
 * Browsers require WSS (secure WebSocket). The reverse proxy (nginx/caddy) in
 * front of this server handles TLS termination, so we proxy:
 *   browser → wss://rtc.PRaww.co.za/api/verto/ws → ws://fs:8081
 *
 * Hardening implemented:
 *   1. Per-client configurable buffer size cap (PROXY_BUFFER_LIMIT / env)
 *   2. Message TTL — stale login/invite packets evicted before replay
 *   3. Auth-gated flush — queue replayed only after FreeSWITCH confirms login
 *      (verto.login response with sessid), not merely on WebSocket OPEN
 *   4. Metrics — buffered-drop count, reconnect duration, flush latency
 *   5. Reconnect storm protection — global cap on concurrent upstream reconnects
 *   6. Structured disconnect reasons — freeswitch_restart / network_loss /
 *      auth_rejection / upstream_timeout / normal_close
 *   7. Ordered replay — auth messages (login) sorted first in buffer so
 *      verto.login always precedes verto.attach / verto.invite on reconnect
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server }          from "http";
import type { IncomingMessage } from "http";
import type { Duplex }          from "stream";
import { logger } from "./logger";
import { getSshForwardUrl } from "./sshForwardServer";
import { metrics } from "./metrics";
import {
  registerVertoSession,
  unregisterVertoSession,
  touchVertoSession,
} from "./callSession";
import { notifyALegSessionDropped } from "./aLegManager";
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

// Close codes that are "receive-only" — cannot be sent per RFC 6455 §7.4.2
const RECEIVE_ONLY_CODES = new Set([1005, 1006, 1015]);

function safeCloseCode(code: number): number {
  return RECEIVE_ONLY_CODES.has(code) ? 1001 : code;
}

const HEARTBEAT_INTERVAL_MS = 15_000;

// If the callee's socket receives a verto.invite but we see no JSON-RPC ACK
// back within this window, log a warning so the issue is visible in server logs.
// 15 s gives push-woken devices enough time to wake from background state.
const INVITE_ACK_TIMEOUT_MS = 15_000;

// Upstream retry — when FreeSWITCH is briefly restarting/unavailable,
// retry the upstream WS connection before giving up and closing the browser client.
const MAX_UPSTREAM_RETRIES   = 4;
const UPSTREAM_RETRY_BASE_MS = 2_000; // 2 s, 4 s, 6 s, 8 s

// Safety timeout: if no login confirmation arrives within this window after
// sending the login frame, flush the buffer anyway so the session isn't stuck.
const AUTH_GATE_TIMEOUT_MS = 5_000;

// Buffer config — reads PROXY_BUFFER_LIMIT_VERTO / PROXY_BUFFER_LIMIT /
// PROXY_BUFFER_TTL_MS_VERTO / PROXY_BUFFER_TTL_MS from the environment.
const bufCfg = readProxyBufferConfig("verto");

// ── URL helpers ───────────────────────────────────────────────────────────────

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

async function getInternalWsUrl(): Promise<string> {
  if (process.env.FREESWITCH_INTERNAL_WS_URL?.trim()) {
    return process.env.FREESWITCH_INTERNAL_WS_URL.trim();
  }

  const fsDomain      = (process.env.FREESWITCH_DOMAIN ?? "").trim();
  const eslHostExplicit = process.env.FREESWITCH_ESL_HOST?.trim();
  const eslHost       = eslHostExplicit ?? "127.0.0.1";
  const remoteHost    = fsDomain || eslHost;
  const localityHost  = eslHostExplicit ?? fsDomain;
  const remoteIsLocal =
    !localityHost || localityHost === "127.0.0.1" || localityHost === "localhost";

  if (process.env.FREESWITCH_WS_URL?.trim()) {
    const wsUrl = process.env.FREESWITCH_WS_URL.trim();
    if (isLocalWsUrl(wsUrl) && !remoteIsLocal) {
      const port = wsPort(wsUrl, 8081);
      logger.info(
        { wsUrl, remoteHost, port },
        "Verto proxy: FREESWITCH_WS_URL is localhost but FreeSWITCH is remote — rewriting to public IP",
      );
      return `ws://${remoteHost}:${port}/`;
    }
    return wsUrl;
  }

  if (remoteIsLocal) return "ws://127.0.0.1:8081/";

  const tunnelUrl = await getSshForwardUrl(8081);
  if (tunnelUrl) return tunnelUrl;
  return `ws://${remoteHost}:8081/`;
}

// ── Message classifiers ───────────────────────────────────────────────────────

/**
 * Returns priority=1 if data is a Verto login frame (method === "login").
 * Priority=1 messages are sorted first in the replay queue so the login
 * always reaches FreeSWITCH before any verto.attach / verto.invite.
 */
function vertoMessagePriority(data: BufferedMessage["data"], isBinary: boolean): 0 | 1 {
  if (isBinary) return 0;
  try {
    const msg = JSON.parse(data.toString()) as Record<string, unknown>;
    return msg.method === "login" ? 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * Detect a successful Verto login response from FreeSWITCH.
 * FS sends: { "jsonrpc":"2.0", "id": N, "result": { "message":"logged in", "sessid":"..." } }
 */
function isVertoLoginResponse(data: BufferedMessage["data"], isBinary: boolean, loginId: number | null): boolean {
  if (isBinary || loginId === null) return false;
  try {
    const msg = JSON.parse(data.toString()) as Record<string, unknown>;
    if (msg.id !== loginId) return false;
    const result = msg.result as Record<string, unknown> | undefined;
    return result != null && typeof result.sessid === "string";
  } catch {
    return false;
  }
}

/**
 * Detect any JSON-RPC response to our login request (success OR error).
 * Used to unblock the auth gate even on auth failure so the client sees the error.
 */
function isVertoLoginResponseAny(data: BufferedMessage["data"], isBinary: boolean, loginId: number | null): boolean {
  if (isBinary || loginId === null) return false;
  try {
    const msg = JSON.parse(data.toString()) as Record<string, unknown>;
    return msg.id === loginId && (msg.result != null || msg.error != null);
  } catch {
    return false;
  }
}

// ── Proxy factory ─────────────────────────────────────────────────────────────

export function createVertoProxy(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  wss.on("connection", async (client: WebSocket, _req: IncomingMessage) => {
    let upstreamUrl: string;
    try {
      upstreamUrl = await getInternalWsUrl();
    } catch (err) {
      logger.warn({ err }, "Verto proxy: upstream configuration failed");
      client.close(1011, Buffer.from("upstream configuration failed"));
      return;
    }
    metrics.activeVertoClients++;
    logger.info(
      { upstreamUrl, activeClients: metrics.activeVertoClients, bufLimit: bufCfg.limit, bufTtlMs: bufCfg.ttlMs },
      "Verto proxy: browser connected, opening upstream",
    );

    // Extension / session tracked once the browser sends a verto login.
    let sessionExtension: number | null = null;
    let sessionSessId:    string | null = null;

    // Per-client upstream message buffer.  Timestamped + priority-tagged so we
    // can evict stale frames and sort auth messages to the front on replay.
    const pendingToUpstream: BufferedMessage[] = [];

    // Ping/pong heartbeat — detects half-open (zombie) TCP connections.
    const heartbeat = setInterval(() => {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }, HEARTBEAT_INTERVAL_MS);
    client.on("pong", () => { /* connection is alive */ });

    // Track pending verto.invite requests sent FS → client so we can warn
    // when the client fails to send the JSON-RPC ACK within the timeout.
    const pendingInviteAcks = new Map<number, { callID: string; timer: ReturnType<typeof setTimeout> }>();

    const cleanup = () => {
      clearInterval(heartbeat);
      for (const { timer } of pendingInviteAcks.values()) clearTimeout(timer);
      pendingInviteAcks.clear();
      // Clear auth-gate timer so it never fires on a disconnected client and
      // attempts to flush the buffer into a closed upstream socket.
      if (authGateTimer) { clearTimeout(authGateTimer); authGateTimer = null; }
      authGateActive = false;
    };

    // ── Per-connection upstream state ─────────────────────────────────────────
    // All of these reset inside attachUpstream() on every retry attempt.

    let upstream: WebSocket;
    let upstreamRetryCount  = 0;
    let clientDestroyed     = false;
    let retryScheduled      = false;

    // Auth-gate state: prevent flushing the buffer until FreeSWITCH confirms
    // login so verto.attach / verto.invite cannot arrive before the session.
    let upstreamReadyForData = false;
    let authGateActive       = false;
    let loginRequestId: number | null = null;
    let authGateTimer: ReturnType<typeof setTimeout> | null = null;

    // Reconnect duration tracking (storm guard + latency metric).
    let reconnectStartedAt   = 0;
    let lastUpstreamErr: Error | undefined;
    let lastDisconnectReason: DisconnectReason = "unknown";

    // ── Buffer helpers ────────────────────────────────────────────────────────

    function flushBuffer(): void {
      if (upstream.readyState !== WebSocket.OPEN) return;
      const staleDropped = evictStaleMessages(pendingToUpstream, bufCfg.ttlMs, "verto");
      if (staleDropped > 0) metrics.proxyMessagesDroppedVerto += staleDropped;

      const flushStart = Date.now();
      const messages   = pendingToUpstream.splice(0);
      for (const msg of messages) {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(msg.data, { binary: msg.isBinary });
        }
      }
      const flushMs = Date.now() - flushStart;
      if (messages.length > 0) {
        metrics.recordProxyFlushLatency("verto", flushMs);
        logger.debug(
          { count: messages.length, flushMs },
          "Verto proxy: buffer flushed to upstream",
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
            "Verto proxy: auth gate timed out waiting for login response — flushing buffer anyway",
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
      // Terminate any previous upstream socket before overwriting — on retry
      // attempts a previous WebSocket may still be in CONNECTING state, and
      // simply reassigning the variable leaks that socket handle.
      try {
        if (upstream && upstream !== ws && upstream.readyState !== WebSocket.CLOSED) {
          upstream.terminate();
        }
      } catch { /* ignore — best-effort cleanup */ }
      upstream             = ws;
      upstreamReadyForData = false;
      authGateActive       = false;
      loginRequestId       = null;
      if (authGateTimer) { clearTimeout(authGateTimer); authGateTimer = null; }

      ws.on("open", () => {
        const reconnectMs = reconnectStartedAt > 0 ? Date.now() - reconnectStartedAt : 0;
        upstreamRetryCount = 0;
        retryScheduled     = false;

        if (reconnectMs > 0) {
          metrics.recordProxyReconnectDuration("verto", reconnectMs);
          metrics.reconnectSuccesses++;
          logger.info(
            { reconnectMs, disconnectReason: lastDisconnectReason, upstreamUrl },
            "Verto proxy: upstream reconnected to FreeSWITCH",
          );
        } else {
          logger.info({ upstreamUrl }, "Verto proxy: upstream connected to FreeSWITCH");
        }

        releaseReconnectSlot("verto");

        // Sort buffer: auth (login) messages first for ordering guarantee.
        sortBufferForReplay(pendingToUpstream);

        // Auth-gated flush:
        //   If the buffer's first entry is a login frame, send it alone and
        //   wait for FreeSWITCH's response before flushing the rest.
        //   This guarantees FreeSWITCH has an authenticated session before
        //   any verto.attach / verto.invite arrives.
        const first = pendingToUpstream[0];
        if (first && first.priority === 1) {
          // Extract the RPC id so we can match the response precisely.
          if (!first.isBinary) {
            try {
              const parsed = JSON.parse(first.data.toString()) as Record<string, unknown>;
              if (typeof parsed.id === "number") loginRequestId = parsed.id;
            } catch { /* ignore */ }
          }
          pendingToUpstream.shift();
          upstream.send(first.data, { binary: first.isBinary });
          activateAuthGate();
          logger.debug(
            { loginRequestId, queuedAfterLogin: pendingToUpstream.length },
            "Verto proxy: login sent; auth gate active — remaining messages held",
          );
        } else {
          // No login in buffer — session may already be known to FS,
          // or client will send login as its next real-time message.
          upstreamReadyForData = true;
          flushBuffer();
        }
      });

      // ── Upstream → client ────────────────────────────────────────────────────
      ws.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }

        if (!isBinary) {
          try {
            const msg    = JSON.parse(data.toString()) as Record<string, unknown>;
            const method = msg.method as string | undefined;

            // Auth gate: unblock buffer once FS responds to the login
            // (either success with sessid, or any error response).
            if (authGateActive && isVertoLoginResponseAny(data, isBinary, loginRequestId)) {
              const success = isVertoLoginResponse(data, isBinary, loginRequestId);
              clearAuthGate();
              logger.info(
                { loginRequestId, success },
                "Verto proxy: login response received — auth gate cleared, flushing buffer",
              );
              flushBuffer();
            }

            if (method) {
              const params = (msg.params ?? {}) as Record<string, unknown>;
              const callID = params.callID as string | undefined;

              if (method === "verto.invite") {
                metrics.callsInitiated++;
                metrics.activeCalls++;
                const rpcId      = typeof msg.id === "number" ? msg.id : null;
                const clientOpen = client.readyState === WebSocket.OPEN;
                logger.info(
                  { method, callID, rpcId, CALLEE_SOCKET_FOUND: clientOpen },
                  "Verto ← FS [INVITE_SENT to callee socket]",
                );
                if (rpcId !== null && callID) {
                  const timer = setTimeout(() => {
                    pendingInviteAcks.delete(rpcId);
                    logger.warn(
                      { callID, rpcId, timeoutMs: INVITE_ACK_TIMEOUT_MS },
                      "Verto proxy: [INVITE_ACK_TIMEOUT] callee socket did not ACK verto.invite — " +
                      "client may be reconnecting, frozen, or the invite was silently dropped",
                    );
                  }, INVITE_ACK_TIMEOUT_MS);
                  pendingInviteAcks.set(rpcId, { callID, timer });
                }
              } else if (method === "verto.answer") {
                metrics.callsAnswered++;
                logger.info({ method, callID }, "Verto ← FS [answered]");
              } else if (method === "verto.bye") {
                metrics.activeCalls = Math.max(0, metrics.activeCalls - 1);
                const cause = params.cause as string | undefined;
                if (cause && cause !== "NORMAL_CLEARING" && cause !== "ORIGINATOR_CANCEL") {
                  metrics.callsFailed++;
                }
                // Clear any pending INVITE_ACK timer for this call — the call
                // is now terminated so the 15 s timeout is no longer relevant.
                if (callID) {
                  for (const [rpcId, ack] of pendingInviteAcks.entries()) {
                    if (ack.callID === callID) {
                      clearTimeout(ack.timer);
                      pendingInviteAcks.delete(rpcId);
                      break;
                    }
                  }
                }
                logger.info({ method, callID, cause, causeCode: params.causeCode }, "Verto ← FS [hangup]");
              } else if (method !== "verto.info") {
                logger.info({ method, callID }, "Verto ← FS");
              }
            } else if (msg.id !== undefined) {
              const isError = Boolean(msg.error);
              if (isError) {
                const errCode = (msg.error as Record<string, unknown> | undefined)?.code;
                if (errCode === -32002) {
                  logger.info({ id: msg.id, error: msg.error }, "Verto ← FS [call already gone]");
                } else {
                  logger.warn({ id: msg.id, error: msg.error }, "Verto ← FS [RPC error]");
                }
              }
            }
          } catch { /* not JSON — ignore */ }
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
            "Verto proxy: upstream error — will retry after delay",
          );
        } else {
          retryScheduled = false;
          metrics.reconnectFailures++;
          logger.warn(
            { err: err.message, attempt: upstreamRetryCount, upstreamUrl },
            "Verto proxy: upstream error — all retries exhausted, closing client",
          );
        }
      });

      ws.on("close", (code, reason) => {
        const disconnectReason = classifyDisconnectReason(code, reason.toString(), lastUpstreamErr);
        lastDisconnectReason   = disconnectReason;
        lastUpstreamErr        = undefined;

        if (retryScheduled && !clientDestroyed) {
          // Storm protection: acquire a slot; double the jitter if unavailable.
          const gotSlot = acquireReconnectSlot("verto");
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
            "Verto proxy: upstream closed — scheduling retry",
          );

          setTimeout(() => {
            if (!clientDestroyed) {
              attachUpstream(new WebSocket(upstreamUrl, ["verto"]));
            } else {
              releaseReconnectSlot("verto");
            }
          }, delayMs);
          retryScheduled = false;
        } else {
          // Normal close or retries exhausted — propagate to client.
          releaseReconnectSlot("verto");
          metrics.upstreamDisconnectsVerto++;
          const safe = safeCloseCode(code);
          logger.info(
            { code, safe, disconnectReason, reason: reason.toString() },
            "Verto proxy: upstream closed",
          );
          if (client.readyState === WebSocket.OPEN) {
            client.close(safe, reason);
          }
        }
      });
    }

    // Kick off the first upstream connection.
    acquireReconnectSlot("verto");
    reconnectStartedAt = Date.now();
    attachUpstream(new WebSocket(upstreamUrl, ["verto"]));

    // ── Client → upstream ─────────────────────────────────────────────────────
    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN && upstreamReadyForData) {
        // Fast path: upstream is open and auth is confirmed.
        upstream.send(data, { binary: isBinary });
      } else {
        // Buffer: upstream not yet open, auth gate active, or retry window.
        // Priority=1 (login) frames are sorted to the front of the queue on
        // flush so login always precedes verto.attach / verto.invite.
        const priority = vertoMessagePriority(data, isBinary);
        const result   = enqueueMessage(pendingToUpstream, { data, isBinary, priority }, bufCfg.limit);
        if (result === "dropped_overflow") {
          metrics.proxyMessagesDroppedVerto++;
          logger.warn(
            { queueLen: pendingToUpstream.length, limit: bufCfg.limit },
            "Verto proxy: buffer overflow — oldest message evicted",
          );
        }
      }

      // Log method names and detect login / ACK / invite (not SDPs).
      if (!isBinary) {
        try {
          const msg    = JSON.parse(data.toString()) as Record<string, unknown>;
          const method = msg.method as string | undefined;
          if (method && method !== "verto.clientReady" && method !== "verto.info") {
            const params = (msg.params ?? {}) as Record<string, unknown>;
            const callID = params.callID as string | undefined;
            const to     = (params.dialogParams as Record<string, unknown> | undefined)?.to;

            if (method === "login") {
              // Store the RPC id so we can match FreeSWITCH's response exactly.
              if (typeof msg.id === "number") loginRequestId = msg.id;
              const loginStr = params.login as string | undefined;
              const sessId   = params.sessid as string | undefined;
              const extMatch = loginStr?.match(/^(\d+)@/);
              if (extMatch && sessId) {
                const ext = parseInt(extMatch[1], 10);
                sessionExtension = ext;
                sessionSessId    = sessId;
                registerVertoSession({
                  extension:      ext,
                  sessId,
                  connectedAt:    Date.now(),
                  lastPingAt:     Date.now(),
                  reconnectCount: 0,
                });
                logger.info(
                  { extension: ext, sessId: sessId.slice(0, 8) + "…" },
                  "Verto proxy: [SESSION_REGISTERED] extension logged in via Verto",
                );
              }
            } else if (method === "verto.invite") {
              metrics.callsInitiated++;
              metrics.activeCalls++;
            }

            logger.info({ method, callID, to }, "Verto → FS");
          } else if (!method && typeof msg.id === "number") {
            // JSON-RPC response from the client — may be an ACK for a verto.invite.
            const pending = pendingInviteAcks.get(msg.id);
            if (pending) {
              clearTimeout(pending.timer);
              pendingInviteAcks.delete(msg.id);
              logger.info(
                { id: msg.id, callID: pending.callID },
                "Verto proxy: [RPC_ACK] callee socket acknowledged verto.invite",
              );
            }
          }
        } catch { /* not JSON — ignore */ }
      }
    });

    // Update lastPingAt whenever the client pongs — the browser responds to
    // our WebSocket ping frames, not to Verto-level keepalives.
    client.on("pong", () => {
      if (sessionExtension !== null) touchVertoSession(sessionExtension);
    });

    client.on("close", (code, reason) => {
      clientDestroyed = true;
      cleanup();
      clearAuthGate();
      metrics.wsDisconnectsVerto++;
      metrics.activeVertoClients = Math.max(0, metrics.activeVertoClients - 1);
      const safe = safeCloseCode(code);
      logger.info(
        { code, safe, reason: reason.toString(), activeClients: metrics.activeVertoClients },
        "Verto proxy: client closed",
      );
      if (sessionExtension !== null) {
        unregisterVertoSession(sessionExtension, sessionSessId ?? undefined);
        logger.info(
          { extension: sessionExtension },
          "Verto proxy: [SESSION_UNREGISTERED] extension disconnected",
        );
        notifyALegSessionDropped(sessionExtension);
      }
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(safe, reason);
      }
    });

    client.on("error", (err) => {
      clientDestroyed = true;
      cleanup();
      clearAuthGate();
      logger.warn({ err: err.message }, "Verto proxy: client error");
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(1011, Buffer.from("client error"));
      }
    });
  });

  return wss;
}

/**
 * Attach the Verto proxy to an existing http.Server so it can handle the
 * HTTP → WebSocket upgrade on the path /api/verto/ws.
 *
 * IMPORTANT: Do NOT call socket.destroy() for unrecognised paths here.
 * Other upgrade handlers (e.g. SIP proxy at /api/sip/ws) are registered on
 * the same server and will handle their own paths.
 */
export function attachVertoProxy(
  server: Server,
  wss: WebSocketServer,
): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url === "/api/verto/ws") {
      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      } catch (err) {
        logger.error({ err }, "Verto proxy: handleUpgrade threw — destroying socket");
        socket.destroy();
      }
    }
  });
}
