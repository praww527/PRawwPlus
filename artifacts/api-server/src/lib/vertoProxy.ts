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

// Close codes that are "receive-only" — cannot be sent per RFC 6455 §7.4.2
const RECEIVE_ONLY_CODES = new Set([1005, 1006, 1015]);

function safeCloseCode(code: number): number {
  return RECEIVE_ONLY_CODES.has(code) ? 1001 : code;
}

function getInternalWsUrl(): string {
  // Priority order:
  // 1. FREESWITCH_INTERNAL_WS_URL — explicit internal plain-WS URL
  // 2. FREESWITCH_WS_URL — from .env (e.g. ws://127.0.0.1:8081/)
  //    NOTE: Must be the internal/localhost URL. Never use the public IP here —
  //    if FREESWITCH_DOMAIN is the public IP, FreeSWITCH WS only listens on
  //    127.0.0.1:8081 so the proxy must connect to localhost, not the public IP.
  // 3. Fallback: derive from FREESWITCH_ESL_HOST (same host as ESL, port 8081)
  // 4. Last resort: ws://localhost:8081/
  return (
    process.env.FREESWITCH_INTERNAL_WS_URL?.trim() ||
    process.env.FREESWITCH_WS_URL?.trim() ||
    (process.env.FREESWITCH_ESL_HOST
      ? `ws://${process.env.FREESWITCH_ESL_HOST}:8081/`
      : "ws://127.0.0.1:8081/")
  );
}

const PENDING_BUFFER_LIMIT = 50;
const HEARTBEAT_INTERVAL_MS = 30_000;

export function createVertoProxy(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (client: WebSocket, _req: IncomingMessage) => {
    const upstreamUrl = getInternalWsUrl();
    logger.info({ upstreamUrl }, "Verto proxy: browser connected, opening upstream");

    const upstream = new WebSocket(upstreamUrl, ["verto"]);

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
    const cleanup = () => clearInterval(heartbeat);

    // ── upstream → client ────────────────────────────────────────────────────
    upstream.on("open", () => {
      logger.info("Verto proxy: upstream connected to FreeSWITCH");
      // Flush any messages that were buffered while we were still connecting.
      for (const msg of pendingToUpstream.splice(0)) {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(msg.data, { binary: msg.isBinary });
        }
      }
    });

    upstream.on("message", (data, isBinary) => {
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
            if (method === "verto.bye") {
              logger.info({ method, callID, cause: params.cause, causeCode: params.causeCode }, "Verto ← FS [hangup]");
            } else if (method !== "verto.info") {
              logger.info({ method, callID }, "Verto ← FS");
            }
          } else if (msg.id !== undefined) {
            // JSON-RPC response (ack to client request)
            const isError = Boolean(msg.error);
            if (isError) {
              const errCode = (msg.error as Record<string, unknown> | undefined)?.code;
              // -32002 "CALL DOES NOT EXIST" is normal: the browser sends verto.bye
              // after FreeSWITCH has already cleaned up the leg — log at info, not warn.
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

    upstream.on("close", (code, reason) => {
      const safe = safeCloseCode(code);
      logger.info({ code, safe, reason: reason.toString() }, "Verto proxy: upstream closed");
      if (client.readyState === WebSocket.OPEN) {
        client.close(safe, reason);
      }
    });

    upstream.on("error", (err) => {
      logger.warn({ err: err.message }, "Verto proxy: upstream error");
      if (client.readyState === WebSocket.OPEN) {
        client.close(1011, Buffer.from("upstream error"));
      }
    });

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
      // Log what the browser is sending (method names, not SDPs)
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          const method = msg.method as string | undefined;
          if (method && method !== "verto.clientReady" && method !== "verto.info") {
            const params = (msg.params ?? {}) as Record<string, unknown>;
            const callID = params.callID as string | undefined;
            const to = (params.dialogParams as Record<string, unknown> | undefined)?.to;
            logger.info({ method, callID, to }, "Verto → FS");
          }
        } catch { /* not JSON — ignore */ }
      }
    });

    client.on("close", (code, reason) => {
      cleanup();
      const safe = safeCloseCode(code);
      logger.info({ code, safe, reason: reason.toString() }, "Verto proxy: client closed");
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(safe, reason);
      }
    });

    client.on("error", (err) => {
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
