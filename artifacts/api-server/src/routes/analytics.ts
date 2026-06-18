/**
 * Analytics Routes — Phase 8
 * Aggregated CDR analytics for the admin dashboard
 */

import { Router, type IRouter, type Request } from "express";
import {
  getAnalyticsSummary,
  getHourlyBuckets,
  getDailyBuckets,
  getTopCallers,
  getDestinationStats,
} from "../lib/analyticsAggregator";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

function parseDateRange(req: Request): { fromMs: number; toMs: number } {
  const now   = Date.now();
  const days  = parseInt(String(req.query.days ?? "7"), 10);
  const fromMs = req.query.from ? new Date(String(req.query.from)).getTime() : now - days * 86_400_000;
  const toMs   = req.query.to   ? new Date(String(req.query.to)).getTime()   : now;
  return { fromMs, toMs };
}

router.get("/analytics/summary", requireAdmin, async (req, res) => {
  const { fromMs, toMs } = parseDateRange(req);
  const summary = await getAnalyticsSummary(fromMs, toMs);
  res.json(summary);
});

router.get("/analytics/hourly", requireAdmin, async (req, res) => {
  const { fromMs, toMs } = parseDateRange(req);
  const buckets = await getHourlyBuckets(fromMs, toMs);
  res.json({ buckets });
});

router.get("/analytics/daily", requireAdmin, async (req, res) => {
  const { fromMs, toMs } = parseDateRange(req);
  const buckets = await getDailyBuckets(fromMs, toMs);
  res.json({ buckets });
});

router.get("/analytics/top-callers", requireAdmin, async (req, res) => {
  const { fromMs, toMs } = parseDateRange(req);
  const topN = parseInt(String(req.query.topN ?? "10"), 10);
  const callers = await getTopCallers(fromMs, toMs, topN);
  res.json({ callers });
});

router.get("/analytics/destinations", requireAdmin, async (req, res) => {
  const { fromMs, toMs } = parseDateRange(req);
  const topN = parseInt(String(req.query.topN ?? "20"), 10);
  const destinations = await getDestinationStats(fromMs, toMs, topN);
  res.json({ destinations });
});

router.get("/analytics/all", requireAdmin, async (req, res) => {
  const { fromMs, toMs } = parseDateRange(req);
  const topN = parseInt(String(req.query.topN ?? "10"), 10);

  const [summary, daily, topCallers, destinations] = await Promise.all([
    getAnalyticsSummary(fromMs, toMs),
    getDailyBuckets(fromMs, toMs),
    getTopCallers(fromMs, toMs, topN),
    getDestinationStats(fromMs, toMs, topN),
  ]);

  res.json({ summary, daily, topCallers, destinations });
});

export default router;
