/**
 * Tenant isolation admin routes.
 *
 * GET  /api/admin/tenants          — list all tenants (grouped by tenantId)
 * GET  /api/admin/tenants/:id      — single tenant detail + member list
 * POST /api/admin/tenants/:id/config — set per-tenant SystemConfig overrides
 */

import { Router, type IRouter } from "express";
import { connectDB, UserModel, SystemConfigModel } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!req.user?.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  next();
}

// ── List tenants ──────────────────────────────────────────────────────────

router.get("/admin/tenants", requireAdmin, async (_req, res) => {
  try {
    await connectDB();

    // Aggregate users by tenantId.
    // Users with no tenantId are treated as personal (single-user) tenants.
    const groups = await UserModel.aggregate([
      {
        $group: {
          _id:        "$tenantId",
          memberCount: { $sum: 1 },
          members: {
            $push: {
              id:      "$_id",
              email:   "$email",
              name:    "$name",
              isAdmin: "$isAdmin",
              role:    "$role",
              locked:  "$locked",
            },
          },
          createdAt: { $min: "$createdAt" },
        },
      },
      { $sort: { memberCount: -1 } },
    ]);

    const tenants = groups.map((g: any) => ({
      tenantId:    g._id ?? "__personal__",
      memberCount: g.memberCount,
      createdAt:   g.createdAt,
      members:     g.members,
    }));

    res.json({ tenants, total: tenants.length });
  } catch (err) {
    logger.error({ err }, "[Tenants] GET list error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Get single tenant ─────────────────────────────────────────────────────

router.get("/admin/tenants/:id", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const tenantId = req.params.id === "__personal__" ? null : req.params.id;

    const members = await UserModel.find(
      tenantId ? { tenantId } : { tenantId: { $exists: false } },
    )
      .select("_id email name isAdmin role locked subscriptionPlan coins createdAt")
      .sort({ createdAt: 1 })
      .lean();

    // Fetch per-tenant SystemConfig if it exists
    const configKey = `tenant:${req.params.id}`;
    const config = await SystemConfigModel.findById(configKey).lean().catch(() => null);

    res.json({ tenantId: req.params.id, members, config: config ?? null });
  } catch (err) {
    logger.error({ err }, "[Tenants] GET detail error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Per-tenant config overrides ────────────────────────────────────────────

router.post("/admin/tenants/:id/config", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const configKey = `tenant:${req.params.id}`;
    const { iceServers, rateLimits } = req.body;

    const update: Record<string, unknown> = {};
    if (iceServers !== undefined) update.iceServers = iceServers;
    if (rateLimits  !== undefined) update.rateLimits = rateLimits;

    const config = await SystemConfigModel.findByIdAndUpdate(
      configKey,
      { $set: update },
      { upsert: true, returnDocument: "after" },
    ).lean();

    logger.info({ tenantId: req.params.id, update }, "[Tenants] Config updated");
    res.json({ config });
  } catch (err) {
    logger.error({ err }, "[Tenants] POST config error");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
