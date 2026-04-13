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
import { getSshForwardUrl } from "./sshForwardServer";

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
    logger.info({ upstreamUrl }, "SIP proxy: client connected, opening upstream");

    const upstream = new WebSocket(upstreamUrl, ["sip"]);

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
        // Upstream not yet open — buffer so the SIP REGISTER isn't lost.
        // Drop oldest when cap is reached to prevent OOM.
        if (pendingToUpstream.length >= PENDING_BUFFER_LIMIT) pendingToUpstream.shift();
        pendingToUpstream.push({ data, isBinary });
      }
    });

    client.on("close", (code, reason) => {
      cleanup();
      const safe = safeCloseCode(code);
      logger.info({ code, safe, reason: reason.toString() }, "SIP proxy: client closed");
      if (upstream.readyState === WebSocket.OPEN) upstream.close(safe, reason);
    });

    client.on("error", (err) => {
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
