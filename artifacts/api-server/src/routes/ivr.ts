/**
 * IVR Flow Routes — Phase 2
 * CRUD for IVR flows + config push to FreeSWITCH
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { connectDB } from "@workspace/db";
import { IvrFlowModel } from "@workspace/db";
import { logger } from "../lib/logger";
import { pushFreeSwitchConfig } from "../lib/freeswitchSSH";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: () => void): void {
  if (!(req as any).isAuthenticated?.() || !(req as any).user?.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

router.get("/ivr/flows", requireAdmin, async (req, res) => {
  await connectDB();
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
  const q: any   = tenantId ? { tenantId } : {};
  const flows    = await IvrFlowModel.find(q).sort({ createdAt: -1 }).lean();
  res.json({ flows: flows.map((f) => ({ ...f, id: f._id })) });
});

router.get("/ivr/flows/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const flow = await IvrFlowModel.findById(req.params.id).lean();
  if (!flow) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ flow: { ...flow, id: flow._id } });
});

router.post("/ivr/flows", requireAdmin, async (req, res) => {
  const { name, extension, description, nodes, startNode, tenantId, active } = req.body;
  if (!name || !extension || !startNode) {
    res.status(400).json({ error: "name, extension, and startNode are required" });
    return;
  }

  await connectDB();

  const existing = await IvrFlowModel.findOne({ extension: Number(extension) }).lean();
  if (existing) {
    res.status(409).json({ error: `Extension ${extension} is already used by IVR "${(existing as any).name}"` });
    return;
  }

  const flow = await IvrFlowModel.create({
    _id:       randomUUID(),
    name:      String(name).trim(),
    extension: Number(extension),
    description: description ? String(description).trim() : undefined,
    nodes:     Array.isArray(nodes) ? nodes : [],
    startNode: String(startNode),
    tenantId,
    active:    active !== false,
  });

  logger.info({ flowId: flow._id, extension }, "[ivr] Flow created");
  res.status(201).json({ flow: { ...flow.toObject(), id: flow._id } });
});

router.put("/ivr/flows/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const allowed = ["name", "description", "nodes", "startNode", "tenantId", "active", "extension"];
  const update: any = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  }

  const flow = await IvrFlowModel.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true },
  ).lean();

  if (!flow) { res.status(404).json({ error: "Not found" }); return; }

  logger.info({ flowId: req.params.id }, "[ivr] Flow updated");
  res.json({ flow: { ...flow, id: flow._id } });
});

router.delete("/ivr/flows/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const flow = await IvrFlowModel.findByIdAndDelete(req.params.id).lean();
  if (!flow) { res.status(404).json({ error: "Not found" }); return; }
  logger.info({ flowId: req.params.id }, "[ivr] Flow deleted");
  res.json({ ok: true });
});

router.post("/ivr/flows/:id/push", requireAdmin, async (_req, res) => {
  try {
    await pushFreeSwitchConfig();
    res.json({ ok: true, message: "FreeSWITCH config pushed" });
  } catch (err: any) {
    logger.error({ err }, "[ivr] push to FreeSWITCH failed");
    res.status(500).json({ error: err?.message ?? "Push failed" });
  }
});

export default router;
