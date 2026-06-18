import { Router, type IRouter } from "express";
import { connectDB, UserModel } from "@workspace/db";
import { PLAN_DEFS } from "./adminBilling";

const router: IRouter = Router();

const COIN_VALUE = 0.9;

router.get("/billing/summary", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await connectDB();
  const userId = (req as any).user.id as string;
  const user = await UserModel.findById(userId)
    .select("coins lowBalanceThresholdCoins ratePlanId subscriptionStatus planId subscriptionPlan customMonthlyFee customMinutes customRate monthlyMinutesUsed monthlyMinutesResetAt")
    .lean();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const planId = (user as any).planId ?? "payg";
  const planDef = PLAN_DEFS[planId] ?? PLAN_DEFS["payg"];

  const monthlyFee         = planId === "custom" ? ((user as any).customMonthlyFee ?? 0)    : planDef.monthlyFee;
  const includedMinutes    = planId === "custom" ? ((user as any).customMinutes ?? 0)        : planDef.includedMinutes;
  const ratePerMinute      = planId === "custom" ? ((user as any).customRate    ?? 0.69)     : planDef.ratePerMinute;
  const monthlyMinutesUsed = (user as any).monthlyMinutesUsed ?? 0;
  const minutesRemaining   = Math.max(0, includedMinutes - monthlyMinutesUsed);

  const threshold =
    typeof (user as any).lowBalanceThresholdCoins === "number"
      ? (user as any).lowBalanceThresholdCoins
      : parseInt(process.env.LOW_BALANCE_THRESHOLD_COINS ?? "5", 10);

  const walletBalance = Math.round(((user as any).coins ?? 0) * COIN_VALUE * 100) / 100;

  res.json({
    coins:          (user as any).coins ?? 0,
    walletBalance,
    lowBalanceThresholdCoins: Number.isFinite(threshold) ? threshold : null,
    ratePlanId:     (user as any).ratePlanId ?? null,
    subscriptionStatus:  (user as any).subscriptionStatus ?? "inactive",
    subscriptionPlan:    (user as any).subscriptionPlan ?? "payg",
    planId,
    planName:        planDef.name,
    monthlyFee,
    includedMinutes,
    ratePerMinute,
    monthlyMinutesUsed,
    minutesRemaining,
    monthlyMinutesResetAt: (user as any).monthlyMinutesResetAt ?? null,
  });
});

export default router;
