import { Router, type IRouter } from "express";
import { connectDB, RatePlanModel, UserModel } from "@workspace/db";

const router: IRouter = Router();

router.get("/rate-plans/current", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await connectDB();
  const userId = (req as any).user.id as string;
  const user = await UserModel.findById(userId).select("ratePlanId").lean();

  const plan = user?.ratePlanId
    ? await RatePlanModel.findById(user.ratePlanId).lean()
    : await RatePlanModel.findOne({ isActive: true }).sort({ updatedAt: -1 }).lean();

  if (!plan) {
    res.status(404).json({ error: "No active rate plan" });
    return;
  }

  res.json({ ...plan, id: plan._id });
});

export default router;
