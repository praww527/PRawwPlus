/**
 * Number Porting Routes — Phase 5
 * Submit, track, and manage number porting requests
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { connectDB } from "@workspace/db";
import { PortRequestModel } from "@workspace/db";
import { parsePageLimit } from "../lib/pagination";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: () => void): void {
  if (!(req as any).isAuthenticated?.()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.get("/port-requests", requireAuth, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const userId = (req as any).user.isAdmin
    ? (typeof req.query.userId === "string" ? req.query.userId : undefined)
    : (req as any).user.id;

  const q: any = {};
  if (userId) q.userId = userId;
  if (typeof req.query.status === "string") q.status = req.query.status;

  const [requests, total] = await Promise.all([
    PortRequestModel.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PortRequestModel.countDocuments(q),
  ]);

  res.json({ requests: requests.map((r) => ({ ...r, id: r._id })), total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get("/port-requests/:id", requireAuth, async (req, res) => {
  await connectDB();
  const r = await PortRequestModel.findById(req.params.id).lean();
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  const userId = (req as any).user.id;
  if (!((req as any).user.isAdmin) && (r as any).userId !== userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json({ request: { ...r, id: r._id } });
});

router.post("/port-requests", requireAuth, async (req, res) => {
  const { numbers, losingCarrier, contactName, contactEmail, contactPhone, accountNumber, billingAddress, notes } = req.body;

  if (!numbers?.length || !losingCarrier || !contactName || !contactEmail || !contactPhone || !accountNumber) {
    res.status(400).json({ error: "numbers, losingCarrier, contactName, contactEmail, contactPhone, and accountNumber are required" });
    return;
  }

  await connectDB();
  const r = await PortRequestModel.create({
    _id: randomUUID(),
    userId: (req as any).user.id,
    numbers: Array.isArray(numbers) ? numbers.map(String) : [String(numbers)],
    losingCarrier: String(losingCarrier).trim(),
    contactName:   String(contactName).trim(),
    contactEmail:  String(contactEmail).trim(),
    contactPhone:  String(contactPhone).trim(),
    accountNumber: String(accountNumber).trim(),
    billingAddress: billingAddress ? String(billingAddress).trim() : undefined,
    notes:          notes ? String(notes).trim() : undefined,
    status:        "submitted",
    submittedAt:   new Date(),
  });

  logger.info({ portRequestId: r._id, userId: (req as any).user.id, numbers }, "[portRequests] Request submitted");
  res.status(201).json({ request: { ...r.toObject(), id: r._id } });
});

router.patch("/port-requests/:id/status", requireAdmin, async (req, res) => {
  const { status, adminNotes, rejectionReason, portDate } = req.body;
  await connectDB();

  const update: any = { status };
  if (adminNotes) update.adminNotes = adminNotes;
  if (rejectionReason) update.rejectionReason = rejectionReason;
  if (portDate) update.portDate = new Date(portDate);
  if (status === "completed") update.completedAt = new Date();

  const r = await PortRequestModel.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true },
  ).lean();

  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  logger.info({ portRequestId: req.params.id, status }, "[portRequests] Status updated");
  res.json({ request: { ...r, id: r._id } });
});

router.delete("/port-requests/:id", requireAuth, async (req, res) => {
  await connectDB();
  const r = await PortRequestModel.findById(req.params.id).lean();
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!((req as any).user.isAdmin) && (r as any).userId !== (req as any).user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (!["draft","submitted"].includes((r as any).status)) {
    res.status(400).json({ error: "Can only cancel draft or submitted requests" }); return;
  }
  await PortRequestModel.findByIdAndUpdate(req.params.id, { $set: { status: "cancelled" } });
  res.json({ ok: true });
});

export default router;
