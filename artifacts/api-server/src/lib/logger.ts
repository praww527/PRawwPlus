import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

/**
 * Create a child logger pre-bound with a correlation context.
 * Use this in request handlers and long-lived async flows so every
 * log line emitted within that flow automatically carries the same
 * identifiers (requestId, fsCallId, callId, userId, etc.) without
 * callers needing to re-pass them on every logger.info() call.
 *
 * @example
 *   const log = childLogger({ fsCallId, callId, userId });
 *   log.info("ringing");          // → { fsCallId, callId, userId, msg: "ringing" }
 *   log.warn({ extra: 1 }, ".."); // → { fsCallId, callId, userId, extra: 1, msg: ".." }
 */
export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
