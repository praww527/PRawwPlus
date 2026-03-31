import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { runStartup } from "./lib/startup";
import { createVertoProxy, attachVertoProxy } from "./lib/vertoProxy";
import { createSipProxy, attachSipProxy } from "./lib/sipProxy";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

// Attach the Verto WebSocket proxy (browser → /api/verto/ws → FreeSWITCH:8081)
const vertoWss = createVertoProxy();
attachVertoProxy(server, vertoWss);

// Attach the SIP WebSocket proxy (mobile JsSIP → /api/sip/ws → FreeSWITCH:5066)
const sipWss = createSipProxy();
attachSipProxy(server, sipWss);

server.listen(port, async () => {
  logger.info({ port }, "Server listening");

  // Connect to MongoDB and provision any users missing FreeSWITCH extensions.
  // Runs every time the server starts — safe to run repeatedly (idempotent).
  await runStartup();
});

// Graceful shutdown — PM2 sends SIGTERM on reload/stop.
// Stop accepting new connections, let in-flight requests drain (up to 15 s),
// then exit cleanly. ecosystem.config.cjs kill_timeout (20 s) is the hard cap.
function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal — closing server");
  server.close(() => {
    logger.info("All connections closed — exiting");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("Graceful shutdown timed out — force exiting");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
