import { Router, type IRouter } from "express";
import { db, usersTable, callsTable, paymentsTable } from "@workspace/db";
import { eq, desc, count, sum, sql, and } from "drizzle-orm";

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    [{ totalUsers }],
    [{ activeSubscriptions }],
    [{ totalCalls }],
    totalMinutesRows,
    totalRevenueRows,
    [{ callsToday }],
    [{ newUsersThisMonth }],
    recentPayments,
  ] = await Promise.all([
    db.select({ totalUsers: count() }).from(usersTable),
    db.select({ activeSubscriptions: count() }).from(usersTable).where(eq(usersTable.subscriptionStatus, "active")),
    db.select({ totalCalls: count() }).from(callsTable),
    db.select({ total: sum(callsTable.duration) }).from(callsTable),
    db.select({ total: sum(paymentsTable.amount) }).from(paymentsTable).where(eq(paymentsTable.status, "completed")),
    db.select({ callsToday: count() }).from(callsTable).where(sql`${callsTable.createdAt} >= ${today}`),
    db.select({ newUsersThisMonth: count() }).from(usersTable).where(sql`${usersTable.createdAt} >= ${monthStart}`),
    db.select().from(paymentsTable).where(eq(paymentsTable.status, "completed")).orderBy(desc(paymentsTable.createdAt)).limit(10),
  ]);

  res.json({
    totalUsers,
    activeSubscriptions,
    totalCalls,
    totalCallMinutes: Math.floor((Number(totalMinutesRows[0]?.total ?? 0)) / 60),
    totalRevenue: Number(totalRevenueRows[0]?.total ?? 0),
    callsToday,
    newUsersThisMonth,
    recentPayments,
  });
});

router.get("/admin/users", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"))));
  const offset = (page - 1) * limit;

  const [users, [{ total }]] = await Promise.all([
    db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(usersTable),
  ]);

  res.json({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get("/admin/users/:userId", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const [recentCalls, recentPayments] = await Promise.all([
    db.select().from(callsTable).where(eq(callsTable.userId, userId)).orderBy(desc(callsTable.createdAt)).limit(10),
    db.select().from(paymentsTable).where(eq(paymentsTable.userId, userId)).orderBy(desc(paymentsTable.createdAt)).limit(10),
  ]);
  res.json({ user, recentCalls, recentPayments });
});

router.post("/admin/users/:userId/adjust-credit", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { amount, reason } = req.body;
  if (amount === undefined) {
    res.status(400).json({ error: "amount is required" });
    return;
  }
  const [user] = await db.update(usersTable)
    .set({ creditBalance: sql`GREATEST(0, ${usersTable.creditBalance} + ${amount})` })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.get("/admin/calls", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"))));
  const offset = (page - 1) * limit;
  const filterUserId = req.query.userId as string | undefined;

  const whereClause = filterUserId ? eq(callsTable.userId, filterUserId) : undefined;

  const [callRows, totalRows] = await Promise.all([
    db.select({
      id: callsTable.id,
      userId: callsTable.userId,
      callerNumber: callsTable.callerNumber,
      recipientNumber: callsTable.recipientNumber,
      status: callsTable.status,
      duration: callsTable.duration,
      cost: callsTable.cost,
      telnyxCallId: callsTable.telnyxCallId,
      notes: callsTable.notes,
      startedAt: callsTable.startedAt,
      endedAt: callsTable.endedAt,
      createdAt: callsTable.createdAt,
      username: usersTable.username,
    })
      .from(callsTable)
      .leftJoin(usersTable, eq(callsTable.userId, usersTable.id))
      .where(whereClause)
      .orderBy(desc(callsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(callsTable).where(whereClause),
  ]);

  const total = totalRows[0]?.count ?? 0;
  res.json({ calls: callRows, total, page, limit, totalPages: Math.ceil(total / limit) });
});

export default router;
