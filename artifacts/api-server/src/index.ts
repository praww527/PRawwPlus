import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { runStartup } from "./lib/startup";
import { createVertoProxy, attachVertoProxy } from "./lib/vertoProxy";
import { createSipProxy, attachSipProxy } from "./lib/sipProxy";

process.on("unhandledRejection", (reason, promise) => {
  logger.error(
    { err: reason, promise: String(promise) },
    "Unhandled promise rejection",
  );
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ signal }, "Shutdown signal received — closing server");

  // Stop accepting new connections
  server.close((err?: Error) => {
    if (err) {
      logger.error({ err }, "HTTP server close error");
      process.exit(1);
      return;
    }
    logger.info("HTTP server closed");
    process.exit(0);
  });

  // Force-exit if stuck (e.g. keep-alive sockets)
  setTimeout(() => {
    logger.error("Force exiting after shutdown timeout");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Attach the Verto WebSocket proxy (browser → /api/verto/ws → FreeSWITCH:8081)
const vertoWss = createVertoProxy();
attachVertoProxy(server, vertoWss);

// Attach the SIP WebSocket proxy (mobile JsSIP → /api/sip/ws → FreeSWITCH:5066)
const sipWss = createSipProxy();
attachSipProxy(server, sipWss);

server.listen(port, host, async () => {
  logger.info({ port, host }, "Server listening");

  // Connect to MongoDB and provision any users missing FreeSWITCH extensions.
  // Runs every time the server starts — safe to run repeatedly (idempotent).
  await runStartup();
});
