import { Router, type IRouter } from "express";
import { connectDB, UserModel, EarningModel, PayoutModel } from "@workspace/db";
import { parsePageLimit } from "../lib/pagination";

const router: IRouter = Router();

function requireReseller(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = req.user;
  if (user.role !== "reseller" && !user.isAdmin) {
    res.status(403).json({ error: "Reseller access required" });
    return;
  }
  if (!user.approved) {
    res.status(403).json({ error: "Your reseller account is pending approval." });
    return;
  }
  if (user.locked) {
    res.status(403).json({ error: "Your account is locked. Contact support." });
    return;
  }
  next();
}

router.get("/reseller/stats", requireReseller, async (req, res) => {
  await connectDB();
  const resellerId = (req as any).user.id;

  const [
    totalEarningsAgg,
    pendingEarningsAgg,
    paidEarningsAgg,
    totalReferrals,
    recentEarnings,
    pendingPayoutsAgg,
    paidPayoutsAgg,
  ] = await Promise.all([
    EarningModel.aggregate([
      { $match: { resellerId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    EarningModel.aggregate([
      { $match: { resellerId, status: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    EarningModel.aggregate([
      { $match: { resellerId, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    UserModel.countDocuments({ referredBy: resellerId }),
    EarningModel.find({ resellerId }).sort({ createdAt: -1 }).limit(5).lean(),
    PayoutModel.aggregate([
      { $match: { resellerId, status: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    PayoutModel.aggregate([
      { $match: { resellerId, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const reseller = await UserModel.findById(resellerId)
    .select("name username email referralCode referredBy")
    .lean();

  res.json({
    totalEarnings: totalEarningsAgg[0]?.total ?? 0,
    pendingEarnings: pendingEarningsAgg[0]?.total ?? 0,
    paidEarnings: paidEarningsAgg[0]?.total ?? 0,
    totalReferrals,
    recentEarnings: recentEarnings.map((e) => ({ ...e, id: e._id })),
    pendingPayouts: pendingPayoutsAgg[0]?.total ?? 0,
    paidPayouts: paidPayoutsAgg[0]?.total ?? 0,
    referralCode: reseller?.referralCode ?? null,
  });
});

router.get("/reseller/earnings", requireReseller, async (req, res) => {
  await connectDB();
  const resellerId = (req as any).user.id;
  const { page, limit, skip } = parsePageLimit(req.query);

  const [earnings, total] = await Promise.all([
    EarningModel.find({ resellerId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    EarningModel.countDocuments({ resellerId }),
  ]);

  const userIds = [...new Set(earnings.map((e) => e.userId))];
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name username email")
    .lean();
  const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  res.json({
    earnings: earnings.map((e) => ({
      ...e,
      id: e._id,
      user: userMap[e.userId] ?? null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.get("/reseller/referrals", requireReseller, async (req, res) => {
  await connectDB();
  const resellerId = (req as any).user.id;
  const { page, limit, skip } = parsePageLimit(req.query);

  const [referredUsers, total] = await Promise.all([
    UserModel.find({ referredBy: resellerId })
      .select("name username email createdAt subscriptionStatus")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserModel.countDocuments({ referredBy: resellerId }),
  ]);

  const userIds = referredUsers.map((u) => String(u._id));
  const earningsPerUser = await EarningModel.aggregate([
    { $match: { resellerId, userId: { $in: userIds } } },
    { $group: { _id: "$userId", total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const earningsMap = Object.fromEntries(
    earningsPerUser.map((e) => [e._id, { total: e.total, count: e.count }])
  );

  res.json({
    referrals: referredUsers.map((u) => ({
      ...u,
      id: u._id,
      earnings: earningsMap[String(u._id)] ?? { total: 0, count: 0 },
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.get("/reseller/payouts", requireReseller, async (req, res) => {
  await connectDB();
  const resellerId = (req as any).user.id;
  const payouts = await PayoutModel.find({ resellerId }).sort({ createdAt: -1 }).lean();
  res.json({ payouts: payouts.map((p) => ({ ...p, id: p._id })) });
});

export default router;
