/**
 * Balance Guard — Phase 3
 *
 * Pre-call balance enforcement. Checks user coins before allowing a call to
 * proceed and provides helpers for credit limit management.
 *
 * The guard is called by callOrchestrator.ts during call initiation.
 */

import { connectDB, UserModel } from "@workspace/db";
import { resolveCoinsPerMinuteForUser } from "./rating";
import { logger } from "./logger";
import { metrics } from "./metrics";

export interface BalanceCheckResult {
  allowed:          boolean;
  coins:            number;
  coinsPerMinute:   number;
  maxBillsec:       number;
  rejectionReason?: "insufficient_funds" | "account_locked" | "account_suspended" | "zero_rate_plan";
}

const MIN_COINS_TO_CALL = parseFloat(process.env.MIN_COINS_TO_CALL ?? "1");
const ABSOLUTE_MAX_BILLSEC = 86_400;

/**
 * Check whether a user has sufficient balance to place/receive a call.
 * Returns allowed=false with a reason when the call should be blocked.
 */
export async function checkBalance(userId: string, destination: string): Promise<BalanceCheckResult> {
  await connectDB();

  const user = await UserModel.findById(userId)
    .select("coins locked subscriptionStatus approved")
    .lean();

  if (!user) {
    return { allowed: false, coins: 0, coinsPerMinute: 0, maxBillsec: 0, rejectionReason: "account_locked" };
  }

  if (user.locked) {
    return { allowed: false, coins: user.coins, coinsPerMinute: 0, maxBillsec: 0, rejectionReason: "account_locked" };
  }

  if (!user.approved) {
    return { allowed: false, coins: user.coins, coinsPerMinute: 0, maxBillsec: 0, rejectionReason: "account_suspended" };
  }

  const coinsPerMinute = await resolveCoinsPerMinuteForUser(userId, destination);

  if (coinsPerMinute > 0 && user.coins < MIN_COINS_TO_CALL) {
    logger.info({ userId, coins: user.coins, coinsPerMinute, destination }, "[balanceGuard] Insufficient funds");
    metrics.callsFailed++;
    return {
      allowed: false,
      coins: user.coins,
      coinsPerMinute,
      maxBillsec: 0,
      rejectionReason: "insufficient_funds",
    };
  }

  const maxBillsec = coinsPerMinute > 0
    ? Math.min(ABSOLUTE_MAX_BILLSEC, Math.floor((user.coins / coinsPerMinute) * 60))
    : ABSOLUTE_MAX_BILLSEC;

  return {
    allowed:        true,
    coins:          user.coins,
    coinsPerMinute,
    maxBillsec,
  };
}

/**
 * Deduct coins atomically from a user's balance.
 * Returns the new balance or null if the user was not found.
 */
export async function deductCoins(
  userId:     string,
  amount:     number,
  sourceRef?: string,
): Promise<{ newBalance: number; success: boolean }> {
  await connectDB();

  if (amount <= 0) return { newBalance: 0, success: false };

  const user = await UserModel.findByIdAndUpdate(
    userId,
    {
      $inc: { coins: -amount, totalCoinsUsed: amount },
    },
    { new: true, select: "coins" },
  ).lean();

  if (!user) {
    logger.error({ userId, amount }, "[balanceGuard] deductCoins: user not found");
    return { newBalance: 0, success: false };
  }

  logger.debug({ userId, amount, newBalance: (user as any).coins, sourceRef }, "[balanceGuard] Coins deducted");
  return { newBalance: (user as any).coins, success: true };
}

/**
 * Add coins to a user's balance (top-up / admin credit).
 */
export async function addCoins(
  userId:  string,
  amount:  number,
  reason?: string,
): Promise<{ newBalance: number; success: boolean }> {
  await connectDB();

  if (amount <= 0) return { newBalance: 0, success: false };

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $inc: { coins: amount } },
    { new: true, select: "coins" },
  ).lean();

  if (!user) return { newBalance: 0, success: false };

  logger.info({ userId, amount, newBalance: (user as any).coins, reason }, "[balanceGuard] Coins added");
  return { newBalance: (user as any).coins, success: true };
}

/**
 * Bulk low-balance check: returns all users below their threshold.
 * Used by the invoice cron to send alerts.
 */
export async function getUsersBelowThreshold(): Promise<Array<{ userId: string; coins: number; threshold: number; email?: string; expoPushToken?: string; fcmToken?: string }>> {
  await connectDB();

  const DEFAULT_THRESHOLD = parseInt(process.env.LOW_BALANCE_THRESHOLD_COINS ?? "5", 10);

  const users = await UserModel.find({ approved: true, locked: false })
    .select("_id coins lowBalanceThresholdCoins email expoPushToken fcmToken")
    .lean();

  return users
    .filter((u) => {
      const threshold = (u as any).lowBalanceThresholdCoins ?? DEFAULT_THRESHOLD;
      return (u as any).coins <= threshold;
    })
    .map((u) => ({
      userId:        String((u as any)._id),
      coins:         (u as any).coins,
      threshold:     (u as any).lowBalanceThresholdCoins ?? DEFAULT_THRESHOLD,
      email:         (u as any).email,
      expoPushToken: (u as any).expoPushToken,
      fcmToken:      (u as any).fcmToken,
    }));
}
