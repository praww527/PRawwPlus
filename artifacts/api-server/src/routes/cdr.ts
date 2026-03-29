import { Router, type IRouter } from "express";
import { connectDB, CdrModel } from "@workspace/db";
import { parsePageLimit } from "../lib/pagination";

const router: IRouter = Router();

router.get("/cdr", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await connectDB();
  const userId = (req as any).user.id as string;

  const { page, limit, skip } = parsePageLimit(req.query);
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

  const query: Record<string, unknown> = { userId };
  if (from && !isNaN(from.getTime())) {
    query.endedAt = { ...(query.endedAt as any), $gte: from };
  }
  if (to && !isNaN(to.getTime())) {
    query.endedAt = { ...(query.endedAt as any), $lte: to };
  }

  if (typeof req.query.direction === "string") {
    query.direction = req.query.direction;
  }
  if (typeof req.query.callType === "string") {
    query.callType = req.query.callType;
  }

  const [rows, total] = await Promise.all([
    CdrModel.find(query).sort({ endedAt: -1 }).skip(skip).limit(limit).lean(),
    CdrModel.countDocuments(query),
  ]);

  res.json({
    cdr: rows.map((r) => ({ ...r, id: r._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

export default router;
