/**
 * Reseller Commission Routes — Phase 7
 * View commissions, approve, and link to payouts
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "@workspace/db";
import { ResellerCommissionModel } from "@workspace/db";
import { getCommissionSummary, approveCommissions, markCommissionsPaid } from "../lib/resellerEngine";
import { parsePageLimit } from "../lib/pagination";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

function requireReseller(req: Request, res: Response, next: () => void): void {
  if (!(req as any).isAuthenticated?.()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const u = (req as any).user;
  if (u.role !== "reseller" && !u.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  next();
}

router.get("/reseller/commissions", requireReseller, async (req, res) => {
  await connectDB();
  const resellerId = (req as any).user.isAdmin && req.query.resellerId
    ? String(req.query.resellerId)
    : (req as any).user.id;

  const { page, limit, skip } = parsePageLimit(req.query);
  const q: any = { resellerId };
  if (typeof req.query.status === "string") q.status = req.query.status;
  if (typeof req.query.type   === "string") q.type   = req.query.type;

  const [commissions, total, summary] = await Promise.all([
    ResellerCommissionModel.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ResellerCommissionModel.countDocuments(q),
    getCommissionSummary(resellerId),
  ]);

  res.json({
    commissions: commissions.map((c) => ({ ...c, id: c._id })),
    summary,
    total, page, limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/reseller/commissions/approve", requireAdmin, async (req, res) => {
  const { resellerId } = req.body;
  if (!resellerId) { res.status(400).json({ error: "resellerId is required" }); return; }
  await connectDB();
  const count = await approveCommissions(resellerId);
  res.json({ ok: true, approved: count });
});

router.post("/reseller/commissions/mark-paid", requireAdmin, async (req, res) => {
  const { resellerId, payoutId } = req.body;
  if (!resellerId || !payoutId) { res.status(400).json({ error: "resellerId and payoutId are required" }); return; }
  await connectDB();
  const count = await markCommissionsPaid(resellerId, payoutId);
  res.json({ ok: true, paid: count });
});

router.get("/reseller/commissions/summary/:resellerId", requireAdmin, async (req, res) => {
  await connectDB();
  const summary = await getCommissionSummary(String(req.params.resellerId));
  res.json(summary);
});

export default router;
