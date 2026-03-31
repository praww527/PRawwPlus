/**
 * WebSocket proxy for FreeSWITCH SIP/WS protocol (mod_sofia).
 *
 * Mobile JsSIP clients connect via:
 *   wss://APP_URL/api/sip/ws  →  ws://freeswitch:5066
 *
 * This mirrors the Verto proxy pattern for mod_verto.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { logger } from "./logger";

const RECEIVE_ONLY_CODES = new Set([1005, 1006, 1015]);

function safeCloseCode(code: number): number {
  return RECEIVE_ONLY_CODES.has(code) ? 1001 : code;
}

function getSipWsUrl(): string {
  const explicit = process.env.FREESWITCH_SIP_WS_URL?.trim();
  if (explicit) return explicit;

  const domain = process.env.FREESWITCH_DOMAIN ?? "";
  const port   = process.env.FREESWITCH_SIP_WS_PORT ?? "5066";
  if (!domain) return `ws://localhost:${port}/`;
  return `ws://${domain}:${port}/`;
}

export function createSipProxy(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (client: WebSocket, _req: IncomingMessage) => {
    const upstreamUrl = getSipWsUrl();
    logger.info({ upstreamUrl }, "SIP proxy: client connected, opening upstream");

    const upstream = new WebSocket(upstreamUrl, ["sip"]);

    // Buffer messages that arrive from the mobile client while the upstream
    // WebSocket is still in CONNECTING state.  Without this the SIP REGISTER
    // sent immediately on connect is silently dropped, causing registration
    // failures (the primary "mobile SIP not connecting" bug).
    const pendingToUpstream: Array<{ data: Parameters<WebSocket["send"]>[0]; isBinary: boolean }> = [];

    upstream.on("open", () => {
      logger.debug("SIP proxy: upstream connected");
      // Flush any messages buffered while we were connecting
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
    });

    upstream.on("close", (code, reason) => {
      const safe = safeCloseCode(code);
      logger.info({ code, safe, reason: reason.toString() }, "SIP proxy: upstream closed");
      if (client.readyState === WebSocket.OPEN) client.close(safe, reason);
    });

    upstream.on("error", (err) => {
      logger.warn({ err: err.message }, "SIP proxy: upstream error");
      if (client.readyState === WebSocket.OPEN) client.close(1011, Buffer.from("upstream error"));
    });

    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        // Upstream not yet open — buffer so the SIP REGISTER isn't lost
        pendingToUpstream.push({ data, isBinary });
      }
    });

    client.on("close", (code, reason) => {
      const safe = safeCloseCode(code);
      logger.info({ code, safe, reason: reason.toString() }, "SIP proxy: client closed");
      if (upstream.readyState === WebSocket.OPEN) upstream.close(safe, reason);
    });

    client.on("error", (err) => {
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
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });
}
