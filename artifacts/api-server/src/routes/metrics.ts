/**
 * GET /api/metrics — Prometheus-compatible metrics endpoint.
 * GET /api/metrics/json — Same data in JSON (for admin dashboard).
 *
 * Protected by admin session in production; in development any request is allowed
 * so Prometheus scrapers can run without auth.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { metrics } from "../lib/metrics";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: () => void) {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) { next(); return; }
  if (!req.isAuthenticated?.() || !(req.user as any)?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

router.get("/metrics", requireAdmin, (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(metrics.toPrometheusText());
});

router.get("/metrics/json", requireAdmin, (_req: Request, res: Response) => {
  res.json(metrics.snapshot());
});

router.post("/metrics/ice-failure", (req: Request, res: Response) => {
  if (!req.isAuthenticated?.()) { res.status(401).json({ error: "Unauthorized" }); return; }
  metrics.iceFailures++;
  res.json({ ok: true });
});

router.post("/metrics/reconnect", (req: Request, res: Response) => {
  if (!req.isAuthenticated?.()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { event, latencyMs } = req.body as { event?: string; latencyMs?: number };
  if (event === "reconnect_attempt")  metrics.reconnectAttempts++;
  if (event === "reconnect_success")  { metrics.reconnectSuccesses++; }
  if (event === "reconnect_failed")   metrics.reconnectFailures++;
  if (event === "call_setup_latency" && typeof latencyMs === "number") {
    metrics.recordCallSetupLatency(latencyMs);
  }
  res.json({ ok: true });
});

export default router;
