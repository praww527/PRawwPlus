import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { runStartup } from "./lib/startup";
import { createVertoProxy, attachVertoProxy } from "./lib/vertoProxy";
import { createSipProxy, attachSipProxy } from "./lib/sipProxy";
import { startAlertWorker } from "./lib/alertWorker";
import { ipReputation } from "./lib/ipReputation";
import { startProcessMetrics } from "./lib/processMetrics";

process.on("unhandledRejection", (reason, promise) => {
  logger.error(
    { err: reason, promise: String(promise) },
    "Unhandled promise rejection",
  );
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — process will exit");
  // Flush log transport then exit with non-zero code so the process manager restarts.
  setTimeout(() => process.exit(1), 500);
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
// Always bind to 0.0.0.0 so the server is reachable behind nginx/proxies.
const host = "0.0.0.0";

// Handle port-already-in-use gracefully before it becomes an uncaughtException.
// This happens during rapid workflow restarts when the old process hasn't fully
// released the port yet.  Retry once after a short pause instead of crashing.
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.warn({ port }, `Port ${port} already in use — retrying in 2 s…`);
    setTimeout(() => {
      server.close();
      server.listen(port, host);
    }, 2_000);
  } else {
    // Any other server-level error is fatal — re-throw so uncaughtException handles it.
    throw err;
  }
});

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

// eslint-disable-next-line @typescript-eslint/no-misused-promises
server.listen(port, host, async () => {
  logger.info({ port, host }, "Server listening");

  // Connect to MongoDB and provision any users missing FreeSWITCH extensions.
  // Runs every time the server starts — safe to run repeatedly (idempotent).
  await runStartup();

  // Start alert worker (evaluates alert rules every 60 s).
  startAlertWorker();

  // Start process metrics sampler (heap, CPU, event-loop lag — every 10 s).
  startProcessMetrics();

  // Load persisted IP block list from MongoDB into memory.
  ipReputation.loadFromDb().catch(() => {});
});
