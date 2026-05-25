/**
 * CDR Export Route — Phase 3
 * CSV export of CDRs with full filtering. Admin can export all users; users export own.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, CdrModel } from "@workspace/db";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: () => void): void {
  if (!(req as any).isAuthenticated?.()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const CDR_HEADERS = [
  "id","startTime","endTime","billsec","direction","disposition",
  "callerNumber","destinationNumber","coinsUsed","userId","callType",
];

function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function cdrToCsvRow(c: any): string {
  return [
    c._id ?? c.id,
    c.startedAt ? new Date(c.startedAt).toISOString() : "",
    c.endedAt   ? new Date(c.endedAt).toISOString()   : "",
    c.billsec   ?? 0,
    c.direction ?? "",
    c.disposition ?? "",
    c.callerIdNumber ?? c.callerNumber ?? "",
    c.destinationNumber ?? "",
    c.coinsUsed ?? 0,
    c.userId    ?? "",
    c.callType  ?? "",
  ].map(escapeCsv).join(",");
}

router.get("/cdr/export", requireAuth, async (req: Request, res: Response) => {
  await connectDB();

  const currentUser  = (req as any).user;
  const isAdmin      = currentUser?.isAdmin;
  const requestedUid = typeof req.query.userId === "string" ? req.query.userId : null;

  const userId = isAdmin && requestedUid ? requestedUid : currentUser.id;

  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to   = typeof req.query.to   === "string" ? new Date(req.query.to)   : null;

  const q: any = isAdmin && !requestedUid ? {} : { userId };
  if (from && !isNaN(from.getTime())) q.endedAt = { ...q.endedAt, $gte: from };
  if (to   && !isNaN(to.getTime()))   q.endedAt = { ...q.endedAt, $lte: to };
  if (typeof req.query.direction === "string") q.direction = req.query.direction;
  if (typeof req.query.disposition === "string") q.disposition = req.query.disposition;

  const cdrs = await CdrModel.find(q).sort({ endedAt: -1 }).limit(50_000).lean();

  const filename = `cdr-export-${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  res.write(CDR_HEADERS.join(",") + "\n");
  for (const c of cdrs) {
    res.write(cdrToCsvRow(c) + "\n");
  }
  res.end();
});

export default router;
