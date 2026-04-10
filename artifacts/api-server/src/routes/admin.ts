import { Router, type IRouter } from "express";
import { connectDB, UserModel, CallModel, PaymentModel } from "@workspace/db";
import { pushFreeSwitchConfig, testSSHConnection } from "../lib/freeswitchSSH";
import { xmlCurlConf, vertoConf, dialplanXml, eventSocketConf } from "../lib/freeswitchConfig";
import { eslStatus } from "../lib/freeswitchESL";
import { getAppUrl } from "../lib/appUrl";
import { parsePageLimit } from "../lib/pagination";

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Forbidden", message: "Admin access required" });
    return;
  }
  next();
}

router.get("/admin/stats", requireAdmin, async (req, res) => {
  await connectDB();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    totalUsers,
    activeSubscriptions,
    totalCalls,
    totalMinutesAgg,
    totalRevenueAgg,
    callsToday,
    newUsersThisMonth,
    recentPayments,
  ] = await Promise.all([
    UserModel.countDocuments(),
    UserModel.countDocuments({ subscriptionStatus: "active" }),
    CallModel.countDocuments(),
    CallModel.aggregate([{ $group: { _id: null, total: { $sum: "$duration" } } }]),
    PaymentModel.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    CallModel.countDocuments({ createdAt: { $gte: today } }),
    UserModel.countDocuments({ createdAt: { $gte: monthStart } }),
    PaymentModel.find({ status: "completed" }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  res.json({
    totalUsers,
    activeSubscriptions,
    totalCalls,
    totalCallMinutes: Math.floor((totalMinutesAgg[0]?.total ?? 0) / 60),
    totalRevenue: totalRevenueAgg[0]?.total ?? 0,
    callsToday,
    newUsersThisMonth,
    recentPayments: recentPayments.map((p) => ({ ...p, id: p._id })),
  });
});

router.get("/admin/users", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);

  const [users, total] = await Promise.all([
    UserModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    UserModel.countDocuments(),
  ]);

  res.json({
    users: users.map((u) => ({ ...u, id: u._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.get("/admin/users/:userId", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId).lean();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const [recentCalls, recentPayments] = await Promise.all([
    CallModel.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
    PaymentModel.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  res.json({
    user: { ...user, id: user._id },
    recentCalls: recentCalls.map((c) => ({ ...c, id: c._id })),
    recentPayments: recentPayments.map((p) => ({ ...p, id: p._id })),
  });
});

router.post("/admin/users/:userId/verify-email", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  user.emailVerified = true;
  user.verificationToken = undefined;
  user.verificationTokenExpiry = undefined;
  await user.save();
  res.json({ message: "Email verified successfully", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/adjust-credit", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const { amount } = req.body;
  if (amount === undefined) {
    res.status(400).json({ error: "amount is required" });
    return;
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  user.coins = Math.max(0, user.coins + Number(amount));
  await user.save();

  res.json({ ...user.toObject(), id: user._id });
});

router.get("/admin/calls", requireAdmin, async (req, res) => {
  await connectDB();
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"))));
  const skip = (page - 1) * limit;
  const filterUserId = req.query.userId as string | undefined;

  const query = filterUserId ? { userId: filterUserId } : {};

  const [callDocs, total] = await Promise.all([
    CallModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CallModel.countDocuments(query),
  ]);

  const userIds = [...new Set(callDocs.map((c) => c.userId))];
  const users = await UserModel.find({ _id: { $in: userIds } }).lean();
  const userMap = Object.fromEntries(users.map((u) => [u._id, u.username]));

  const calls = callDocs.map((c) => ({
    ...c,
    id: c._id,
    username: userMap[c.userId] ?? null,
  }));

  res.json({ calls, total, page, limit, totalPages: Math.ceil(total / limit) });
});


router.get("/admin/freeswitch/status", requireAdmin, async (_req, res) => {
  const esl = eslStatus();
  const hasSshKey = Boolean(process.env.FREESWITCH_SSH_KEY);
  const hasHost   = Boolean(process.env.FREESWITCH_DOMAIN);
  res.json({
    host:      process.env.FREESWITCH_DOMAIN ?? null,
    eslPort:   process.env.FREESWITCH_ESL_PORT ?? "8021",
    eslConnected: esl.connected,
    sshConfigured: hasSshKey,
    configured: hasHost && hasSshKey,
  });
});

router.post("/admin/freeswitch/push-config", requireAdmin, async (_req, res) => {
  const result = await pushFreeSwitchConfig();
  res.json(result);
});

router.post("/admin/freeswitch/test-ssh", requireAdmin, async (_req, res) => {
  const result = await testSSHConnection();
  res.json(result);
});

router.get("/admin/freeswitch/config-preview", requireAdmin, (_req, res) => {
  const fsHost = process.env.FREESWITCH_DOMAIN ?? "YOUR_FREESWITCH_HOST";
  const appUrl = getAppUrl() || "https://rtc.PRaww.co.za";

  res.json({
    "autoload_configs/xml_curl.conf.xml":    xmlCurlConf(appUrl),
    "autoload_configs/verto.conf.xml":        vertoConf(fsHost),
    "autoload_configs/event_socket.conf.xml": eventSocketConf(),
    "dialplan/prawwplus.xml":                 dialplanXml(fsHost),
  });
});

export default router;
