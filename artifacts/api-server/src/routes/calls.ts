import { Router, type IRouter } from "express";
import { connectDB, CallModel, UserModel } from "@workspace/db";
import { randomUUID } from "crypto";
import { isInternalNumber } from "../lib/extension";
import { endCallById, webhookUpdate } from "../lib/callOrchestrator";

const router: IRouter = Router();

router.get("/calls", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const page  = Math.max(1, parseInt(String(req.query.page  ?? "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"))));
  const skip  = (page - 1) * limit;

  const [callDocs, total] = await Promise.all([
    CallModel.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CallModel.countDocuments({ userId }),
  ]);

  res.json({
    calls: callDocs.map((c) => ({ ...c, id: c._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/calls", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { recipientNumber, notes, fsCallId } = req.body;

  if (!recipientNumber) {
    res.status(400).json({ error: "recipientNumber is required" });
    return;
  }

  const callType = isInternalNumber(recipientNumber) ? "internal" : "external";

  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (callType === "external") {
    if (user.subscriptionStatus !== "active") {
      res.status(400).json({
        error:   "No active subscription",
        message: "You need an active subscription to make external calls.",
      });
      return;
    }
    if (user.coins <= 0) {
      res.status(400).json({
        error:   "Insufficient coins",
        message: "Your wallet is empty. Please top up to make external calls.",
      });
      return;
    }
  }

  const callerNumber = user.extension ? String(user.extension) : undefined;
  const callId = randomUUID();

  const callRecord = await CallModel.create({
    _id:             callId,
    userId,
    callerNumber,
    recipientNumber,
    callType,
    status:          "initiated",
    duration:        0,
    cost:            0,
    fsCallId:        fsCallId ?? undefined,
    notes:           notes ?? undefined,
    startedAt:       new Date(),
  });

  res.json({ ...callRecord.toJSON(), id: callRecord._id });
});

router.get("/calls/:callId", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { callId } = req.params;

  const call = await CallModel.findOne({ _id: callId, userId }).lean();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json({ ...call, id: call._id });
});

router.post("/calls/:callId/end", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId  = (req as any).user.id as string;
  const { callId } = req.params;
  const { duration, status } = req.body;

  const durationSecs = typeof duration === "number" ? Math.max(0, Math.floor(duration)) : 0;

  try {
    const result = await endCallById(callId, userId, durationSecs, status);
    res.json(result);
  } catch (err: any) {
    const code = err?.statusCode ?? 500;
    res.status(code).json({ error: err?.message ?? "Internal server error" });
  }
});

router.post("/calls/webhook/freeswitch", async (req, res) => {
  const { event, callId, userId, duration, status } = req.body;

  if (!callId || !userId) {
    res.sendStatus(200);
    return;
  }

  const durationSecs = typeof duration === "number" ? Math.max(0, duration) : 0;

  try {
    await webhookUpdate(event, callId, userId, durationSecs, status);
  } catch (err) {
    // Webhook must always return 200 so FreeSWITCH doesn't retry indefinitely
  }

  res.sendStatus(200);
});

export default router;
