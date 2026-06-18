import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { connectDB, RatePlanModel, InvoiceModel, CdrModel, UserModel, PlanChangeLogModel } from "@workspace/db";
import { parsePageLimit } from "../lib/pagination";
import { logger } from "../lib/logger";

// ── Plan definitions ──────────────────────────────────────────────────────────
export const PLAN_DEFS: Record<string, { name: string; monthlyFee: number; includedMinutes: number; ratePerMinute: number }> = {
  payg:     { name: "Pay As You Go", monthlyFee: 49,  includedMinutes: 0,   ratePerMinute: 0.69 },
  unlimited:{ name: "Unlimited",     monthlyFee: 299, includedMinutes: 500, ratePerMinute: 0.69 },
  custom:   { name: "Custom Plan",   monthlyFee: 0,   includedMinutes: 0,   ratePerMinute: 0.69 },
};

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Forbidden", message: "Admin access required" });
    return;
  }
  next();
}

router.get("/admin/rate-plans", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const [rows, total] = await Promise.all([
    RatePlanModel.find().sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    RatePlanModel.countDocuments(),
  ]);
  res.json({
    ratePlans: rows.map((r: any) => ({ ...r, id: r._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/rate-plans", requireAdmin, async (req, res) => {
  await connectDB();
  const body = req.body as any;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const defaultCoinsPerMinute = Number(body?.defaultCoinsPerMinute ?? 1);
  const currency = typeof body?.currency === "string" ? body.currency : "ZAR";
  const isActive = body?.isActive !== undefined ? Boolean(body.isActive) : true;

  const rates = Array.isArray(body?.rates) ? body.rates : [];
  const normalizedRates = rates
    .filter((r: any) => r && typeof r.prefix === "string")
    .map((r: any) => ({
      prefix: String(r.prefix),
      coinsPerMinute: Number(r.coinsPerMinute ?? defaultCoinsPerMinute),
      description: typeof r.description === "string" ? r.description : undefined,
    }));

  const doc = await RatePlanModel.create({
    _id: randomUUID(),
    name,
    currency,
    defaultCoinsPerMinute,
    rates: normalizedRates,
    isActive,
  });

  res.status(201).json({ ...doc.toObject(), id: doc._id });
});

router.patch("/admin/rate-plans/:id", requireAdmin, async (req, res) => {
  await connectDB();
  const id = req.params.id;
  const body = req.body as any;

  const update: Record<string, unknown> = {};
  if (typeof body?.name === "string") update.name = body.name.trim();
  if (body?.currency !== undefined && typeof body.currency === "string") update.currency = body.currency;
  if (body?.defaultCoinsPerMinute !== undefined) update.defaultCoinsPerMinute = Number(body.defaultCoinsPerMinute);
  if (body?.isActive !== undefined) update.isActive = Boolean(body.isActive);

  if (body?.rates !== undefined) {
    if (!Array.isArray(body.rates)) {
      res.status(400).json({ error: "rates must be an array" });
      return;
    }
    update.rates = body.rates
      .filter((r: any) => r && typeof r.prefix === "string")
      .map((r: any) => ({
        prefix: String(r.prefix),
        coinsPerMinute: Number(r.coinsPerMinute ?? 1),
        description: typeof r.description === "string" ? r.description : undefined,
      }));
  }

  const doc = await RatePlanModel.findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after' }).lean();
  if (!doc) {
    res.status(404).json({ error: "Rate plan not found" });
    return;
  }
  res.json({ ...doc, id: doc._id });
});

function parsePeriod(period: string): { start: Date; end: Date; key: string } | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  const [y, m] = period.split("-").map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start, end, key: period };
}

// ── Admin plan management ─────────────────────────────────────────────────────

router.get("/admin/plans/users", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const planFilter = typeof req.query.plan === "string" ? req.query.plan : undefined;
  const search     = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

  const filter: Record<string, unknown> = {};
  if (planFilter) filter.planId = planFilter;
  if (search) {
    filter.$or = [
      { email:    { $regex: search, $options: "i" } },
      { username: { $regex: search, $options: "i" } },
      { name:     { $regex: search, $options: "i" } },
    ];
  }

  const [users, total] = await Promise.all([
    UserModel.find(filter)
      .select("email username name planId customMonthlyFee customMinutes customRate monthlyMinutesUsed coins subscriptionStatus createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserModel.countDocuments(filter),
  ]);

  const COIN_VALUE = 0.9;
  res.json({
    users: users.map((u: any) => ({
      id: u._id,
      email: u.email,
      username: u.username,
      name: u.name,
      planId: u.planId ?? "payg",
      walletBalance: Math.round((u.coins ?? 0) * COIN_VALUE * 100) / 100,
      coins: u.coins ?? 0,
      monthlyMinutesUsed: u.monthlyMinutesUsed ?? 0,
      customMonthlyFee: u.customMonthlyFee,
      customMinutes: u.customMinutes,
      customRate: u.customRate,
      subscriptionStatus: u.subscriptionStatus,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/plans/assign", requireAdmin, async (req, res) => {
  await connectDB();
  const adminId   = (req as any).user.id;
  const adminName = (req as any).user.name ?? (req as any).user.email ?? "Admin";
  const body = req.body as any;

  const userId         = typeof body.userId === "string" ? body.userId.trim() : "";
  const newPlanId      = typeof body.planId === "string" ? body.planId.trim() : "";
  const notes          = typeof body.notes === "string" ? body.notes.trim() : undefined;
  const customMonthlyFee = body.customMonthlyFee !== undefined ? Number(body.customMonthlyFee) : undefined;
  const customMinutes    = body.customMinutes    !== undefined ? Number(body.customMinutes)    : undefined;
  const customRate       = body.customRate       !== undefined ? Number(body.customRate)       : undefined;

  if (!userId || !newPlanId) {
    res.status(400).json({ error: "userId and planId are required" });
    return;
  }
  if (!["payg", "unlimited", "custom"].includes(newPlanId)) {
    res.status(400).json({ error: "planId must be payg, unlimited, or custom" });
    return;
  }

  const user = await UserModel.findById(userId).select("planId customMonthlyFee customMinutes customRate monthlyMinutesUsed").lean();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const oldPlan = (user as any).planId ?? "payg";
  const planDef = PLAN_DEFS[newPlanId];

  const updateFields: Record<string, unknown> = {
    planId: newPlanId,
    subscriptionPlan: newPlanId,
    monthlyMinutesUsed: 0,
    monthlyMinutesResetAt: new Date(),
  };

  if (newPlanId === "custom") {
    if (customMonthlyFee !== undefined) updateFields.customMonthlyFee = customMonthlyFee;
    if (customMinutes    !== undefined) updateFields.customMinutes    = customMinutes;
    if (customRate       !== undefined) updateFields.customRate       = customRate;
  } else {
    updateFields.customMonthlyFee = undefined;
    updateFields.customMinutes    = undefined;
    updateFields.customRate       = undefined;
  }

  await UserModel.updateOne({ _id: userId }, { $set: updateFields, $unset: newPlanId !== "custom" ? { customMonthlyFee: 1, customMinutes: 1, customRate: 1 } : {} });

  await PlanChangeLogModel.create({
    _id: randomUUID(),
    userId,
    adminId,
    adminName,
    oldPlan,
    newPlan: newPlanId,
    oldMonthlyFee: PLAN_DEFS[oldPlan]?.monthlyFee ?? (user as any).customMonthlyFee,
    newMonthlyFee: newPlanId === "custom" ? customMonthlyFee : planDef.monthlyFee,
    oldMinutes:    PLAN_DEFS[oldPlan]?.includedMinutes ?? (user as any).customMinutes,
    newMinutes:    newPlanId === "custom" ? customMinutes : planDef.includedMinutes,
    oldRate:       PLAN_DEFS[oldPlan]?.ratePerMinute ?? (user as any).customRate,
    newRate:       newPlanId === "custom" ? customRate : planDef.ratePerMinute,
    notes,
  });

  logger.info({ adminId, userId, oldPlan, newPlan: newPlanId }, "[Admin] Plan assigned");
  res.json({ ok: true, userId, planId: newPlanId });
});

router.get("/admin/plans/logs", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const userIdFilter = typeof req.query.userId === "string" ? req.query.userId : undefined;

  const filter: Record<string, unknown> = {};
  if (userIdFilter) filter.userId = userIdFilter;

  const [logs, total] = await Promise.all([
    PlanChangeLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PlanChangeLogModel.countDocuments(filter),
  ]);

  res.json({
    logs: logs.map((l: any) => ({ ...l, id: l._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/plans/invoices/generate", requireAdmin, async (req, res) => {
  await connectDB();
  const period = typeof req.query.period === "string" ? req.query.period : "";
  const parsed = parsePeriod(period);
  if (!parsed) {
    res.status(400).json({ error: "period must be YYYY-MM" });
    return;
  }

  const users = await UserModel.find().select("_id").lean();
  let generated = 0;

  for (const u of users) {
    const userId = String(u._id);
    const cdr = await CdrModel.find({
      userId,
      endedAt: { $gte: parsed.start, $lt: parsed.end },
      coinsUsed: { $gt: 0 },
    }).sort({ endedAt: 1 }).lean();

    if (cdr.length === 0) continue;

    const lines = cdr.map((row: any) => ({
      description: `Call ${row.recipientNumber ?? ""}`.trim(),
      coins: row.coinsUsed ?? 0,
      callId: row.callId,
      cdrId: row._id,
    }));

    const totalCoins = lines.reduce((acc: number, l: any) => acc + (Number(l.coins) || 0), 0);
    const invoiceId = `inv:${userId}:${parsed.key}`;

    await InvoiceModel.updateOne(
      { _id: invoiceId },
      {
        $setOnInsert: {
          userId,
          periodStart: parsed.start,
          periodEnd: parsed.end,
        },
        $set: {
          totalCoins,
          lines,
          status: "draft",
        },
      },
      { upsert: true },
    );

    generated++;
  }

  res.json({ message: "Invoices generated", period: parsed.key, generated });
});

export default router;
