/**
 * Call Queue Routes — Phase 2
 * CRUD for call queues + live stats + agent management
 */

import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { connectDB, UserModel } from "@workspace/db";
import { CallQueueModel } from "@workspace/db";
import { getAllQueueStats, getQueueDepth } from "../lib/callQueue";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/queues", requireAdmin, async (req, res) => {
  await connectDB();
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
  const q: any   = tenantId ? { tenantId } : {};
  const queues   = await CallQueueModel.find(q).sort({ extension: 1 }).lean();
  const stats    = getAllQueueStats();
  const statsMap = Object.fromEntries(stats.map((s) => [s.queueId, s]));

  res.json({
    queues: queues.map((q) => ({
      ...q,
      id:        q._id,
      liveStats: statsMap[String(q._id)] ?? null,
      liveDepth: getQueueDepth(String(q._id)),
    })),
  });
});

router.get("/queues/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const queue = await CallQueueModel.findById(req.params.id).lean();
  if (!queue) { res.status(404).json({ error: "Not found" }); return; }

  const userIds = queue.agents.map((a) => a.userId).filter(Boolean);
  const users   = userIds.length
    ? await UserModel.find({ _id: { $in: userIds } }).select("_id name username extension").lean()
    : [];
  const uMap    = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  res.json({
    queue: {
      ...queue,
      id:     queue._id,
      agents: queue.agents.map((a) => ({ ...a, user: uMap[a.userId] ?? null })),
      liveDepth: getQueueDepth(String(queue._id)),
      liveStats: getAllQueueStats().find((s) => s.queueId === String(queue._id)) ?? null,
    },
  });
});

router.post("/queues", requireAdmin, async (req, res) => {
  const { name, extension, description, strategy, maxWaitSec, maxQueueDepth,
          announceFreqSec, musicOnHold, greetingFile, overflowAction, overflowTarget,
          timeoutAction, timeoutTarget, tenantId } = req.body;

  if (!name || !extension) {
    res.status(400).json({ error: "name and extension are required" });
    return;
  }

  await connectDB();

  const existing = await CallQueueModel.findOne({ extension: Number(extension) }).lean();
  if (existing) {
    res.status(409).json({ error: `Extension ${extension} is already used by queue "${(existing as any).name}"` });
    return;
  }

  const queue = await CallQueueModel.create({
    _id:             randomUUID(),
    name:            String(name).trim(),
    extension:       Number(extension),
    description:     description ? String(description).trim() : undefined,
    strategy:        strategy ?? "round-robin",
    maxWaitSec:      maxWaitSec     ?? 120,
    maxQueueDepth:   maxQueueDepth  ?? 20,
    announceFreqSec: announceFreqSec ?? 30,
    musicOnHold,
    greetingFile,
    overflowAction:  overflowAction ?? "voicemail",
    overflowTarget,
    timeoutAction:   timeoutAction  ?? "voicemail",
    timeoutTarget,
    tenantId,
    agents:          [],
    active:          true,
  });

  logger.info({ queueId: queue._id, extension }, "[queues] Queue created");
  res.status(201).json({ queue: { ...queue.toObject(), id: queue._id } });
});

router.put("/queues/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const allowed = [
    "name","description","strategy","maxWaitSec","maxQueueDepth","announceFreqSec",
    "musicOnHold","greetingFile","overflowAction","overflowTarget","timeoutAction",
    "timeoutTarget","tenantId","active",
  ];
  const update: any = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  }

  const queue = await CallQueueModel.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true },
  ).lean();

  if (!queue) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ queue: { ...queue, id: queue._id } });
});

router.delete("/queues/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const queue = await CallQueueModel.findByIdAndDelete(req.params.id).lean();
  if (!queue) { res.status(404).json({ error: "Not found" }); return; }
  logger.info({ queueId: req.params.id }, "[queues] Queue deleted");
  res.json({ ok: true });
});

router.post("/queues/:id/agents", requireAdmin, async (req, res) => {
  const { userId, penalty } = req.body;
  if (!userId) { res.status(400).json({ error: "userId is required" }); return; }

  await connectDB();
  const user = await UserModel.findById(userId).select("extension").lean();
  if (!user || !(user as any).extension) {
    res.status(404).json({ error: "User not found or has no extension" });
    return;
  }

  const queue = await CallQueueModel.findByIdAndUpdate(
    req.params.id,
    {
      $push: {
        agents: {
          userId,
          extension: (user as any).extension,
          penalty:   penalty ?? 0,
          paused:    false,
        },
      },
    },
    { new: true },
  ).lean();

  if (!queue) { res.status(404).json({ error: "Queue not found" }); return; }
  res.json({ queue: { ...queue, id: queue._id } });
});

router.delete("/queues/:id/agents/:userId", requireAdmin, async (req, res) => {
  await connectDB();
  const queue = await CallQueueModel.findByIdAndUpdate(
    req.params.id,
    { $pull: { agents: { userId: req.params.userId } } },
    { new: true },
  ).lean();

  if (!queue) { res.status(404).json({ error: "Queue not found" }); return; }
  res.json({ queue: { ...queue, id: queue._id } });
});

router.patch("/queues/:id/agents/:userId/pause", requireAdmin, async (req, res) => {
  const { paused, reason } = req.body;
  await connectDB();

  const update: any = { "agents.$.paused": !!paused };
  if (paused)  { update["agents.$.pausedAt"] = new Date(); update["agents.$.pauseReason"] = reason ?? ""; }
  else         { update["agents.$.pausedAt"] = null; update["agents.$.pauseReason"] = ""; }

  const queue = await CallQueueModel.findOneAndUpdate(
    { _id: req.params.id, "agents.userId": req.params.userId },
    { $set: update },
    { new: true },
  ).lean();

  if (!queue) { res.status(404).json({ error: "Queue or agent not found" }); return; }
  res.json({ ok: true, paused: !!paused });
});

router.get("/queues/stats/live", requireAdmin, (_req, res) => {
  res.json({ stats: getAllQueueStats(), asOf: new Date().toISOString() });
});

export default router;
