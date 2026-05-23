/**
 * IP block list management routes (admin only).
 *
 * GET    /api/admin/ip-blocks        — list current block list
 * POST   /api/admin/ip-blocks        — manually block an IP
 * DELETE /api/admin/ip-blocks/:ip    — unblock an IP
 * GET    /api/admin/ip-blocks/rates  — per-IP event rate counters
 */

import { Router, type IRouter } from "express";
import { ipReputation } from "../lib/ipReputation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!req.user?.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  next();
}

// ── Event rate counters — must be before :ip route ────────────────────────

router.get("/admin/ip-blocks/rates", requireAdmin, (_req, res) => {
  res.json({ rates: ipReputation.getRates() });
});

// ── List blocked IPs ──────────────────────────────────────────────────────

router.get("/admin/ip-blocks", requireAdmin, (_req, res) => {
  res.json({ blocks: ipReputation.getAll() });
});

// ── Manually block an IP ──────────────────────────────────────────────────

router.post("/admin/ip-blocks", requireAdmin, (req, res) => {
  const { ip, reason, durationMinutes } = req.body;
  if (!ip || !reason) {
    res.status(400).json({ error: "ip and reason are required" });
    return;
  }

  const durationMs = durationMinutes
    ? parseInt(String(durationMinutes), 10) * 60_000
    : undefined;

  ipReputation.block(String(ip), String(reason), durationMs, false);
  logger.info({ ip, reason, durationMs, admin: (req as any).user?.id }, "[IpBlocks] Manual block added");
  res.status(201).json({ ok: true, ip, reason });
});

// ── Unblock an IP ─────────────────────────────────────────────────────────

router.delete("/admin/ip-blocks/:ip", requireAdmin, (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const removed = ipReputation.unblock(ip);
  logger.info({ ip, admin: (req as any).user?.id, removed }, "[IpBlocks] IP unblocked");
  res.json({ ok: true, ip, removed });
});

export default router;
