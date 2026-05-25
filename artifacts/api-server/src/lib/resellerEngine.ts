/**
 * Reseller Commission Engine — Phase 7
 *
 * Calculates and records commissions for resellers whenever:
 *   - A referred user makes a payment / top-up
 *   - A referred user completes a billable call
 *   - A referred user subscribes / renews
 *
 * Commission rates are configurable globally via RESELLER_COMMISSION_PCT env var
 * or overridden per-reseller via the reseller's user record (resellerCommissionPct field).
 */

import { randomUUID } from "crypto";
import { connectDB, UserModel } from "@workspace/db";
import { ResellerCommissionModel, type CommissionType } from "@workspace/db";
import { logger } from "./logger";

const DEFAULT_COMMISSION_PCT = parseFloat(process.env.RESELLER_COMMISSION_PCT ?? "10");

export interface CommissionResult {
  recorded:         boolean;
  commissionId?:    string;
  commissionAmount: number;
  ratePercent:      number;
}

/**
 * Record a commission for a reseller when a referred user triggers an event.
 */
export async function recordCommission(
  userId:       string,
  grossAmount:  number,
  type:         CommissionType,
  sourceRef?:   string,
  currency      = "ZAR",
): Promise<CommissionResult> {
  if (grossAmount <= 0) return { recorded: false, commissionAmount: 0, ratePercent: 0 };

  try {
    await connectDB();

    const user = await UserModel.findById(userId)
      .select("referredBy")
      .lean();

    const resellerId = (user as any)?.referredBy;
    if (!resellerId) return { recorded: false, commissionAmount: 0, ratePercent: 0 };

    const reseller = await UserModel.findById(resellerId)
      .select("role approved locked resellerCommissionPct")
      .lean();

    if (!reseller || (reseller as any).role !== "reseller" || !(reseller as any).approved || (reseller as any).locked) {
      return { recorded: false, commissionAmount: 0, ratePercent: 0 };
    }

    const ratePercent = typeof (reseller as any).resellerCommissionPct === "number"
      ? (reseller as any).resellerCommissionPct
      : DEFAULT_COMMISSION_PCT;

    const commissionAmount = parseFloat(((grossAmount * ratePercent) / 100).toFixed(4));
    if (commissionAmount <= 0) return { recorded: false, commissionAmount: 0, ratePercent };

    const doc = await ResellerCommissionModel.create({
      _id:              randomUUID(),
      resellerId,
      userId,
      type,
      sourceRef,
      grossAmount,
      ratePercent,
      commissionAmount,
      currency,
      status:           "pending",
    });

    logger.info({ resellerId, userId, type, grossAmount, commissionAmount, ratePercent }, "[resellerEngine] Commission recorded");

    return { recorded: true, commissionId: doc._id as string, commissionAmount, ratePercent };
  } catch (err) {
    logger.error({ err, userId, type, grossAmount }, "[resellerEngine] recordCommission failed");
    return { recorded: false, commissionAmount: 0, ratePercent: 0 };
  }
}

/**
 * Approve all pending commissions for a reseller (called before payout).
 */
export async function approveCommissions(resellerId: string): Promise<number> {
  await connectDB();
  const result = await ResellerCommissionModel.updateMany(
    { resellerId, status: "pending" },
    { $set: { status: "approved" } },
  );
  logger.info({ resellerId, count: result.modifiedCount }, "[resellerEngine] Commissions approved");
  return result.modifiedCount;
}

/**
 * Mark commissions as paid (called when payout is processed).
 */
export async function markCommissionsPaid(resellerId: string, payoutId: string): Promise<number> {
  await connectDB();
  const result = await ResellerCommissionModel.updateMany(
    { resellerId, status: "approved" },
    { $set: { status: "paid", paidAt: new Date(), payoutId } },
  );
  logger.info({ resellerId, payoutId, count: result.modifiedCount }, "[resellerEngine] Commissions marked paid");
  return result.modifiedCount;
}

/**
 * Get commission summary for a reseller.
 */
export async function getCommissionSummary(resellerId: string): Promise<{
  pendingTotal:  number;
  approvedTotal: number;
  paidTotal:     number;
  totalEarned:   number;
  commissionCount: number;
}> {
  await connectDB();

  const agg = await ResellerCommissionModel.aggregate([
    { $match: { resellerId } },
    {
      $group: {
        _id:           "$status",
        total:         { $sum: "$commissionAmount" },
        count:         { $sum: 1 },
      },
    },
  ]);

  let pendingTotal = 0, approvedTotal = 0, paidTotal = 0, commissionCount = 0;
  for (const row of agg) {
    commissionCount += row.count;
    if (row._id === "pending")  pendingTotal  = row.total;
    if (row._id === "approved") approvedTotal = row.total;
    if (row._id === "paid")     paidTotal     = row.total;
  }

  return { pendingTotal, approvedTotal, paidTotal, totalEarned: pendingTotal + approvedTotal + paidTotal, commissionCount };
}
