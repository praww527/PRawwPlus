import { Router, type IRouter } from "express";
import { randomUUID, randomBytes } from "crypto";
import { getRecentErrors, clearErrorStore } from "../lib/errorStore";
import {
  connectDB,
  UserModel,
  CallModel,
  CdrModel,
  PaymentModel,
  EarningModel,
  ExpenseModel,
  PayoutModel,
  AnnouncementModel,
  AbuseFlagModel,
  SessionModel,
  AuditLogModel,
  SystemConfigModel,
} from "@workspace/db";
import { pushFreeSwitchConfig, testSSHConnection } from "../lib/freeswitchSSH";
import { xmlCurlConf, vertoConf, dialplanXml, eventSocketConf, sipProfileXml } from "../lib/freeswitchConfig";
import { eslStatus, sendEslApiCommand, getLastEslEvent, getEslTrace } from "../lib/freeswitchESL";
import { sendAdminPush, sendWebPushToSubscription } from "../lib/push";
import { getAppUrl } from "../lib/appUrl";
import { parsePageLimit } from "../lib/pagination";
import { logger } from "../lib/logger";
import { logAdminAction } from "../lib/auditLogger";

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
  const charCount = chars.length; // 32 — power of 2, zero modulo bias
  const buf = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[buf[i] % charCount];
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
    recentPayments: recentPayments.map((p: any) => ({ ...p, id: p._id })),
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
    users: users.map((u: any) => ({ ...u, id: u._id })),
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
    recentCalls: recentCalls.map((c: any) => ({ ...c, id: c._id })),
    recentPayments: recentPayments.map((p: any) => ({ ...p, id: p._id })),
    earnings: earnings.map((e: any) => ({ ...e, id: e._id })),
  });
});

// Force-terminate all active sessions for a user (admin action)
router.delete("/admin/users/:userId/sessions", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  let deleted = 0;
  try {
    const result = await SessionModel.deleteMany({ "sess.user.id": userId } as any);
    deleted = result.deletedCount ?? 0;
  } catch (err) {
    res.status(500).json({ error: "Failed to delete sessions" });
    return;
  }

  try {
    const admin = req.user as any;
    const { AuditLog } = await import("../models/AuditLog");
    await AuditLog.create({
      action: "FORCE_LOGOUT",
      adminId: admin?._id ?? admin?.id,
      adminEmail: admin?.email,
      targetId: userId,
      targetLabel: user.email,
      details: { sessionsDeleted: deleted },
      ip: req.ip,
    });
  } catch { /* audit log is best-effort */ }

  res.json({ ok: true, sessionsDeleted: deleted });
});

router.post("/admin/users/:userId/approve", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.approved = true;
  await user.save();
  try {
    const sessions = await SessionModel.find({ "sess.user.id": userId } as any);
    for (const session of sessions) {
      const sess = session.sess as any;
      if (sess?.user) { sess.user.approved = true; session.markModified("sess"); await session.save(); }
    }
  } catch { /* non-critical — user will see new access on next login if this fails */ }
  res.json({ message: "User approved", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/reject", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.approved = false;
  await user.save();
  try {
    const sessions = await SessionModel.find({ "sess.user.id": userId } as any);
    for (const session of sessions) {
      const sess = session.sess as any;
      if (sess?.user) { sess.user.approved = false; session.markModified("sess"); await session.save(); }
    }
  } catch { /* non-critical */ }
  res.json({ message: "User rejected", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/lock", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.locked = true;
  await user.save();
  logAdminAction(req, { action: "user.lock", targetType: "user", targetId: userId, targetLabel: user.email ?? user.username ?? userId });
  res.json({ message: "User locked", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/unlock", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.locked = false;
  await user.save();
  logAdminAction(req, { action: "user.unlock", targetType: "user", targetId: userId, targetLabel: user.email ?? user.username ?? userId });
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

  const prevRole = user.role;
  user.role = role;
  user.isAdmin = role === "admin";

  if (role === "reseller" && !user.referralCode) {
    user.referralCode = await makeUniqueReferralCode();
  }

  await user.save();

  // Immediately update all active sessions for this user so role changes
  // take effect without requiring the user to log out and back in.
  try {
    const isAdminRole = role === "admin";
    const sessions = await SessionModel.find({ "sess.user.id": userId } as any);
    for (const session of sessions) {
      const sess = session.sess as any;
      if (sess?.user) {
        sess.user.role = role;
        sess.user.isAdmin = isAdminRole;
        session.markModified("sess");
        await session.save();
      }
    }
  } catch { /* non-critical — user will see new role on next login if this fails */ }

  logAdminAction(req, { action: "user.set-role", targetType: "user", targetId: userId, targetLabel: user.email ?? user.username ?? userId, details: { role, prevRole } });
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
  logAdminAction(req, { action: "user.verify-email", targetType: "user", targetId: userId, targetLabel: user.email ?? userId });
  res.json({ message: "Email verified successfully", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/verify-phone", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (!user.phone) {
    res.status(400).json({ error: "User has no phone number to verify" });
    return;
  }
  user.phoneVerified = true;
  user.phoneOtp = undefined;
  user.phoneOtpExpiry = undefined;
  user.phoneOtpAttempts = 0;
  user.phoneOtpLockedUntil = undefined;
  await user.save();
  logAdminAction(req, { action: "user.verify-phone", targetType: "user", targetId: userId, targetLabel: user.phone ?? userId });
  res.json({ message: "Phone number verified successfully", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/grant-badge", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.verified = true;
  user.verificationStatus = "approved";
  await user.save();
  logAdminAction(req, { action: "user.grant-badge", targetType: "user", targetId: userId, targetLabel: user.email ?? user.username ?? userId });
  res.json({ message: "Verified badge granted", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/reject-badge", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  user.verified = false;
  user.verificationStatus = "rejected";
  await user.save();
  logAdminAction(req, { action: "user.reject-badge", targetType: "user", targetId: userId, targetLabel: user.email ?? user.username ?? userId });
  res.json({ message: "Verification rejected", user: { ...user.toObject(), id: user._id } });
});

router.post("/admin/users/:userId/adjust-credit", requireAdmin, async (req, res) => {
  await connectDB();
  const { userId } = req.params;
  const { amount } = req.body;
  if (amount === undefined || amount === null) {
    res.status(400).json({ error: "amount is required" });
    return;
  }
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    res.status(400).json({ error: "amount must be a finite number" });
    return;
  }
  if (parsed < -100_000 || parsed > 100_000) {
    res.status(400).json({ error: "amount must be between -100,000 and 100,000" });
    return;
  }
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const prevCoins = user.coins;
  user.coins = Math.max(0, user.coins + parsed);
  await user.save();
  logAdminAction(req, { action: "user.adjust-credit", targetType: "user", targetId: userId, targetLabel: user.email ?? user.username ?? userId, details: { adjustment: parsed, prevCoins, newCoins: user.coins } });
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

  const resellerIds = [...new Set(referredUsers.map((u: any) => u.referredBy).filter((id: any): id is string => Boolean(id)))];
  const resellers = await UserModel.find({ _id: { $in: resellerIds } })
    .select("name username email referralCode")
    .lean();
  const resellerMap = Object.fromEntries(resellers.map((r: any) => [String(r._id), r]));

  res.json({
    referrals: referredUsers.map((u: any) => ({
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
    ...earnings.map((e: any) => e.resellerId),
    ...earnings.map((e: any) => e.userId),
  ])];
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name username email")
    .lean();
  const userMap = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  res.json({
    earnings: earnings.map((e: any) => ({
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
    expenses: expenses.map((e: any) => ({ ...e, id: e._id })),
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

  const resellerIds = [...new Set(payouts.map((p: any) => p.resellerId))];
  const resellers = await UserModel.find({ _id: { $in: resellerIds } })
    .select("name username email")
    .lean();
  const resellerMap = Object.fromEntries(resellers.map((r: any) => [String(r._id), r]));

  res.json({
    payouts: payouts.map((p: any) => ({
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

/**
 * GET /api/admin/calls/live
 * Returns all non-terminal calls (initiated | ringing | answered) with joined
 * user info so the frontend can render per-extension FSM traces in real time.
 */
router.get("/admin/calls/live", requireAdmin, async (_req, res) => {
  await connectDB();

  const activeCalls = await CallModel.find({
    status: { $in: ["initiated", "ringing", "answered"] },
  })
    .sort({ createdAt: -1 })
    .lean();

  const userIds = [...new Set(activeCalls.map((c: any) => String(c.userId)).filter(Boolean))];
  const users   = await UserModel.find({ _id: { $in: userIds } })
    .select("username extension phone")
    .lean();
  const userMap = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  const now = Date.now();

  const calls = activeCalls.map((c: any) => {
    const user         = userMap[String(c.userId)] ?? null;
    const fsCallId     = c.fsCallId ?? null;
    const lastEslEntry = fsCallId ? getLastEslEvent(String(fsCallId)) : null;
    const eslTrace     = fsCallId ? getEslTrace(String(fsCallId))     : [];
    const ageMs        = now - new Date(c.createdAt).getTime();
    const lastEslEventAgeMs = lastEslEntry ? now - lastEslEntry.ts : null;

    return {
      id:              String(c._id),
      fsCallId,
      status:          c.status,
      callType:        c.callType ?? "external",
      direction:       (c as any).direction ?? "outbound",
      callerNumber:    c.callerNumber    ?? null,
      recipientNumber: c.recipientNumber ?? null,
      createdAt:       c.createdAt,
      startedAt:       (c as any).startedAt ?? null,
      updatedAt:       c.updatedAt,
      ageMs,
      // ESL diagnostics — populated from in-memory trace, empty if ESL never saw the channel
      lastEslEvent:       lastEslEntry?.event    ?? null,
      lastEslEventAt:     lastEslEntry ? new Date(lastEslEntry.ts).toISOString() : null,
      lastEslEventAgeMs,
      eslTrace:           eslTrace.map((e) => ({ event: e.event, ts: new Date(e.ts).toISOString() })),
      user: user
        ? {
            id:        String(user._id),
            username:  user.username,
            extension: user.extension ?? null,
            phone:     (user as any).phone ?? null,
          }
        : null,
    };
  });

  res.json({ calls, count: calls.length, asOf: new Date().toISOString() });
});

/**
 * POST /api/admin/calls/:id/hangup
 *
 * Force-terminates a call via FreeSWITCH ESL.
 *
 * Steps:
 *  1. Load the call record — must exist and be non-terminal.
 *  2. If the call has an fsCallId, send `uuid_kill <fsCallId> NORMAL_CLEARING`
 *     over ESL so FreeSWITCH tears down the media legs immediately.
 *  3. Mark the DB record as "failed" with failReason "Admin force-hangup" so
 *     it doesn't stay stuck in the active-calls view.
 *  4. Return the updated call doc.
 *
 * ESL disconnected / no fsCallId:
 *  - If ESL is not connected the command cannot be sent; we still update the
 *    DB record and return a warning so the admin knows the FS leg may survive
 *    until FreeSWITCH detects the dead socket.
 */
router.post("/admin/calls/:id/hangup", requireAdmin, async (req, res) => {
  await connectDB();

  const call = await CallModel.findById(req.params.id).exec();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const TERMINAL = ["completed", "failed", "missed", "cancelled"];
  if (TERMINAL.includes(call.status)) {
    res.status(409).json({ error: "Call is already in a terminal state", status: call.status });
    return;
  }

  let eslSent = false;
  let eslWarning: string | null = null;

  // Grace-period check: warn the admin if the call is very young and has had
  // no ESL activity — it may be a legitimately-connecting call rather than a
  // stuck record.  We still proceed with the hangup (admin intent is honoured)
  // but surface the warning so they know.
  const callAgeMs       = Date.now() - new Date(call.createdAt).getTime();
  const lastEslEntry    = call.fsCallId ? getLastEslEvent(String(call.fsCallId)) : null;
  const hasNoEslActivity = lastEslEntry === null;

  if (callAgeMs < 60_000 && hasNoEslActivity && call.status === "initiated") {
    eslWarning =
      `Call is only ${Math.round(callAgeMs / 1000)} s old and has received no FreeSWITCH events yet. ` +
      "It may still be connecting. DB record has been marked failed anyway.";
  }

  if (call.fsCallId) {
    const ok = sendEslApiCommand(`uuid_kill ${call.fsCallId} NORMAL_CLEARING`);
    if (ok) {
      eslSent = true;
    } else {
      const noEslMsg = "ESL not connected — FreeSWITCH leg may still be active. DB record updated.";
      eslWarning = eslWarning ? `${eslWarning} Also: ${noEslMsg}` : noEslMsg;
    }
  } else {
    const noFsMsg = "No fsCallId on record — could not send uuid_kill. DB record updated.";
    eslWarning = eslWarning ? `${eslWarning} Also: ${noFsMsg}` : noFsMsg;
  }

  call.status      = "failed";
  (call as any).failReason   = "Admin force-hangup";
  (call as any).hangupCause  = "NORMAL_CLEARING";
  (call as any).endedAt      = new Date();
  await call.save();

  // Send push notification to the affected user so their device clears any
  // stuck call UI immediately (e.g. an "answered" screen that never ended).
  const callUser = await UserModel.findById(call.userId)
    .select("fcmToken expoPushToken")
    .lean();
  let pushResult: { fcmSent: boolean; expoSent: boolean } = { fcmSent: false, expoSent: false };
  if (callUser) {
    pushResult = await sendAdminPush(
      (callUser as any).fcmToken      ?? null,
      (callUser as any).expoPushToken ?? null,
      "Call Ended by Admin",
      "An administrator has terminated your active call.",
      {
        type:    "call_terminated",
        callId:  String(call._id),
        fsCallId: call.fsCallId ?? "",
      },
    );
  }

  res.json({
    ok:         true,
    eslSent,
    eslWarning,
    pushResult,
    call: {
      id:        String(call._id),
      status:    call.status,
      fsCallId:  call.fsCallId ?? null,
      failReason: (call as any).failReason,
    },
  });
});

/**
 * POST /api/admin/calls/clear-stale
 *
 * Immediately closes all calls that have been stuck in initiated/ringing/answered
 * state for longer than the configured threshold (default: 15 min for
 * initiated/ringing, 26 h for answered — same as the reconciliation worker).
 * Returns the number of records closed.
 */
router.post("/admin/calls/clear-stale", requireAdmin, async (_req, res) => {
  const { runReconciliationCycle } = await import("../lib/reconciliationWorker");
  await runReconciliationCycle();

  await connectDB();
  const cutoffShort = new Date(Date.now() - 15 * 60 * 1000);
  const result = await CallModel.updateMany(
    {
      endedAt: null,
      status:  { $in: ["initiated", "ringing"] },
      createdAt: { $lt: cutoffShort },
    },
    {
      $set: {
        status:     "failed",
        endedAt:    new Date(),
        failReason: "Admin: force-cleared stale call",
        duration:   0,
        cost:       0,
      },
    },
  );
  res.json({ ok: true, cleared: result.modifiedCount });
});

// ── Admin Push Broadcast ───────────────────────────────────────────────────────

/**
 * POST /api/admin/push
 *
 * Send a push notification to one user, all users, or all resellers.
 *
 * Body:
 *   target  — "all" | "resellers" | "users" | { userId: "<mongoId>" }
 *   type    — "update" | "maintenance" | "info" | "admin_message"
 *   title   — notification title (max 200 chars)
 *   body    — notification body  (max 1000 chars)
 *
 * Returns:
 *   { sent, fcmOk, expoOk, skipped, errors }
 */
router.post("/admin/push", requireAdmin, async (req, res) => {
  await connectDB();

  const { target, type = "admin_message", title, body } = req.body;
  if (!title || !body) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }

  const safeTitle = String(title).slice(0, 200);
  const safeBody  = String(body).slice(0, 1000);
  const safeType  = ["update", "maintenance", "info", "admin_message"].includes(type)
    ? type : "admin_message";

  // Resolve target users
  let userQuery: Record<string, any> = {};
  if (target && typeof target === "object" && target.userId) {
    userQuery = { _id: target.userId };
  } else if (target === "resellers") {
    userQuery = { role: "reseller" };
  } else if (target === "users") {
    userQuery = { role: { $nin: ["reseller", "admin"] } };
  }
  // else "all" → empty query matches everyone

  const recipients = await UserModel.find(userQuery)
    .select("fcmToken expoPushToken webPushSubscription")
    .limit(500)
    .lean();

  let sent = 0, fcmOk = 0, expoOk = 0, webPushOk = 0, skipped = 0, errors = 0;

  await Promise.all(
    recipients.map(async (u: any) => {
      const fcmToken         = u.fcmToken         ?? null;
      const expoPushToken    = u.expoPushToken    ?? null;
      const webPushSub       = u.webPushSubscription ?? null;
      const hasAnyChannel    = fcmToken || expoPushToken || webPushSub?.endpoint;

      if (!hasAnyChannel) { skipped++; return; }

      let anySent = false;
      try {
        if (fcmToken || expoPushToken) {
          const result = await sendAdminPush(fcmToken, expoPushToken, safeTitle, safeBody, { type: safeType });
          if (result.fcmSent)  { fcmOk++;  anySent = true; }
          if (result.expoSent) { expoOk++; anySent = true; }
        }
        if (webPushSub?.endpoint) {
          const r = await sendWebPushToSubscription(
            webPushSub as { endpoint: string; keys: { auth: string; p256dh: string } },
            { type: safeType, title: safeTitle, body: safeBody },
            String(u._id),
          );
          if (r.sent) { webPushOk++; anySent = true; }
          if (!r.sent && r.error === "expired") {
            await UserModel.updateOne({ _id: u._id }, { $unset: { webPushSubscription: 1 } });
          }
        }
        if (anySent) sent++;
        else errors++;
      } catch {
        errors++;
      }
    }),
  );

  res.json({
    ok: true,
    recipients: recipients.length,
    sent,
    fcmOk,
    expoOk,
    webPushOk,
    skipped,
    errors,
  });
});

// ── Admin User Notification Diagnostics ───────────────────────────────────────

router.get("/admin/users/:userId/notification-status", requireAdmin, async (req, res) => {
  await connectDB();
  const user = await UserModel.findById(req.params.userId)
    .select("fcmToken expoPushToken webPushSubscription notificationPrefs dnd")
    .lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  res.json({
    hasWebPush:  !!((user as any).webPushSubscription?.endpoint),
    hasFcm:      !!((user as any).fcmToken),
    hasExpo:     !!((user as any).expoPushToken),
    dnd:         !!((user as any).dnd),
    notificationPrefs: (user as any).notificationPrefs ?? {},
    vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  });
});

router.post("/admin/users/:userId/test-push", requireAdmin, async (req, res) => {
  await connectDB();
  const user = await UserModel.findById(req.params.userId)
    .select("fcmToken expoPushToken webPushSubscription")
    .lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const title = "Test Notification";
  const body  = "This is a test push notification from the admin panel.";
  const data  = { type: "admin_test", title, body };
  const uid   = String((user as any)._id);
  const results: Record<string, any> = {};

  const fcmToken      = (user as any).fcmToken      ?? null;
  const expoPushToken = (user as any).expoPushToken ?? null;
  const webSub        = (user as any).webPushSubscription ?? null;

  if (fcmToken || expoPushToken) {
    const r = await sendAdminPush(fcmToken, expoPushToken, title, body, data);
    results.fcm  = r.fcmSent;
    results.expo = r.expoSent;
  }

  if (webSub?.endpoint) {
    const r = await sendWebPushToSubscription(
      webSub as { endpoint: string; keys: { auth: string; p256dh: string } },
      data,
      uid,
    );
    results.webPush = r.sent;
    if (!r.sent && r.error === "expired") {
      await UserModel.updateOne({ _id: uid }, { $unset: { webPushSubscription: 1 } });
      results.webPushNote = "Stale subscription removed automatically";
    } else if (!r.sent) {
      results.webPushError = r.error;
    }
  }

  if (!fcmToken && !expoPushToken && !webSub?.endpoint) {
    res.json({ ok: false, message: "User has no registered push channels", results });
    return;
  }

  res.json({ ok: true, results });
});

router.delete("/admin/users/:userId/web-push-subscription", requireAdmin, async (req, res) => {
  await connectDB();
  await UserModel.updateOne({ _id: req.params.userId }, { $unset: { webPushSubscription: 1 } });
  res.json({ ok: true, message: "Web push subscription cleared" });
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

  const userIds = [...new Set(callDocs.map((c: any) => c.userId))];
  const users = await UserModel.find({ _id: { $in: userIds } }).lean();
  const userMap = Object.fromEntries(users.map((u: any) => [u._id, u.username]));

  const calls = callDocs.map((c: any) => ({
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

router.get("/admin/freeswitch/config-preview", requireAdmin, (_req, res) => {
  const fsHost = process.env.FREESWITCH_DOMAIN ?? "YOUR_FREESWITCH_HOST";
  const appUrl = getAppUrl() || "https://rtc.PRaww.co.za";
  res.json({
    "autoload_configs/xml_curl.conf.xml":    xmlCurlConf(appUrl, process.env.FREESWITCH_WEBHOOK_SECRET),
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

  const userIds = statsByUser.map((s: any) => s._id);
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name username email locked")
    .lean();
  const userMap = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  res.json({
    stats: statsByUser.map((s: any) => {
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

  const userIds = [...new Set(flags.map((f: any) => f.userId))];
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name username email locked approved")
    .lean();
  const userMap = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  res.json({
    flags: flags.map((f: any) => ({
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

  const creatorIds = [...new Set(announcements.map((a: any) => a.createdBy))];
  const creators = await UserModel.find({ _id: { $in: creatorIds } })
    .select("name username")
    .lean();
  const creatorMap = Object.fromEntries(creators.map((u: any) => [String(u._id), u]));

  res.json({
    announcements: announcements.map((a: any) => ({
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

// ── Abuse / Call Pattern Monitoring ──────────────────────────────────────────

router.get("/admin/monitoring/scan", requireAdmin, async (req, res) => {
  await connectDB();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const pipeline = [
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: "$userId",
        totalCalls:  { $sum: 1 },
        shortCalls:  { $sum: { $cond: [{ $lt: ["$billsec", 10] }, 1, 0] } },
        totalBillsec: { $sum: "$billsec" },
        uniqueNumbers: { $addToSet: "$recipientNumber" },
      },
    },
  ];

  const rows = await CdrModel.aggregate(pipeline as any[]);

  const created: { userId: string; reason: string; severity: string }[] = [];

  for (const row of rows) {
    const userId: string = row._id;
    if (!userId) continue;

    const checks: { reason: string; severity: "low" | "medium" | "high" }[] = [];

    if (row.totalCalls > 50) {
      checks.push({ reason: `High call volume: ${row.totalCalls} calls in 24 h`, severity: "high" });
    }
    const shortRatio = row.totalCalls > 0 ? row.shortCalls / row.totalCalls : 0;
    if (shortRatio > 0.6 && row.totalCalls >= 10) {
      checks.push({
        reason: `Suspicious short-call ratio: ${Math.round(shortRatio * 100)}% of calls < 10 s`,
        severity: "high",
      });
    }
    const uniqueCount = Array.isArray(row.uniqueNumbers) ? row.uniqueNumbers.filter(Boolean).length : 0;
    if (uniqueCount > 30) {
      checks.push({ reason: `Broad dialling: ${uniqueCount} unique numbers called in 24 h`, severity: "medium" });
    }

    for (const check of checks) {
      const exists = await AbuseFlagModel.findOne({ userId, reason: check.reason, createdAt: { $gte: since } }).lean();
      if (!exists) {
        await AbuseFlagModel.create({
          _id: randomUUID(),
          userId,
          reason: check.reason,
          severity: check.severity,
          flaggedBy: "system",
        });
        created.push({ userId, ...check });
      }
    }
  }

  res.json({
    scannedUsers: rows.length,
    newFlags: created.length,
    flags: created,
  });
});

router.get("/admin/monitoring/flags", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const resolved = req.query.resolved === "true";
  const query: any = resolved ? { resolvedAt: { $exists: true } } : { resolvedAt: { $exists: false } };

  const [flags, total] = await Promise.all([
    AbuseFlagModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AbuseFlagModel.countDocuments(query),
  ]);

  const userIds = [...new Set(flags.map((f: any) => f.userId))];
  const users = await UserModel.find({ _id: { $in: userIds } }).select("name username email").lean();
  const userMap = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  res.json({
    flags: flags.map((f: any) => ({ ...f, id: f._id, user: userMap[f.userId] ?? null })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/admin/monitoring/flags/:flagId/resolve", requireAdmin, async (req, res) => {
  await connectDB();
  const { flagId } = req.params;
  const flag = await AbuseFlagModel.findById(flagId);
  if (!flag) { res.status(404).json({ error: "Flag not found" }); return; }
  flag.resolvedAt = new Date();
  flag.notes = req.body.notes ?? flag.notes;
  await flag.save();
  res.json({ message: "Flag resolved", flag: { ...flag.toObject(), id: flag._id } });
});

// ── System health (production readiness) ──────────────────────────────────────

router.get("/admin/system-health", requireAdmin, async (req, res) => {
  const esl = eslStatus();
  const appUrl = getAppUrl();

  const ENV_VARS = [
    { key: "MONGODB_URI",              label: "MongoDB URI",             required: true,  hint: "Primary database connection string" },
    { key: "FREESWITCH_DOMAIN",        label: "FreeSWITCH Domain / IP",  required: true,  hint: "Hostname or IP of the FreeSWITCH server" },
    { key: "FREESWITCH_SSH_KEY",       label: "SSH Private Key",         required: true,  hint: "Used to push config files and reload modules via SSH" },
    { key: "FREESWITCH_ESL_PASSWORD",  label: "ESL Password",            required: true,  hint: "mod_event_socket auth password (default: ClueCon)" },
    { key: "APP_URL",                  label: "App Public URL",          required: true,  hint: "Public HTTPS URL of this server (e.g. https://rtc.praww.co.za)" },
    { key: "SESSION_SECRET",           label: "Session Secret",          required: true,  hint: "Random string for signing session cookies" },
    { key: "FREESWITCH_WEBHOOK_SECRET",label: "Webhook Secret",          required: false, hint: "Shared secret between FreeSWITCH and this API (recommended)" },
    { key: "PSTN_GATEWAY_NAME",        label: "PSTN Gateway Name",       required: false, hint: "Required only for external / outbound PSTN calls" },
    { key: "PSTN_GATEWAY_USERNAME",    label: "PSTN Gateway Username",   required: false, hint: "SIP trunk username" },
    { key: "PSTN_GATEWAY_PASSWORD",    label: "PSTN Gateway Password",   required: false, hint: "SIP trunk password" },
    { key: "PSTN_GATEWAY_PROXY",       label: "PSTN Gateway Proxy",      required: false, hint: "SIP trunk proxy / host" },
  ].map((v) => ({ ...v, set: Boolean(process.env[v.key]) }));

  let dbConnected = false;
  let dbError: string | null = null;
  try {
    await connectDB();
    await UserModel.estimatedDocumentCount();
    dbConnected = true;
  } catch (e: any) {
    dbError = e?.message ?? "Unknown DB error";
  }

  const fsDomain = process.env.FREESWITCH_DOMAIN ?? null;
  const wsUrl = appUrl
    ? appUrl.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/api/verto/ws"
    : null;

  res.json({
    db: { connected: dbConnected, error: dbError },
    esl,
    envVars: ENV_VARS,
    config: {
      domain:       fsDomain,
      appUrl:       appUrl ?? null,
      directoryUrl: appUrl ? `${appUrl}/api/freeswitch/directory` : null,
      vertoWsUrl:   wsUrl,
      sshUser:      process.env.FREESWITCH_SSH_USER ?? "ubuntu",
      confDir:      process.env.FREESWITCH_CONF_DIR ?? "/usr/local/freeswitch/conf",
      eslHost:      process.env.FREESWITCH_ESL_HOST ?? fsDomain,
      eslPort:      parseInt(process.env.FREESWITCH_ESL_PORT ?? "8021"),
    },
  });
});

router.post("/admin/freeswitch/push-config", requireAdmin, async (_req, res) => {
  const result = await pushFreeSwitchConfig({ lightReload: false });
  res.status(result.success ? 200 : 500).json(result);
});

// ── ICE / TURN Server Configuration ───────────────────────────────────────────
// Stored in MongoDB so they can be changed without restarting the server.
// Priority at call time: DB > ICE_SERVERS env var > built-in Google STUN defaults.

const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
];

router.get("/admin/ice-servers", requireAdmin, async (_req, res) => {
  await connectDB();
  const config = await SystemConfigModel.findById("singleton").lean();
  let envServers: typeof DEFAULT_ICE_SERVERS | null = null;
  if (process.env.ICE_SERVERS) {
    try { envServers = JSON.parse(process.env.ICE_SERVERS); } catch { /* ignore */ }
  }
  const dbServers = config?.iceServers ?? [];
  const source: "database" | "env" | "defaults" =
    dbServers.length > 0 ? "database" : envServers ? "env" : "defaults";
  const effective = dbServers.length > 0
    ? dbServers
    : envServers ?? DEFAULT_ICE_SERVERS;
  res.json({
    source,
    effective,
    dbServers,
    envServers,
    defaultServers: DEFAULT_ICE_SERVERS,
    updatedAt: config?.updatedAt ?? null,
  });
});

router.put("/admin/ice-servers", requireAdmin, async (req: any, res) => {
  await connectDB();
  const { iceServers } = req.body as { iceServers?: unknown };
  if (!Array.isArray(iceServers)) {
    res.status(400).json({ error: "iceServers must be an array" });
    return;
  }
  for (const s of iceServers) {
    if (typeof (s as any)?.urls !== "string" || !(s as any).urls.trim()) {
      res.status(400).json({ error: "Each ICE server must have a non-empty 'urls' string" });
      return;
    }
  }
  await SystemConfigModel.findByIdAndUpdate(
    "singleton",
    { $set: { iceServers, updatedAt: new Date(), updatedBy: req.user?.email ?? req.user?.id } },
    { upsert: true, new: true },
  );
  await logAdminAction(req, "system.ice-servers.update", "system", "ICE servers", { count: iceServers.length });
  res.json({ ok: true, count: iceServers.length });
});

router.post("/admin/freeswitch/test-ssh", requireAdmin, async (_req, res) => {
  const result = await testSSHConnection();
  res.status(result.ok ? 200 : 500).json(result);
});

// ── Failed / errored calls ─────────────────────────────────────────────────────

router.get("/admin/failed-calls", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit } = parsePageLimit(req.query);
  const skip = (page - 1) * limit;

  const { status: statusFilter } = req.query;
  const allowedStatuses = ["failed", "no-answer", "busy", "cancelled"];
  const statusList = statusFilter && typeof statusFilter === "string" && allowedStatuses.includes(statusFilter)
    ? [statusFilter]
    : allowedStatuses;

  const query: Record<string, unknown> = {
    status:          { $in: statusList },
    adminDismissed:  { $ne: true },
  };

  const [calls, total] = await Promise.all([
    CallModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CallModel.countDocuments(query),
  ]);

  // Enrich with user info (name + email) so the dashboard can show who made/received the call
  const userIds = [...new Set(calls.map((c: any) => c.userId).filter(Boolean))] as string[];
  const users = userIds.length
    ? await UserModel.find({ _id: { $in: userIds } }, { name: 1, email: 1, username: 1 }).lean()
    : [];
  const userMap: Record<string, { name?: string; email?: string; username?: string }> = {};
  for (const u of users) {
    userMap[String((u as any)._id)] = { name: (u as any).name, email: (u as any).email, username: (u as any).username };
  }

  const enriched = calls.map((c: any) => ({
    ...c,
    userInfo: c.userId ? (userMap[String(c.userId)] ?? null) : null,
  }));

  res.json({ calls: enriched, total, page, limit });
});

router.post("/admin/calls/:callId/dismiss", requireAdmin, async (req, res) => {
  await connectDB();
  const { callId } = req.params;
  const result = await CallModel.updateOne({ _id: callId }, { $set: { adminDismissed: true } });
  if (result.matchedCount === 0) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json({ ok: true });
});

// ── Server-side app errors (ring buffer) ──────────────────────────────────────

router.get("/admin/app-errors", requireAdmin, (_req, res) => {
  const errors = getRecentErrors(100);
  res.json({ errors, count: errors.length });
});

router.delete("/admin/app-errors", requireAdmin, (_req, res) => {
  clearErrorStore();
  res.json({ ok: true });
});

router.get("/admin/freeswitch/config-preview", requireAdmin, async (req, res) => {
  const appUrl = getAppUrl();
  const fsDomain = process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  const fsHost = fsDomain.split(":")[0].replace(/^[a-z]+:\/\//i, "").replace(/\/$/, "");

  res.json({
    xmlCurl:    xmlCurlConf(appUrl ?? "", process.env.FREESWITCH_WEBHOOK_SECRET),
    verto:      vertoConf(fsHost),
    eventSocket: eventSocketConf(),
    dialplan:   dialplanXml(fsHost),
    sipProfile: sipProfileXml(fsHost, appUrl ?? ""),
  });
});

// ── Audit Logs ─────────────────────────────────────────────────────────────────

router.get("/admin/audit-logs", requireAdmin, async (req, res) => {
  await connectDB();
  const { page, limit, skip } = parsePageLimit(req.query);
  const { adminId, action, targetType, targetId } = req.query;

  const filter: Record<string, unknown> = {};
  if (adminId)    filter.adminId    = adminId;
  if (action)     filter.action     = action;
  if (targetType) filter.targetType = targetType;
  if (targetId)   filter.targetId   = targetId;

  const [logs, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLogModel.countDocuments(filter),
  ]);

  res.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
});

export default router;
