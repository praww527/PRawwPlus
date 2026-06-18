/**
 * Alert rules and alert events management routes (admin only).
 *
 * GET    /api/admin/alert-rules          — list all rules
 * POST   /api/admin/alert-rules          — create a rule
 * PATCH  /api/admin/alert-rules/:id      — update (enable/disable, threshold, channels)
 * DELETE /api/admin/alert-rules/:id      — delete a rule
 * GET    /api/admin/alert-events         — recent fired alert events
 * POST   /api/admin/alert-rules/:id/test — manually trigger delivery for a rule
 */

import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { connectDB, AlertRuleModel, AlertEventModel } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

// ── List rules ────────────────────────────────────────────────────────────

router.get("/admin/alert-rules", requireAdmin, async (_req, res) => {
  try {
    await connectDB();
    const rules = await AlertRuleModel.find().sort({ createdAt: -1 }).lean();
    res.json({ rules });
  } catch (err) {
    logger.error({ err }, "[AlertRules] GET list error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Create rule ───────────────────────────────────────────────────────────

router.post("/admin/alert-rules", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { name, metric, condition, threshold, windowMinutes, channels, cooldownMinutes } = req.body;

    if (!name || !metric || !condition || threshold === undefined) {
      res.status(400).json({ error: "name, metric, condition, threshold are required" });
      return;
    }

    const rule = await AlertRuleModel.create({
      _id: randomUUID(),
      name, metric, condition,
      threshold:       Number(threshold),
      windowMinutes:   Number(windowMinutes  ?? 5),
      cooldownMinutes: Number(cooldownMinutes ?? 30),
      channels:        channels ?? {},
      enabled:         true,
    });

    logger.info({ ruleId: rule._id, metric }, "[AlertRules] Rule created");
    res.status(201).json({ rule });
  } catch (err) {
    logger.error({ err }, "[AlertRules] POST error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Update rule ───────────────────────────────────────────────────────────

const UPDATABLE_FIELDS = [
  "name", "enabled", "metric", "condition", "threshold",
  "windowMinutes", "channels", "cooldownMinutes",
] as const;

router.patch("/admin/alert-rules/:id", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const update: Record<string, unknown> = {};
    for (const key of UPDATABLE_FIELDS) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    const rule = await AlertRuleModel.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { returnDocument: "after" },
    ).lean();

    if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
    res.json({ rule });
  } catch (err) {
    logger.error({ err }, "[AlertRules] PATCH error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Delete rule ───────────────────────────────────────────────────────────

router.delete("/admin/alert-rules/:id", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    await AlertRuleModel.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[AlertRules] DELETE error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Alert events feed ─────────────────────────────────────────────────────

router.get("/admin/alert-events", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const limit = Math.min(200, parseInt(String(req.query.limit ?? "50"), 10));
    const events = await AlertEventModel.find()
      .sort({ firedAt: -1 })
      .limit(limit)
      .lean();
    res.json({ events });
  } catch (err) {
    logger.error({ err }, "[AlertRules] GET events error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Test delivery ─────────────────────────────────────────────────────────

router.post("/admin/alert-rules/:id/test", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const rule = await AlertRuleModel.findById(req.params.id).lean();
    if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }

    const errors: Record<string, string> = {};
    const fired: string[] = [];

    if (rule.channels.slackWebhook) {
      try {
        await fetch(rule.channels.slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `🔔 *PRaww+ Test Alert*: [${rule.name}] — this is a test delivery` }),
        });
        fired.push("slack");
      } catch (e: any) { errors.slack = e?.message ?? "unknown"; }
    }

    if (rule.channels.webhookUrl) {
      try {
        await fetch(rule.channels.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alert: rule.name, test: true, firedAt: new Date().toISOString() }),
        });
        fired.push("webhook");
      } catch (e: any) { errors.webhook = e?.message ?? "unknown"; }
    }

    res.json({ ok: true, fired, errors });
  } catch (err) {
    logger.error({ err }, "[AlertRules] POST test error");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
