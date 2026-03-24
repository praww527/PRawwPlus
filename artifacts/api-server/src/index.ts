import app from "./app";
import { logger } from "./lib/logger";
import { runStartup } from "./lib/startup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async () => {
  logger.info({ port }, "Server listening");

  // Connect to MongoDB and provision any users missing FreeSWITCH extensions.
  // Runs every time the server starts — safe to run repeatedly (idempotent).
  await runStartup();
});
