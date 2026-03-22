import { Router, type IRouter } from "express";
import { connectDB, CallModel, UserModel, PhoneNumberModel } from "@workspace/db";
import { randomUUID } from "crypto";
import crypto from "crypto";

const router: IRouter = Router();

const COINS_PER_MINUTE = 1;

router.get("/calls", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"))));
  const skip = (page - 1) * limit;

  const [callDocs, total] = await Promise.all([
    CallModel.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CallModel.countDocuments({ userId }),
  ]);

  const calls = callDocs.map((c) => ({ ...c, id: c._id }));
  res.json({ calls, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/calls", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { recipientNumber, notes } = req.body;

  if (!recipientNumber) {
    res.status(400).json({ error: "recipientNumber is required" });
    return;
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.subscriptionStatus !== "active") {
    res.status(400).json({
      error: "No active subscription",
      message: "You need an active subscription to make calls.",
    });
    return;
  }

  if (user.coins <= 0) {
    res.status(400).json({
      error: "Insufficient coins",
      message: "Your wallet is empty. Please top up to make calls.",
    });
    return;
  }

  const ownedNumber = await PhoneNumberModel.findOne({ userId });
  const callerNumber = ownedNumber?.number ?? null;

  const callId = randomUUID();
  let telnyxCallId: string | null = null;
  let callStatus = "initiated";

  const apiKey = process.env.TELNYX_API_KEY;
  const connectionId = process.env.TELNYX_SIP_CONNECTION_ID;

  if (apiKey && connectionId && callerNumber) {
    try {
      const telnyxRes = await fetch("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          connection_id: connectionId,
          to: recipientNumber,
          from: callerNumber,
          client_state: Buffer.from(JSON.stringify({ callId, userId })).toString("base64"),
        }),
      });
      if (telnyxRes.ok) {
        const data: any = await telnyxRes.json();
        telnyxCallId = data?.data?.call_leg_id ?? null;
        callStatus = "ringing";
      } else {
        const errBody = await telnyxRes.text().catch(() => "");
        console.error("Telnyx API error:", telnyxRes.status, errBody);
      }
    } catch (telnyxErr) {
      console.error("Telnyx call failed:", telnyxErr);
    }
  }

  const callRecord = await CallModel.create({
    _id: callId,
    userId,
    callerNumber: callerNumber ?? undefined,
    recipientNumber,
    status: callStatus,
    duration: 0,
    cost: 0,
    telnyxCallId: telnyxCallId ?? undefined,
    notes: notes ?? undefined,
    startedAt: new Date(),
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

function verifyTelnyxSignature(req: any): boolean {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return true;

  const signature = req.headers["telnyx-signature-ed25519"];
  const timestamp = req.headers["telnyx-timestamp"];
  if (!signature || !timestamp) return false;

  const tolerance = 300_000;
  const ts = parseInt(String(timestamp)) * 1000;
  if (isNaN(ts) || Math.abs(Date.now() - ts) > tolerance) return false;

  return true;
}

router.post("/calls/webhook", async (req, res) => {
  if (!verifyTelnyxSignature(req)) {
    res.status(403).json({ error: "Invalid webhook signature" });
    return;
  }

  const { data } = req.body;
  if (!data) {
    res.status(400).json({ error: "Invalid webhook" });
    return;
  }
  await connectDB();
  const { event_type, payload } = data;
  if (!payload?.client_state) {
    res.sendStatus(200);
    return;
  }

  try {
    const state = JSON.parse(Buffer.from(payload.client_state, "base64").toString());
    const { callId, userId } = state;
    if (!callId || !userId) {
      res.sendStatus(200);
      return;
    }

    const call = await CallModel.findById(callId);
    if (!call) {
      res.sendStatus(200);
      return;
    }

    if (event_type === "call.answered") {
      await CallModel.updateOne({ _id: callId }, { status: "in-progress", startedAt: new Date() });
    } else if (event_type === "call.hangup") {
      const duration =
        payload.hangup_cause === "normal_clearing" ? (payload.call_duration_secs ?? 0) : 0;
      const coinsUsed = Math.ceil((duration / 60) * COINS_PER_MINUTE);
      const endedAt = new Date();

      await CallModel.updateOne({ _id: callId }, { status: "completed", duration, cost: coinsUsed, endedAt });

      if (coinsUsed > 0) {
        await UserModel.updateOne(
          { _id: userId },
          {
            $inc: {
              coins: -coinsUsed,
              totalCallsUsed: 1,
              totalCoinsUsed: coinsUsed,
            },
          },
        );
      } else {
        await UserModel.updateOne({ _id: userId }, { $inc: { totalCallsUsed: 1 } });
      }
    } else if (event_type === "call.initiated") {
      await CallModel.updateOne({ _id: callId }, { status: "ringing" });
    }
  } catch (_e) {}

  res.sendStatus(200);
});

export default router;
