/**
 * Enhanced audit log search route (admin only).
 *
 * GET /api/admin/audit
 *   ?q=<text>             — free-text search on action, targetLabel, adminEmail, ip
 *   &action=<string>      — filter by exact action
 *   &adminId=<string>     — filter by admin user id
 *   &adminEmail=<string>  — filter by admin email (partial, case-insensitive)
 *   &targetType=<string>  — filter by targetType
 *   &targetId=<string>    — filter by targetId
 *   &ip=<string>          — filter by IP address
 *   &from=<ISO date>      — start of date range
 *   &to=<ISO date>        — end of date range
 *   &limit=<number>       — max results (default 50, max 200)
 *
 * GET /api/admin/audit/user/:userId      — full history for a user
 * GET /api/admin/audit/meta/actions      — distinct action types (for dropdowns)
 */

import { Router, type IRouter } from "express";
import { connectDB, AuditLogModel } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!req.user?.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  next();
}

// ── Distinct action types ─────────────────────────────────────────────────

router.get("/admin/audit/meta/actions", requireAdmin, async (_req, res) => {
  try {
    await connectDB();
    const actions = await AuditLogModel.distinct("action");
    res.json({ actions: (actions as string[]).sort() });
  } catch (err) {
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Per-user history ──────────────────────────────────────────────────────

router.get("/admin/audit/user/:userId", requireAdmin, async (req, res) => {
  try {
    await connectDB();
    const { userId } = req.params;
    const limit = Math.min(200, parseInt(String(req.query.limit ?? "100"), 10));

    const logs = await AuditLogModel.find({
      $or: [{ adminId: userId }, { targetId: userId }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ logs, count: logs.length });
  } catch (err) {
    logger.error({ err }, "[AuditSearch] user history error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Main search ───────────────────────────────────────────────────────────

router.get("/admin/audit", requireAdmin, async (req, res) => {
  try {
    await connectDB();

    const q          = String(req.query.q          ?? "").trim();
    const action     = req.query.action     ? String(req.query.action)     : undefined;
    const adminId    = req.query.adminId    ? String(req.query.adminId)    : undefined;
    const adminEmail = req.query.adminEmail ? String(req.query.adminEmail) : undefined;
    const targetType = req.query.targetType ? String(req.query.targetType) : undefined;
    const targetId   = req.query.targetId   ? String(req.query.targetId)   : undefined;
    const ip         = req.query.ip         ? String(req.query.ip)         : undefined;
    const from       = req.query.from       ? String(req.query.from)       : undefined;
    const to         = req.query.to         ? String(req.query.to)         : undefined;
    const limit      = Math.min(200, parseInt(String(req.query.limit ?? "50"), 10));

    const filter: Record<string, unknown> = {};

    if (action)     filter.action     = action;
    if (adminId)    filter.adminId    = adminId;
    if (targetType) filter.targetType = targetType;
    if (targetId)   filter.targetId   = targetId;
    if (adminEmail) filter.adminEmail = { $regex: adminEmail, $options: "i" };
    if (ip)         filter.ip         = ip;

    if (from || to) {
      const tsFilter: Record<string, Date> = {};
      if (from) tsFilter.$gte = new Date(from);
      if (to)   tsFilter.$lte = new Date(to);
      filter.createdAt = tsFilter;
    }

    if (q) {
      const re = { $regex: q, $options: "i" };
      filter.$or = [
        { action:      re },
        { targetLabel: re },
        { adminEmail:  re },
        { ip:          re },
      ];
    }

    const logs = await AuditLogModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ logs, count: logs.length });
  } catch (err) {
    logger.error({ err }, "[AuditSearch] GET error");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
