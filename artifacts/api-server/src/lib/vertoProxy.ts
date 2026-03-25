/**
 * WebSocket proxy for FreeSWITCH Verto protocol.
 *
 * Problem solved: FreeSWITCH's TLS (WSS) profile on port 8082 may be down
 * due to certificate issues. The plain WS profile on port 8081 is reliable.
 * Browsers require WSS (secure WebSocket). Replit already provides TLS
 * termination, so we proxy: browser → wss://replit/api/verto/ws → ws://fs:8081
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
  // FREESWITCH_INTERNAL_WS_URL: plain WS to FreeSWITCH (ws://host:8081/)
  // Falls back to FREESWITCH_WS_URL (may be wss:// pointing to 8082 — only
  // used as a last resort; plain WS on 8081 is preferred for the proxy).
  return (
    process.env.FREESWITCH_INTERNAL_WS_URL ??
    // Try to derive ws://host:8081/ from FREESWITCH_DOMAIN
    (process.env.FREESWITCH_DOMAIN
      ? `ws://${process.env.FREESWITCH_DOMAIN}:8081/`
      : "ws://localhost:8081/")
  );
}

export function createVertoProxy(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (client: WebSocket, _req: IncomingMessage) => {
    const upstreamUrl = getInternalWsUrl();
    logger.info({ upstreamUrl }, "Verto proxy: browser connected, opening upstream");

    const upstream = new WebSocket(upstreamUrl, ["verto"]);

    // ── upstream → client ────────────────────────────────────────────────────
    upstream.on("open", () => {
      logger.debug("Verto proxy: upstream connected");
    });

    upstream.on("message", (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
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
      }
    });

    client.on("close", (code, reason) => {
      const safe = safeCloseCode(code);
      logger.info({ code, safe, reason: reason.toString() }, "Verto proxy: client closed");
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(safe, reason);
      }
    });

    client.on("error", (err) => {
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
 */
export function attachVertoProxy(
  server: import("http").Server,
  wss: WebSocketServer,
): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url === "/api/verto/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      // Not our path — destroy to avoid hanging connections
      socket.destroy();
    }
  });
}
