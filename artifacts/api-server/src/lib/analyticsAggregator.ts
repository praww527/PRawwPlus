/**
 * Analytics Aggregator — Phase 8
 *
 * Provides on-demand aggregation of CDR data for the analytics dashboard.
 * All queries are read-only aggregations on CdrModel.
 *
 * Includes:
 *   - Hourly/daily call volume with answer rate
 *   - Top callers by volume and cost
 *   - Destination analysis (top prefixes)
 *   - Carrier quality metrics (ASR, ACD)
 *   - Revenue over time
 *   - Failed call reasons breakdown
 */

import { connectDB, CdrModel, UserModel } from "@workspace/db";

export interface HourlyBucket {
  hour:          string;
  calls:         number;
  answered:      number;
  failed:        number;
  totalBillsec:  number;
  totalCoins:    number;
  answerRate:    number;
  avgBillsec:    number;
}

export interface DailyBucket {
  date:          string;
  calls:         number;
  answered:      number;
  failed:        number;
  totalBillsec:  number;
  totalCoins:    number;
  answerRate:    number;
}

export interface TopCaller {
  userId:        string;
  displayName:   string;
  extension?:    number;
  callCount:     number;
  totalBillsec:  number;
  totalCoins:    number;
}

export interface DestinationStat {
  prefix:      string;
  callCount:   number;
  totalCoins:  number;
  avgBillsec:  number;
  asr:         number;
}

export interface AnalyticsSummary {
  period:        { from: string; to: string };
  totalCalls:    number;
  answeredCalls: number;
  failedCalls:   number;
  totalBillsec:  number;
  totalCoins:    number;
  overallAsr:    number;
  overallAcd:    number;
  uniqueCallers: number;
}

// ── Hourly call buckets ────────────────────────────────────────────────────────

export async function getHourlyBuckets(fromMs: number, toMs: number): Promise<HourlyBucket[]> {
  await connectDB();

  const agg = await CdrModel.aggregate([
    { $match: { endedAt: { $gte: new Date(fromMs), $lte: new Date(toMs) } } },
    {
      $group: {
        _id: {
          year:  { $year:  "$endedAt" },
          month: { $month: "$endedAt" },
          day:   { $dayOfMonth: "$endedAt" },
          hour:  { $hour:  "$endedAt" },
        },
        calls:        { $sum: 1 },
        answered:     { $sum: { $cond: [{ $eq: ["$disposition", "ANSWERED"] }, 1, 0] } },
        totalBillsec: { $sum: "$billsec" },
        totalCoins:   { $sum: { $ifNull: ["$coinsUsed", 0] } },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 } },
  ]);

  return agg.map((b) => {
    const answered = b.answered ?? 0;
    const calls    = b.calls ?? 1;
    const label    = `${String(b._id.year)}-${String(b._id.month).padStart(2,"0")}-${String(b._id.day).padStart(2,"0")} ${String(b._id.hour).padStart(2,"0")}:00`;
    return {
      hour:         label,
      calls:        b.calls,
      answered,
      failed:       b.calls - answered,
      totalBillsec: b.totalBillsec ?? 0,
      totalCoins:   b.totalCoins ?? 0,
      answerRate:   Math.round((answered / calls) * 100),
      avgBillsec:   answered > 0 ? Math.round((b.totalBillsec ?? 0) / answered) : 0,
    };
  });
}

// ── Daily call buckets ─────────────────────────────────────────────────────────

export async function getDailyBuckets(fromMs: number, toMs: number): Promise<DailyBucket[]> {
  await connectDB();

  const agg = await CdrModel.aggregate([
    { $match: { endedAt: { $gte: new Date(fromMs), $lte: new Date(toMs) } } },
    {
      $group: {
        _id: {
          year:  { $year:  "$endedAt" },
          month: { $month: "$endedAt" },
          day:   { $dayOfMonth: "$endedAt" },
        },
        calls:        { $sum: 1 },
        answered:     { $sum: { $cond: [{ $eq: ["$disposition", "ANSWERED"] }, 1, 0] } },
        totalBillsec: { $sum: "$billsec" },
        totalCoins:   { $sum: { $ifNull: ["$coinsUsed", 0] } },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
  ]);

  return agg.map((b) => {
    const answered = b.answered ?? 0;
    const calls    = b.calls ?? 1;
    const date     = `${b._id.year}-${String(b._id.month).padStart(2,"0")}-${String(b._id.day).padStart(2,"0")}`;
    return {
      date,
      calls:        b.calls,
      answered,
      failed:       b.calls - answered,
      totalBillsec: b.totalBillsec ?? 0,
      totalCoins:   b.totalCoins ?? 0,
      answerRate:   Math.round((answered / calls) * 100),
    };
  });
}

// ── Top callers ────────────────────────────────────────────────────────────────

export async function getTopCallers(fromMs: number, toMs: number, topN = 10): Promise<TopCaller[]> {
  await connectDB();

  const agg = await CdrModel.aggregate([
    { $match: { endedAt: { $gte: new Date(fromMs), $lte: new Date(toMs) }, userId: { $exists: true, $ne: null } } },
    {
      $group: {
        _id:          "$userId",
        callCount:    { $sum: 1 },
        totalBillsec: { $sum: "$billsec" },
        totalCoins:   { $sum: { $ifNull: ["$coinsUsed", 0] } },
      },
    },
    { $sort: { callCount: -1 } },
    { $limit: topN },
  ]);

  const userIds = agg.map((r) => r._id).filter(Boolean);
  const users   = await UserModel.find({ _id: { $in: userIds } })
    .select("_id name username extension")
    .lean();
  const uMap    = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  return agg.map((r) => {
    const u = uMap[r._id] ?? {};
    return {
      userId:       r._id,
      displayName:  (u as any).name ?? (u as any).username ?? r._id,
      extension:    (u as any).extension,
      callCount:    r.callCount,
      totalBillsec: r.totalBillsec ?? 0,
      totalCoins:   r.totalCoins ?? 0,
    };
  });
}

// ── Destination stats ─────────────────────────────────────────────────────────

export async function getDestinationStats(fromMs: number, toMs: number, topN = 20): Promise<DestinationStat[]> {
  await connectDB();

  const agg = await CdrModel.aggregate([
    { $match: { endedAt: { $gte: new Date(fromMs), $lte: new Date(toMs) } } },
    {
      $addFields: {
        prefix: { $substr: [{ $ifNull: ["$destinationNumber", ""] }, 0, 4] },
      },
    },
    {
      $group: {
        _id:          "$prefix",
        callCount:    { $sum: 1 },
        answered:     { $sum: { $cond: [{ $eq: ["$disposition", "ANSWERED"] }, 1, 0] } },
        totalCoins:   { $sum: { $ifNull: ["$coinsUsed", 0] } },
        totalBillsec: { $sum: "$billsec" },
      },
    },
    { $sort: { callCount: -1 } },
    { $limit: topN },
  ]);

  return agg.map((r) => ({
    prefix:      r._id ?? "unknown",
    callCount:   r.callCount,
    totalCoins:  r.totalCoins ?? 0,
    avgBillsec:  r.answered > 0 ? Math.round((r.totalBillsec ?? 0) / r.answered) : 0,
    asr:         Math.round(((r.answered ?? 0) / Math.max(r.callCount, 1)) * 100),
  }));
}

// ── Summary ───────────────────────────────────────────────────────────────────

export async function getAnalyticsSummary(fromMs: number, toMs: number): Promise<AnalyticsSummary> {
  await connectDB();

  const [agg, uniqueCallers] = await Promise.all([
    CdrModel.aggregate([
      { $match: { endedAt: { $gte: new Date(fromMs), $lte: new Date(toMs) } } },
      {
        $group: {
          _id:          null,
          totalCalls:   { $sum: 1 },
          answered:     { $sum: { $cond: [{ $eq: ["$disposition", "ANSWERED"] }, 1, 0] } },
          totalBillsec: { $sum: "$billsec" },
          totalCoins:   { $sum: { $ifNull: ["$coinsUsed", 0] } },
        },
      },
    ]),
    CdrModel.distinct("userId", { endedAt: { $gte: new Date(fromMs), $lte: new Date(toMs) } }),
  ]);

  const r = agg[0] ?? { totalCalls: 0, answered: 0, totalBillsec: 0, totalCoins: 0 };

  return {
    period:        { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
    totalCalls:    r.totalCalls,
    answeredCalls: r.answered,
    failedCalls:   r.totalCalls - r.answered,
    totalBillsec:  r.totalBillsec ?? 0,
    totalCoins:    r.totalCoins ?? 0,
    overallAsr:    r.totalCalls > 0 ? Math.round((r.answered / r.totalCalls) * 100) : 0,
    overallAcd:    r.answered > 0 ? Math.round((r.totalBillsec ?? 0) / r.answered) : 0,
    uniqueCallers: uniqueCallers.length,
  };
}
