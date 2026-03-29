import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { connectDB, RatePlanModel, InvoiceModel, CdrModel, UserModel } from "@workspace/db";
import { parsePageLimit } from "../lib/pagination";

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
    ratePlans: rows.map((r) => ({ ...r, id: r._id })),
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

  const doc = await RatePlanModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
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

router.post("/admin/invoices/generate", requireAdmin, async (req, res) => {
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

    const lines = cdr.map((row) => ({
      description: `Call ${row.recipientNumber ?? ""}`.trim(),
      coins: row.coinsUsed ?? 0,
      callId: row.callId,
      cdrId: row._id,
    }));

    const totalCoins = lines.reduce((acc, l) => acc + (Number(l.coins) || 0), 0);
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
