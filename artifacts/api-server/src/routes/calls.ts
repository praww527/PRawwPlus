import { Router, type IRouter } from "express";
import { connectDB, CallModel, UserModel } from "@workspace/db";
import { randomUUID } from "crypto";
import { resolvePhoneToExtension } from "../lib/phoneResolver";
import { endCallById, webhookUpdate } from "../lib/callOrchestrator";
import {
  isValidFsCallId,
  countActiveCallsForUser,
  sumExternalCoinsSpentTodayUtc,
  maxConcurrentCallsPerUser,
  maxCoinsSpendPerDay,
  requireFsCallIdForExternal,
} from "../lib/callLimits";
import { userRateLimit } from "../lib/userRateLimit";
import { logger } from "../lib/logger";
import { parsePageLimit } from "../lib/pagination";

const router: IRouter = Router();

router.get("/calls", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { page, limit, skip } = parsePageLimit(req.query);

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

router.post("/calls", userRateLimit(40, 60_000), async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { recipientNumber, notes, fsCallId, direction } = req.body;

  if (!recipientNumber) {
    res.status(400).json({ error: "recipientNumber is required" });
    return;
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Require a verified mobile number to make any call.
  // Inbound webhooks from FreeSWITCH are exempt (direction === "inbound").
  if (direction !== "inbound" && (!user.phone || !user.phoneVerified)) {
    res.status(403).json({
      error: "Phone number required",
      message: "You must add and verify your mobile number before making calls.",
    });
    return;
  }

  const resolvedExtension = direction === "inbound"
    ? null
    : await resolvePhoneToExtension(String(recipientNumber));
  const route = resolvedExtension
    ? { type: "internal" as const, extension: resolvedExtension }
    : { type: direction === "inbound" ? "internal" as const : "external" as const };
  const callType = route.type;

  if (callType === "external") {
    const hasFs = fsCallId != null && String(fsCallId).trim() !== "";
    if (hasFs && !isValidFsCallId(fsCallId)) {
      res.status(400).json({
        error:   "Invalid fsCallId",
        message: "fsCallId must be a UUID string when provided.",
      });
      return;
    }
    if (requireFsCallIdForExternal() && !isValidFsCallId(fsCallId)) {
      res.status(400).json({
        error:   "fsCallId required",
        message:
          "Set REQUIRE_FS_CALL_ID_EXTERNAL=false for legacy SIP clients, or pass the Verto/FS channel UUID.",
      });
      return;
    }
    const maxConc = maxConcurrentCallsPerUser();
    if (maxConc > 0) {
      const active = await countActiveCallsForUser(userId);
      if (active >= maxConc) {
        res.status(429).json({
          error:   "Too many active calls",
          message: `You may have at most ${maxConc} active call(s). End a call before starting another.`,
        });
        return;
      }
    }
    const dailyCap = maxCoinsSpendPerDay();
    if (dailyCap > 0) {
      const spentToday = await sumExternalCoinsSpentTodayUtc(userId);
      if (spentToday >= dailyCap) {
        res.status(400).json({
          error:   "Daily external spend limit",
          message: `External calls are limited to ${dailyCap} coins per UTC day (recorded spend).`,
        });
        return;
      }
    }
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

  const callerNumber = user.phone ?? (user.extension ? String(user.extension) : undefined);
  const callId = randomUUID();

  const callRecord = await CallModel.create({
    _id:             callId,
    userId,
    callerNumber,
    recipientNumber,
    callType,
    direction:       direction === "inbound" ? "inbound" : "outbound",
    status:          "initiated",
    duration:        0,
    cost:            0,
    fsCallId:        fsCallId ?? undefined,
    notes:           notes ?? undefined,
    startedAt:       new Date(),
  });

  res.json({
    ...callRecord.toJSON(),
    id: callRecord._id,
    type: route.type,
    ...(route.type === "internal" && "extension" in route ? { extension: route.extension } : {}),
    dialTarget: route.type === "internal" && "extension" in route ? String(route.extension) : undefined,
  });
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

router.delete("/calls/:callId", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id as string;
  const { callId } = req.params;

  const result = await CallModel.deleteOne({ _id: callId, userId });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/calls/webhook/freeswitch", async (req, res) => {
  const hookSecret = process.env.FREESWITCH_WEBHOOK_SECRET;
  if (
    hookSecret &&
    String(req.get("x-fs-webhook-secret") ?? "") !== hookSecret
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { event, callId, userId, duration, status } = req.body;

  if (
    typeof callId !== "string" ||
    typeof userId !== "string" ||
    !callId.trim() ||
    !userId.trim()
  ) {
    res.sendStatus(200);
    return;
  }

  if (event != null && typeof event !== "string") {
    res.sendStatus(200);
    return;
  }

  const durationSecs = typeof duration === "number" ? Math.max(0, duration) : 0;

  try {
    await webhookUpdate(
      typeof event === "string" ? event : "",
      callId,
      userId,
      durationSecs,
      typeof status === "string" ? status : undefined,
    );
  } catch (err) {
    logger.error(
      { err, event, callId, userId },
      "[calls] webhookUpdate failed — returning 200 to avoid FS retry storm",
    );
  }

  res.sendStatus(200);
});

export default router;
