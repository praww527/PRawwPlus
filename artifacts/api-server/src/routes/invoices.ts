import { Router, type IRouter } from "express";
import { connectDB, InvoiceModel } from "@workspace/db";
import { parsePageLimit } from "../lib/pagination";

const router: IRouter = Router();

function parsePeriod(period: string): { start: Date; end: Date; key: string } | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  const [y, m] = period.split("-").map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start, end, key: period };
}

router.get("/invoices", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await connectDB();
  const userId = (req as any).user.id as string;
  const { page, limit, skip } = parsePageLimit(req.query);

  const [rows, total] = await Promise.all([
    InvoiceModel.find({ userId }).sort({ periodStart: -1 }).skip(skip).limit(limit).lean(),
    InvoiceModel.countDocuments({ userId }),
  ]);

  res.json({
    invoices: rows.map((r) => ({ ...r, id: r._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.get("/invoices/by-period", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const period = typeof req.query.period === "string" ? req.query.period : "";
  const parsed = parsePeriod(period);
  if (!parsed) {
    res.status(400).json({ error: "period must be YYYY-MM" });
    return;
  }

  await connectDB();
  const userId = (req as any).user.id as string;
  const invoiceId = `inv:${userId}:${parsed.key}`;

  const inv = await InvoiceModel.findOne({ _id: invoiceId, userId }).lean();
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json({ invoice: { ...inv, id: inv._id } });
});

export default router;
