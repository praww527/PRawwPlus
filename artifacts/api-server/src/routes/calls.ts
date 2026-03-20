import { Router, type IRouter } from "express";
import { db, callsTable, usersTable } from "@workspace/db";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

const router: IRouter = Router();

const COST_PER_MINUTE = 0.5;

router.get("/calls", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = (req as any).user.id;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"))));
  const offset = (page - 1) * limit;

  const [callRows, totalRows] = await Promise.all([
    db.select().from(callsTable).where(eq(callsTable.userId, userId)).orderBy(desc(callsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(callsTable).where(eq(callsTable.userId, userId)),
  ]);

  const total = totalRows[0]?.count ?? 0;
  res.json({
    calls: callRows,
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
  const userId = (req as any).user.id;
  const { recipientNumber, callerNumber, notes } = req.body;

  if (!recipientNumber) {
    res.status(400).json({ error: "recipientNumber is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.creditBalance <= 0) {
    res.status(400).json({ error: "Insufficient credit", message: "Your call credit is exhausted. Please subscribe or top up to make calls." });
    return;
  }

  if (user.subscriptionStatus !== "active") {
    res.status(400).json({ error: "No active subscription", message: "You need an active subscription to make calls." });
    return;
  }

  const callId = randomUUID();
  let telnyxCallId: string | null = null;
  let callStatus = "initiated";

  const apiKey = process.env.TELNYX_API_KEY;
  const connectionId = process.env.TELNYX_SIP_CONNECTION_ID;

  if (apiKey && connectionId) {
    try {
      const telnyxRes = await fetch("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          connection_id: connectionId,
          to: recipientNumber,
          from: callerNumber || "+27000000000",
          client_state: Buffer.from(JSON.stringify({ callId, userId })).toString("base64"),
        }),
      });
      if (telnyxRes.ok) {
        const data: any = await telnyxRes.json();
        telnyxCallId = data?.data?.call_leg_id ?? null;
        callStatus = "ringing";
      } else {
        callStatus = "initiated";
      }
    } catch (_e) {
      callStatus = "initiated";
    }
  }

  const [callRecord] = await db.insert(callsTable).values({
    id: callId,
    userId,
    callerNumber: callerNumber ?? null,
    recipientNumber,
    status: callStatus,
    duration: 0,
    cost: 0,
    telnyxCallId,
    notes: notes ?? null,
    startedAt: new Date(),
  }).returning();

  res.json(callRecord);
});

router.get("/calls/:callId", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = (req as any).user.id;
  const { callId } = req.params;

  const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, callId), eq(callsTable.userId, userId)));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(call);
});

router.post("/calls/webhook", async (req, res) => {
  const { data } = req.body;
  if (!data) {
    res.status(400).json({ error: "Invalid webhook" });
    return;
  }
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

    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId));
    if (!call) {
      res.sendStatus(200);
      return;
    }

    if (event_type === "call.answered") {
      await db.update(callsTable).set({ status: "in-progress", startedAt: new Date() }).where(eq(callsTable.id, callId));
    } else if (event_type === "call.hangup") {
      const duration = payload.hangup_cause === "normal_clearing" ? (payload.call_duration_secs ?? 0) : 0;
      const cost = parseFloat(((duration / 60) * COST_PER_MINUTE).toFixed(2));
      const endedAt = new Date();

      await db.update(callsTable).set({
        status: "completed",
        duration,
        cost,
        endedAt,
      }).where(eq(callsTable.id, callId));

      if (cost > 0) {
        await db.update(usersTable).set({
          creditBalance: sql`${usersTable.creditBalance} - ${cost}`,
          totalCallsUsed: sql`${usersTable.totalCallsUsed} + 1`,
          totalCreditUsed: sql`${usersTable.totalCreditUsed} + ${cost}`,
        }).where(eq(usersTable.id, userId));
      } else {
        await db.update(usersTable).set({
          totalCallsUsed: sql`${usersTable.totalCallsUsed} + 1`,
        }).where(eq(usersTable.id, userId));
      }
    } else if (event_type === "call.initiated") {
      await db.update(callsTable).set({ status: "ringing" }).where(eq(callsTable.id, callId));
    }
  } catch (_e) {}

  res.sendStatus(200);
});

export default router;
