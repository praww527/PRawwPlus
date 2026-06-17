/**
 * Ring Group Routes — CRUD for ring groups.
 *
 * Ring groups allow multiple agents to be called simultaneously (ring-all)
 * or in sequence (round-robin) when an inbound DID routes to the group.
 *
 * All routes are admin-only.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { connectDB, UserModel } from "@workspace/db";
import { RingGroupModel } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: () => void): void {
  if (!(req as any).isAuthenticated?.() || !(req as any).user?.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/* ── GET /ring-groups — list all ring groups ── */
router.get("/ring-groups", requireAdmin, async (req, res) => {
  await connectDB();
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
  const filter: any = tenantId ? { tenantId } : {};
  const groups = await RingGroupModel.find(filter).sort({ name: 1 }).lean();

  const allMemberIds = [...new Set(groups.flatMap((g) => g.members))];
  const users = allMemberIds.length
    ? await UserModel.find({ _id: { $in: allMemberIds } })
        .select("_id name username extension")
        .lean()
    : [];
  const userMap = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  res.json({
    ringGroups: groups.map((g) => ({
      ...g,
      id: g._id,
      memberUsers: g.members.map((uid) => userMap[uid] ?? { _id: uid }),
    })),
  });
});

/* ── GET /ring-groups/:id — single ring group ── */
router.get("/ring-groups/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const group = await RingGroupModel.findById(req.params.id).lean();
  if (!group) { res.status(404).json({ error: "Not found" }); return; }

  const users = group.members.length
    ? await UserModel.find({ _id: { $in: group.members } })
        .select("_id name username extension")
        .lean()
    : [];
  const userMap = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  res.json({
    ringGroup: {
      ...group,
      id: group._id,
      memberUsers: group.members.map((uid) => userMap[uid] ?? { _id: uid }),
    },
  });
});

/* ── POST /ring-groups — create a ring group ── */
router.post("/ring-groups", requireAdmin, async (req, res) => {
  const { name, strategy, members, description, tenantId } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  await connectDB();

  const group = await RingGroupModel.create({
    _id:         randomUUID(),
    name:        name.trim(),
    strategy:    strategy ?? "ring-all",
    members:     Array.isArray(members) ? members : [],
    description: description ? String(description).trim() : undefined,
    tenantId:    tenantId ?? undefined,
    active:      true,
  });

  logger.info({ groupId: group._id, name: group.name }, "[ring-groups] Created");
  res.status(201).json({ ringGroup: { ...group.toObject(), id: group._id } });
});

/* ── PUT /ring-groups/:id — update a ring group ── */
router.put("/ring-groups/:id", requireAdmin, async (req, res) => {
  await connectDB();

  const allowed = ["name", "strategy", "members", "description", "tenantId", "active"];
  const update: any = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  }
  if (update.name) update.name = String(update.name).trim();

  const group = await RingGroupModel.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true },
  ).lean();

  if (!group) { res.status(404).json({ error: "Not found" }); return; }

  logger.info({ groupId: req.params.id }, "[ring-groups] Updated");
  res.json({ ringGroup: { ...group, id: group._id } });
});

/* ── DELETE /ring-groups/:id — delete a ring group ── */
router.delete("/ring-groups/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const group = await RingGroupModel.findByIdAndDelete(req.params.id).lean();
  if (!group) { res.status(404).json({ error: "Not found" }); return; }

  logger.info({ groupId: req.params.id }, "[ring-groups] Deleted");
  res.json({ ok: true });
});

/* ── POST /ring-groups/:id/members — add a member ── */
router.post("/ring-groups/:id/members", requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) { res.status(400).json({ error: "userId is required" }); return; }

  await connectDB();
  const user = await UserModel.findById(userId).select("_id name extension").lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const group = await RingGroupModel.findByIdAndUpdate(
    req.params.id,
    { $addToSet: { members: userId } },
    { new: true },
  ).lean();
  if (!group) { res.status(404).json({ error: "Ring group not found" }); return; }

  res.json({ ringGroup: { ...group, id: group._id } });
});

/* ── DELETE /ring-groups/:id/members/:userId — remove a member ── */
router.delete("/ring-groups/:id/members/:userId", requireAdmin, async (req, res) => {
  await connectDB();
  const group = await RingGroupModel.findByIdAndUpdate(
    req.params.id,
    { $pull: { members: req.params.userId } },
    { new: true },
  ).lean();
  if (!group) { res.status(404).json({ error: "Ring group not found" }); return; }

  res.json({ ringGroup: { ...group, id: group._id } });
});

export default router;
