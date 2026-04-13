import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import {
  connectDB,
  UserModel,
  CallModel,
  PaymentModel,
  EarningModel,
  ExpenseModel,
  PayoutModel,
  AnnouncementModel,
  AbuseFlagModel,
} from "@workspace/db";
import { pushFreeSwitchConfig, testSSHConnection } from "../lib/freeswitchSSH";
import { xmlCurlConf, vertoConf, dialplanXml, eventSocketConf, sipProfileXml } from "../lib/freeswitchConfig";
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

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function makeUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateReferralCode();
    const exists = await UserModel.exists({ referralCode: code });
    if (!exists) return code;
  }
  return randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

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
    totalResellers,
    pendingApprovals,
    lockedUsers,
    totalCommissionsAgg,
    totalExpensesAgg,
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
    UserModel.countDocuments({ role: "reseller" }),
    UserModel.countDocuments({ approved: false }),
    UserModel.countDocuments({ locked: true }),
    EarningModel.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]),
    ExpenseModel.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);

  const totalRevenue = totalRevenueAgg[0]?.total ?? 0;
  const totalCommissions = totalCommissionsAgg[0]?.total ?? 0;
  const totalExpenses = totalExpensesAgg[0]?.total ?? 0;
  const profit = totalRevenue - totalCommissions - totalExpenses;

  res.json({
    totalUsers,
    activeSubscriptions,
    totalCalls,
    totalCallMinutes: Math.floor((totalMinutesAgg[0]?.total ?? 0) / 60),
    totalRevenue,
    callsToday,
    newUsersThisMonth,
    recentPayments: recentPayments.map((p) => ({ ...p, id: p._id })),
    totalResellers,
    pendingApprovals,
    lockedUsers,
    totalCommissions,
    totalExpenses,
    profit,
  });
});

// ── User Management ───────────────────────────────────────────────────────────

router.get("/admin/users", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const roleFilter = req.query.role as string | undefined;
  const query: any = {};
  if (roleFilter) query.role = roleFilter;

  const [users, total] = await Promise.all([
    UserModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    UserModel.countDocuments(query),
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
  const [recentCalls, recentPayments, earnings] = await Promise.all([
    CallModel.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
    PaymentModel.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
    EarningModel.find({ resellerId: userId }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  res.json({
    user: { ...user, id: user._id },
    recentCalls: recentCalls.map((c) => ({ ...c, id: c._id })),
    recentPayments: recentPayments.map((p) => ({ ...p, id: p._id })),
    earnings: earnings.map((e) => ({ ...e, id: e._id })),
  });
});

router.post("/admin/users/:userId/approve", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.approved = true;
  await user.save();
  res.json({ message: "User approved", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/reject", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.approved = false;
  await user.save();
  res.json({ message: "User rejected", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/lock", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.locked = true;
  await user.save();
  res.json({ message: "User locked", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/unlock", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.locked = false;
  await user.save();
  res.json({ message: "User unlocked", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/unlock-otp", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.phoneOtpLockedUntil = undefined;
  user.phoneOtpAttempts = 0;
  user.phoneOtp = undefined;
  user.phoneOtpExpiry = undefined;
  await user.save();
  res.json({ message: "OTP lockout cleared", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/set-role", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const { role } = req.body;
  if (!["admin", "reseller", "user"].includes(role)) {
    res.status(400).json({ error: "Invalid role. Must be admin, reseller, or user." });
    return;
  }
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  user.role = role;
  user.isAdmin = role === "admin";

  if (role === "reseller" && !user.referralCode) {
    user.referralCode = await makeUniqueReferralCode();
  }

  await user.save();
  res.json({ message: `Role set to ${role}`, user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/verify-email", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
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
  if (amount === undefined) { res.status(400).json({ error: "amount is required" }); return; }
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.coins = Math.max(0, user.coins + Number(amount));
  await user.save();
  res.json({ ...user.toObject(), id: user._id });
});

// ── Referrals ─────────────────────────────────────────────────────────────────

router.get("/admin/referrals", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);

  const [referredUsers, total] = await Promise.all([
    UserModel.find({ referredBy: { $exists: true, $ne: null } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserModel.countDocuments({ referredBy: { $exists: true, $ne: null } }),
  ]);

  const resellerIds = [...new Set(referredUsers.map((u) => u.referredBy).filter(Boolean))];
  const resellers = await UserModel.find({ _id: { $in: resellerIds } })
    .select("name username email referralCode")
    .lean();
  const resellerMap = Object.fromEntries(resellers.map((r) => [String(r._id), r]));

  res.json({
    referrals: referredUsers.map((u) => ({
      ...u,
      id: u._id,
      reseller: resellerMap[u.referredBy as string] ?? null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// ── Earnings (Commissions) ────────────────────────────────────────────────────

router.get("/admin/earnings", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const resellerFilter = req.query.resellerId as string | undefined;
  const query: any = {};
  if (resellerFilter) query.resellerId = resellerFilter;

  const [earnings, total] = await Promise.all([
    EarningModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    EarningModel.countDocuments(query),
  ]);

  const userIds = [...new Set([
    ...earnings.map((e) => e.resellerId),
    ...earnings.map((e) => e.userId),
  ])];
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name username email")
    .lean();
  const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  res.json({
    earnings: earnings.map((e) => ({
      ...e,
      id: e._id,
      reseller: userMap[e.resellerId] ?? null,
      user: userMap[e.userId] ?? null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/earnings/:earningId/mark-paid", requireAdmin, async (req, res) => {
  await connectDB();
  const { earningId } = req.params;
  const earning = await EarningModel.findById(earningId);
  if (!earning) { res.status(404).json({ error: "Earning not found" }); return; }
  earning.status = "paid";
  await earning.save();
  res.json({ message: "Earning marked as paid", earning: { ...earning.toObject(), id: earning._id } });
});

// ── Expenses ──────────────────────────────────────────────────────────────────

router.get("/admin/expenses", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const [expenses, total] = await Promise.all([
    ExpenseModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ExpenseModel.countDocuments(),
  ]);
  res.json({
    expenses: expenses.map((e) => ({ ...e, id: e._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/expenses", requireAdmin, async (req, res) => {
  await connectDB();
  const { type, amount, description } = req.body;
  if (!type || !amount || !description) {
    res.status(400).json({ error: "type, amount, and description are required" });
    return;
  }
  const allowed = ["sms", "server", "api", "infrastructure", "other"];
  if (!allowed.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${allowed.join(", ")}` });
    return;
  }
  const expense = await ExpenseModel.create({
    _id: randomUUID(),
    type,
    amount: Number(amount),
    description,
  });
  res.status(201).json({ ...expense.toObject(), id: expense._id });
});

router.delete("/admin/expenses/:expenseId", requireAdmin, async (req, res) => {
  await connectDB();
  const { expenseId } = req.params;
  const deleted = await ExpenseModel.findByIdAndDelete(expenseId);
  if (!deleted) { res.status(404).json({ error: "Expense not found" }); return; }
  res.json({ message: "Expense deleted" });
});

// ── Payouts ───────────────────────────────────────────────────────────────────

router.get("/admin/payouts", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const statusFilter = req.query.status as string | undefined;
  const query: any = {};
  if (statusFilter) query.status = statusFilter;

  const [payouts, total] = await Promise.all([
    PayoutModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PayoutModel.countDocuments(query),
  ]);

  const resellerIds = [...new Set(payouts.map((p) => p.resellerId))];
  const resellers = await UserModel.find({ _id: { $in: resellerIds } })
    .select("name username email")
    .lean();
  const resellerMap = Object.fromEntries(resellers.map((r) => [String(r._id), r]));

  res.json({
    payouts: payouts.map((p) => ({
      ...p,
      id: p._id,
      reseller: resellerMap[p.resellerId] ?? null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/payouts", requireAdmin, async (req, res) => {
  await connectDB();
  const { resellerId, amount, notes } = req.body;
  if (!resellerId || !amount) {
    res.status(400).json({ error: "resellerId and amount are required" });
    return;
  }
  const reseller = await UserModel.findById(resellerId);
  if (!reseller || reseller.role !== "reseller") {
    res.status(400).json({ error: "Reseller not found" });
    return;
  }
  const payout = await PayoutModel.create({
    _id: randomUUID(),
    resellerId,
    amount: Number(amount),
    status: "pending",
    notes: notes || undefined,
  });
  res.status(201).json({ ...payout.toObject(), id: payout._id });
});

router.post("/admin/payouts/:payoutId/mark-paid", requireAdmin, async (req, res) => {
  await connectDB();
  const { payoutId } = req.params;
  const payout = await PayoutModel.findById(payoutId);
  if (!payout) { res.status(404).json({ error: "Payout not found" }); return; }
  payout.status = "paid";
  payout.paidAt = new Date();
  await payout.save();
  res.json({ message: "Payout marked as paid", payout: { ...payout.toObject(), id: payout._id } });
});

// ── Calls / FreeSwitch ────────────────────────────────────────────────────────

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
    "sip_profiles/prawwplus_mobile.xml":      sipProfileXml(fsHost, appUrl),
    "dialplan/prawwplus.xml":                 dialplanXml(fsHost),
  });
});

// ── Call Statistics (per-user) ────────────────────────────────────────────────

router.get("/admin/call-stats", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);

  const statsByUser = await CallModel.aggregate([
    {
      $group: {
        _id: "$userId",
        totalCalls: { $sum: 1 },
        totalDuration: { $sum: "$duration" },
        failedCalls: {
          $sum: { $cond: [{ $in: ["$status", ["failed", "cancelled", "busy", "no-answer"]] }, 1, 0] },
        },
      },
    },
    { $sort: { totalCalls: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);

  const total = (await CallModel.aggregate([{ $group: { _id: "$userId" } }, { $count: "n" }]))[0]?.n ?? 0;

  const userIds = statsByUser.map((s) => s._id);
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name username email locked")
    .lean();
  const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  res.json({
    stats: statsByUser.map((s) => {
      const avgDuration = s.totalCalls > 0 ? Math.round(s.totalDuration / s.totalCalls) : 0;
      const failedRate = s.totalCalls > 0 ? parseFloat(((s.failedCalls / s.totalCalls) * 100).toFixed(1)) : 0;
      const user = userMap[s._id];
      const suspicious = failedRate > 50 || s.totalCalls > 500;
      return {
        userId: s._id,
        totalCalls: s.totalCalls,
        totalDuration: s.totalDuration,
        avgDuration,
        failedCalls: s.failedCalls,
        failedRate,
        suspicious,
        user: user ? { name: user.name, username: user.username, email: user.email, locked: user.locked } : null,
      };
    }),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// ── Abuse Flags ───────────────────────────────────────────────────────────────

router.get("/admin/abuse-flags", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const resolvedFilter = req.query.resolved;
  const query: any = {};
  if (resolvedFilter === "true") query.resolvedAt = { $exists: true, $ne: null };
  if (resolvedFilter === "false") query.resolvedAt = { $exists: false };

  const [flags, total] = await Promise.all([
    AbuseFlagModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AbuseFlagModel.countDocuments(query),
  ]);

  const userIds = [...new Set(flags.map((f) => f.userId))];
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name username email locked approved")
    .lean();
  const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  res.json({
    flags: flags.map((f) => ({
      ...f,
      id: f._id,
      user: userMap[f.userId] ?? null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/abuse-flags", requireAdmin, async (req, res) => {
  await connectDB();
  const adminId = (req as any).user.id;
  const { userId, reason, severity, notes } = req.body;

  if (!userId || !reason) {
    res.status(400).json({ error: "userId and reason are required" });
    return;
  }

  const user = await UserModel.findById(userId).lean();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const flag = await AbuseFlagModel.create({
    _id: randomUUID(),
    userId,
    reason: String(reason).slice(0, 500),
    severity: ["low", "medium", "high"].includes(severity) ? severity : "medium",
    notes: notes ? String(notes).slice(0, 1000) : undefined,
    flaggedBy: adminId,
  });

  res.status(201).json({ ...flag.toObject(), id: flag._id });
});

router.delete("/admin/abuse-flags/:flagId", requireAdmin, async (req, res) => {
  await connectDB();
  const { flagId } = req.params;
  const deleted = await AbuseFlagModel.findByIdAndDelete(flagId);
  if (!deleted) { res.status(404).json({ error: "Flag not found" }); return; }
  res.json({ message: "Flag removed" });
});

router.post("/admin/abuse-flags/:flagId/resolve", requireAdmin, async (req, res) => {
  await connectDB();
  const { flagId } = req.params;
  const flag = await AbuseFlagModel.findById(flagId);
  if (!flag) { res.status(404).json({ error: "Flag not found" }); return; }
  flag.resolvedAt = new Date();
  await flag.save();
  res.json({ message: "Flag resolved", flag: { ...flag.toObject(), id: flag._id } });
});

// ── Announcements (admin CRUD) ────────────────────────────────────────────────

router.get("/admin/announcements", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);

  const [announcements, total] = await Promise.all([
    AnnouncementModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AnnouncementModel.countDocuments(),
  ]);

  const creatorIds = [...new Set(announcements.map((a) => a.createdBy))];
  const creators = await UserModel.find({ _id: { $in: creatorIds } })
    .select("name username")
    .lean();
  const creatorMap = Object.fromEntries(creators.map((u) => [String(u._id), u]));

  res.json({
    announcements: announcements.map((a) => ({
      ...a,
      id: a._id,
      creator: creatorMap[a.createdBy] ?? null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/announcements", requireAdmin, async (req, res) => {
  await connectDB();
  const adminId = (req as any).user.id;
  const { title, message, type, target, isActive, expiresAt } = req.body;

  if (!title || !message) {
    res.status(400).json({ error: "title and message are required" });
    return;
  }

  const validTypes = ["info", "warning", "promo"];
  const validTargets = ["all", "resellers", "users"];

  const announcement = await AnnouncementModel.create({
    _id: randomUUID(),
    title: String(title).slice(0, 200),
    message: String(message).slice(0, 2000),
    type: validTypes.includes(type) ? type : "info",
    target: validTargets.includes(target) ? target : "all",
    isActive: isActive !== false,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    createdBy: adminId,
  });

  res.status(201).json({ ...announcement.toObject(), id: announcement._id });
});

router.put("/admin/announcements/:announcementId", requireAdmin, async (req, res) => {
  await connectDB();
  const { announcementId } = req.params;
  const { title, message, type, target, isActive, expiresAt } = req.body;

  const announcement = await AnnouncementModel.findById(announcementId);
  if (!announcement) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }

  const validTypes = ["info", "warning", "promo"];
  const validTargets = ["all", "resellers", "users"];

  if (title !== undefined) announcement.title = String(title).slice(0, 200);
  if (message !== undefined) announcement.message = String(message).slice(0, 2000);
  if (type !== undefined && validTypes.includes(type)) announcement.type = type;
  if (target !== undefined && validTargets.includes(target)) announcement.target = target;
  if (isActive !== undefined) announcement.isActive = Boolean(isActive);
  if (expiresAt !== undefined) announcement.expiresAt = expiresAt ? new Date(expiresAt) : undefined;

  await announcement.save();
  res.json({ ...announcement.toObject(), id: announcement._id });
});

router.delete("/admin/announcements/:announcementId", requireAdmin, async (req, res) => {
  await connectDB();
  const { announcementId } = req.params;
  const deleted = await AnnouncementModel.findByIdAndDelete(announcementId);
  if (!deleted) { res.status(404).json({ error: "Announcement not found" }); return; }
  res.json({ message: "Announcement deleted" });
});

export default router;
