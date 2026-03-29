import { Router, type IRouter } from "express";
import { connectDB, InvoiceModel } from "@workspace/db";
import { parsePageLimit } from "../lib/pagination";

const router: IRouter = Router();

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

export default router;
