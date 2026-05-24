/**
 * WebSocket proxy for FreeSWITCH Verto protocol.
 *
 * Problem solved: FreeSWITCH's TLS (WSS) profile on port 8082 may be down
 * due to certificate issues. The plain WS profile on port 8081 is reliable.
 * Browsers require WSS (secure WebSocket). The reverse proxy (nginx/caddy) in
 * front of this server handles TLS termination, so we proxy:
 *   browser → wss://rtc.PRaww.co.za/api/verto/ws → ws://fs:8081
 *
 * Close-code bug fixed: WebSocket code 1006 (Abnormal Closure) is a
 * "receive-only" code — the spec forbids sending it. When a client disconnects
 * abnormally (code 1006 or 1015), we substitute 1001 (Going Away) before
 * forwarding the close to the upstream FreeSWITCH connection.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { logger } from "./logger";
import { getSshForwardUrl } from "./sshForwardServer";
import { metrics } from "./metrics";
import {
  registerVertoSession,
  unregisterVertoSession,
  touchVertoSession,
} from "./callSession";
import { notifyALegSessionDropped } from "./aLegManager";

// Close codes that are "receive-only" — cannot be sent per RFC 6455 §7.4.2
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

async function getInternalWsUrl(): Promise<string> {
  // Explicit overrides always take priority (can be set in .env on any env).
  if (process.env.FREESWITCH_INTERNAL_WS_URL?.trim()) {
    return process.env.FREESWITCH_INTERNAL_WS_URL.trim();
  }

  const fsDomain = (process.env.FREESWITCH_DOMAIN ?? "").trim();
  // Use FREESWITCH_ESL_HOST (if explicitly set) to determine whether FreeSWITCH
  // is local to this server. On the production VPS, ESL_HOST=127.0.0.1 (explicitly
  // set in .env), indicating FS is on the same machine. On a dev machine only
  // FREESWITCH_DOMAIN (the public IP) is set, indicating FS is remote.
  // FREESWITCH_DOMAIN is the public-facing IP used in SDP/config — not locality.
  const eslHostExplicit = process.env.FREESWITCH_ESL_HOST?.trim();
  const eslHost = eslHostExplicit ?? "127.0.0.1";

  const remoteHost = fsDomain || eslHost;
  const localityHost = eslHostExplicit ?? fsDomain;
  const remoteIsLocal =
    !localityHost || localityHost === "127.0.0.1" || localityHost === "localhost";

  if (process.env.FREESWITCH_WS_URL?.trim()) {
    const wsUrl = process.env.FREESWITCH_WS_URL.trim();

    // If FREESWITCH_WS_URL points to localhost but we are on a remote host,
    // rewrite it to use the public IP.
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

  if (remoteIsLocal) {
    // FreeSWITCH is on the SAME machine (VPS production).
    return "ws://127.0.0.1:8081/";
  }

  // FreeSWITCH is on a REMOTE host.
  // Try SSH tunnel first (port 8081 is often firewalled); fall back to direct.
  const tunnelUrl = await getSshForwardUrl(8081);
  if (tunnelUrl) return tunnelUrl;

  // Fallback: direct connection — works if port 8081 is publicly reachable.
  return `ws://${remoteHost}:8081/`;
}

const PENDING_BUFFER_LIMIT = 50;
const HEARTBEAT_INTERVAL_MS = 15_000;
// If the callee's socket receives a verto.invite but we see no JSON-RPC ACK
// back within this window, log a warning so the issue is visible in server logs.
const INVITE_ACK_TIMEOUT_MS = 8_000;

// Upstream retry — when FreeSWITCH is briefly restarting/unavailable,
// retry the upstream WS connection before giving up and closing the browser client.
// This prevents the browser needing to do a full 5s–60s exponential-backoff cycle
// every time FreeSWITCH is momentarily unreachable (e.g. config reload, crash recovery).
const MAX_UPSTREAM_RETRIES    = 4;
const UPSTREAM_RETRY_BASE_MS  = 2_000;  // 2 s, 4 s, 6 s, 8 s

export function createVertoProxy(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

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
    logger.info({ upstreamUrl, activeClients: metrics.activeVertoClients }, "Verto proxy: browser connected, opening upstream");

    // Track which extension this client logged in as so we can update the
    // callSession map on disconnect.  Populated when we see a verto login message.
    let sessionExtension: number | null = null;
    let sessionSessId:    string | null = null;

    // Buffer messages that arrive from the browser while the upstream WebSocket
    // is still in CONNECTING state.  Without this the Verto login message sent
    // immediately on browser-open is silently dropped, causing a 10 s RPC
    // timeout → reconnect loop (the primary "Verto WebSocket not connecting" bug).
    // Capped at PENDING_BUFFER_LIMIT to prevent OOM from misbehaving clients.
    const pendingToUpstream: Array<{ data: Parameters<WebSocket["send"]>[0]; isBinary: boolean }> = [];

    // Ping/pong heartbeat — detects half-open (zombie) TCP connections that
    // would otherwise accumulate indefinitely on mobile/flaky networks.
    const heartbeat = setInterval(() => {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }, HEARTBEAT_INTERVAL_MS);
    client.on("pong", () => { /* connection is alive — no-op */ });

    // Track pending verto.invite requests sent from FS → client so we can
    // detect when the client fails to send the JSON-RPC ACK within the timeout.
    // Map: numeric RPC id → { callID, sentAt, ackTimer }
    const pendingInviteAcks = new Map<number, { callID: string; timer: ReturnType<typeof setTimeout> }>();

    const cleanup = () => {
      clearInterval(heartbeat);
      for (const { timer } of pendingInviteAcks.values()) clearTimeout(timer);
      pendingInviteAcks.clear();
    };

    // ── upstream → client ────────────────────────────────────────────────────
    // Mutable upstream reference — updated each retry attempt so the client
    // message handler always sends to the active upstream WebSocket.
    let upstream: WebSocket;
    let upstreamRetryCount = 0;
    let clientDestroyed    = false;
    let retryScheduled     = false;

    function attachUpstream(ws: WebSocket): void {
      upstream = ws;

      ws.on("open", () => {
        upstreamRetryCount = 0;
        retryScheduled     = false;
        logger.info({ upstreamUrl, attempt: upstreamRetryCount + 1 }, "Verto proxy: upstream connected to FreeSWITCH");
        // Flush any messages buffered while we were connecting / retrying.
        for (const msg of pendingToUpstream.splice(0)) {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(msg.data, { binary: msg.isBinary });
          }
        }
      });

      ws.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
        // Log Verto method names and hangup causes (not SDPs) for diagnostics
        if (!isBinary) {
          try {
            const msg = JSON.parse(data.toString()) as Record<string, unknown>;
            const method = msg.method as string | undefined;
            if (method) {
              const params = (msg.params ?? {}) as Record<string, unknown>;
              const callID = params.callID as string | undefined;
              if (method === "verto.invite") {
                metrics.callsInitiated++;
                metrics.activeCalls++;
                const rpcId = typeof msg.id === "number" ? msg.id : null;
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
                if (cause && cause !== "NORMAL_CLEARING" && cause !== "ORIGINATOR_CANCEL") metrics.callsFailed++;
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
        // On upstream connection error, retry before giving up.
        // The error event always precedes the close event, so we set
        // retryScheduled here and let the close handler do the actual retry.
        if (!clientDestroyed && upstreamRetryCount < MAX_UPSTREAM_RETRIES) {
          upstreamRetryCount++;
          retryScheduled = true;
          logger.warn(
            { err: err.message, attempt: upstreamRetryCount, max: MAX_UPSTREAM_RETRIES, upstreamUrl },
            "Verto proxy: upstream error — will retry after delay",
          );
        } else {
          retryScheduled = false;
          logger.warn(
            { err: err.message, attempt: upstreamRetryCount, upstreamUrl },
            "Verto proxy: upstream error — all retries exhausted, closing client",
          );
        }
      });

      ws.on("close", (code, reason) => {
        if (retryScheduled && !clientDestroyed) {
          // Schedule retry — upstream was unavailable, give FreeSWITCH time to recover.
          const delayMs = UPSTREAM_RETRY_BASE_MS * upstreamRetryCount;
          logger.info(
            { delayMs, attempt: upstreamRetryCount, max: MAX_UPSTREAM_RETRIES },
            "Verto proxy: upstream closed — scheduling retry",
          );
          setTimeout(() => {
            if (!clientDestroyed) {
              attachUpstream(new WebSocket(upstreamUrl, ["verto"]));
            }
          }, delayMs);
          retryScheduled = false;
        } else {
          // Normal close or retries exhausted — propagate to client.
          metrics.upstreamDisconnectsVerto++;
          const safe = safeCloseCode(code);
          logger.info({ code, safe, reason: reason.toString() }, "Verto proxy: upstream closed");
          if (client.readyState === WebSocket.OPEN) {
            client.close(safe, reason);
          }
        }
      });
    }

    // Kick off the first upstream connection.
    attachUpstream(new WebSocket(upstreamUrl, ["verto"]));

    // ── client → upstream ────────────────────────────────────────────────────
    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        // Upstream not yet open — buffer so the Verto login isn't lost.
        // Drop oldest message when the cap is reached to prevent OOM.
        if (pendingToUpstream.length >= PENDING_BUFFER_LIMIT) pendingToUpstream.shift();
        pendingToUpstream.push({ data, isBinary });
      }
      // Log what the browser is sending (method names, not SDPs).
      // Also detect JSON-RPC ACKs from the client for pending verto.invite requests.
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          const method = msg.method as string | undefined;
          if (method && method !== "verto.clientReady" && method !== "verto.info") {
            const params = (msg.params ?? {}) as Record<string, unknown>;
            const callID = params.callID as string | undefined;
            const to = (params.dialogParams as Record<string, unknown> | undefined)?.to;
            if (method === "verto.invite") {
              metrics.callsInitiated++;
              metrics.activeCalls++;
            }
            // Detect Verto login — extract extension + sessId and register session
            if (method === "login") {
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
            }
            logger.info({ method, callID, to }, "Verto → FS");
          } else if (!method && typeof msg.id === "number") {
            // This is a JSON-RPC response from the client — it could be the ACK
            // for a previously forwarded verto.invite. Resolve the pending ACK
            // timer so we don't false-alarm on a healthy invite delivery.
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

    // Update lastPingAt whenever the client sends a pong — the browser responds
    // to our WebSocket ping frames, not to Verto-level keepalives.
    client.on("pong", () => {
      if (sessionExtension !== null) {
        touchVertoSession(sessionExtension);
      }
    });

    client.on("close", (code, reason) => {
      clientDestroyed = true;
      cleanup();
      metrics.wsDisconnectsVerto++;
      metrics.activeVertoClients = Math.max(0, metrics.activeVertoClients - 1);
      const safe = safeCloseCode(code);
      logger.info({ code, safe, reason: reason.toString(), activeClients: metrics.activeVertoClients }, "Verto proxy: client closed");
      // Unregister session so callers know this extension is offline
      if (sessionExtension !== null) {
        unregisterVertoSession(sessionExtension, sessionSessId ?? undefined);
        logger.info(
          { extension: sessionExtension },
          "Verto proxy: [SESSION_UNREGISTERED] extension disconnected",
        );
        // Notify the A-leg manager so it can arm the disconnect watchdog for any
        // active call on this extension.  This fires uuid_kill on the FS channel
        // if the caller doesn't reconnect within ALEG_DISCONNECT_GRACE_MS (default 8 s),
        // reducing zombie-call lifetime from 30–45 s to < 10 s.
        notifyALegSessionDropped(sessionExtension);
      }
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(safe, reason);
      }
    });

    client.on("error", (err) => {
      clientDestroyed = true;
      cleanup();
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
 * the same server and will handle their own paths. Destroying the socket in
 * an else-branch would kill those connections before they can be handled.
 */
export function attachVertoProxy(
  server: import("http").Server,
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
    // For all other paths: do nothing — let the next registered upgrade
    // handler (SIP proxy, etc.) take over.
  });
}
