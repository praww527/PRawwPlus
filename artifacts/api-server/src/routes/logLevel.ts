/**
 * Production logging pipeline — admin controls.
 *
 * GET  /api/admin/log-level  — current log level
 * POST /api/admin/log-level  — change pino log level at runtime
 * GET  /api/admin/errors     — platform error aggregation snapshot
 */

import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!req.user?.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  next();
}

const VALID_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
type LogLevel = typeof VALID_LEVELS[number];

// ── Current log level ─────────────────────────────────────────────────────

router.get("/admin/log-level", requireAdmin, (_req, res) => {
  res.json({ level: (logger as any).level ?? "info" });
});

// ── Change log level at runtime ───────────────────────────────────────────

router.post("/admin/log-level", requireAdmin, (req, res) => {
  const { level } = req.body as { level?: string };
  if (!level || !VALID_LEVELS.includes(level as LogLevel)) {
    res.status(400).json({ error: `level must be one of: ${VALID_LEVELS.join(", ")}` });
    return;
  }

  const prev = (logger as any).level;
  (logger as any).level = level as LogLevel;
  logger.info({ prev, level }, "[LogLevel] Log level changed by admin");
  res.json({ ok: true, prev, level });
});

// ── Error aggregation snapshot ────────────────────────────────────────────

router.get("/admin/errors", requireAdmin, (_req, res) => {
  const snap = metrics.snapshot();
  res.json({
    callsFailed:          snap.callsFailed,
    iceFailures:          snap.iceFailures,
    registrationFailures: snap.registrationFailures,
    reconnectFailures:    snap.reconnectFailures,
    wsDisconnectsVerto:   snap.wsDisconnectsVerto,
    wsDisconnectsSip:     snap.wsDisconnectsSip,
    uptimeSeconds:        snap.uptimeSeconds,
    latency:              snap.callSetupLatency,
  });
});

export default router;
