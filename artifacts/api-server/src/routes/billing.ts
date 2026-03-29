import { Router, type IRouter } from "express";
import { connectDB, UserModel } from "@workspace/db";

const router: IRouter = Router();

router.get("/billing/summary", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await connectDB();
  const userId = (req as any).user.id as string;
  const user = await UserModel.findById(userId)
    .select("coins lowBalanceThresholdCoins ratePlanId subscriptionStatus subscriptionPlan")
    .lean();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const threshold =
    typeof user.lowBalanceThresholdCoins === "number"
      ? user.lowBalanceThresholdCoins
      : parseInt(process.env.LOW_BALANCE_THRESHOLD_COINS ?? "5", 10);

  res.json({
    coins: user.coins ?? 0,
    lowBalanceThresholdCoins: Number.isFinite(threshold) ? threshold : null,
    ratePlanId: user.ratePlanId ?? null,
    subscriptionStatus: user.subscriptionStatus ?? "inactive",
    subscriptionPlan: user.subscriptionPlan ?? "basic",
  });
});

export default router;
