/**
 * Invoice Cron — Phase 3
 *
 * Runs periodic jobs:
 *   1. Monthly invoice generation (1st of each month)
 *   2. Daily low-balance alert sweep
 *   3. Weekly call summary email to users
 *
 * Uses simple setInterval-based scheduling (no external cron library needed).
 * Jobs are idempotent and safe to run multiple times.
 */

import { connectDB, UserModel, CdrModel, BillingLedgerModel, InvoiceModel } from "@workspace/db";
import { logger } from "./logger";
import { sendAdminPush } from "./push";
import { getUsersBelowThreshold } from "./balanceGuard";
import { randomUUID } from "crypto";

let started = false;

const MS_PER_HOUR  = 3_600_000;
const MS_PER_DAY   = 86_400_000;

export function startInvoiceCron(): void {
  if (started) return;
  started = true;

  logger.info("[invoiceCron] Starting periodic jobs");

  scheduleMonthlyInvoiceJob();
  scheduleDailyLowBalanceJob();
  scheduleWeeklySummaryJob();
}

// ── Monthly Invoice Job ───────────────────────────────────────────────────────

async function generateMonthlyInvoices(): Promise<void> {
  const now  = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const periodStart = new Date(year, month - 1, 1);
  const periodEnd   = new Date(year, month, 1);
  const label       = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, "0")}`;

  logger.info({ label }, "[invoiceCron] Generating monthly invoices");

  try {
    await connectDB();

    const users = await UserModel.find({ approved: true })
      .select("_id name email extension tenantId")
      .lean();

    let generated = 0;
    let skipped   = 0;

    for (const user of users) {
      const userId = String((user as any)._id);
      try {
        const existing = await InvoiceModel.findOne({ userId, periodStart }).lean();
        if (existing) { skipped++; continue; }

        const cdrs = await CdrModel.find({
          userId,
          endedAt: { $gte: periodStart, $lt: periodEnd },
        }).lean();

        if (!cdrs.length) { skipped++; continue; }

        const totalCoins  = cdrs.reduce((s, c) => s + ((c as any).coinsUsed ?? 0), 0);
        const totalBillsec = cdrs.reduce((s, c) => s + ((c as any).billsec  ?? 0), 0);
        const callCount   = cdrs.length;

        const invoice = await InvoiceModel.create({
          _id:        randomUUID(),
          userId,
          periodStart,
          periodEnd,
          lines: [{
            description: `Voice calls — ${callCount} calls, ${Math.floor(totalBillsec / 60)} minutes`,
            coins:        totalCoins,
          }],
          totalCoins,
          status: "final",
        });

        generated++;
        logger.debug({ userId, invoiceId: invoice._id, totalCoins, callCount }, "[invoiceCron] Invoice generated");
      } catch (userErr) {
        logger.error({ err: userErr, userId }, "[invoiceCron] Failed to generate invoice for user");
      }
    }

    logger.info({ label, generated, skipped }, "[invoiceCron] Monthly invoice run complete");
  } catch (err) {
    logger.error({ err }, "[invoiceCron] generateMonthlyInvoices failed");
  }
}

function scheduleMonthlyInvoiceJob(): void {
  const runIfFirstOfMonth = () => {
    const d = new Date();
    if (d.getDate() === 1 && d.getHours() === 2) {
      generateMonthlyInvoices().catch((e) =>
        logger.error({ err: e }, "[invoiceCron] Monthly job threw"),
      );
    }
  };
  setInterval(runIfFirstOfMonth, MS_PER_HOUR);
  logger.info("[invoiceCron] Monthly invoice job scheduled (hourly check, runs 1st at 02:00)");
}

// ── Daily Low-Balance Alert ───────────────────────────────────────────────────

async function runLowBalanceAlerts(): Promise<void> {
  logger.debug("[invoiceCron] Running low-balance alert sweep");
  try {
    const users = await getUsersBelowThreshold();
    logger.info({ count: users.length }, "[invoiceCron] Low-balance users found");

    for (const u of users) {
      try {
        const title = "Low Balance Alert";
        const body  = `Your PRaww+ balance is ${u.coins} coins — below your ${u.threshold}-coin threshold. Please top up to keep calls active.`;

        if (u.fcmToken || u.expoPushToken) {
          await sendAdminPush(u.fcmToken, u.expoPushToken, title, body, { type: "low_balance", coins: String(u.coins) });
        }
      } catch (err) {
        logger.error({ err, userId: u.userId }, "[invoiceCron] Low-balance push failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "[invoiceCron] runLowBalanceAlerts failed");
  }
}

function scheduleDailyLowBalanceJob(): void {
  const runAtMorning = () => {
    const h = new Date().getHours();
    if (h === 8) {
      runLowBalanceAlerts().catch((e) =>
        logger.error({ err: e }, "[invoiceCron] Low-balance sweep threw"),
      );
    }
  };
  setInterval(runAtMorning, MS_PER_HOUR);
  logger.info("[invoiceCron] Daily low-balance alert job scheduled (runs at 08:00)");
}

// ── Weekly Call Summary ───────────────────────────────────────────────────────

async function runWeeklySummary(): Promise<void> {
  logger.debug("[invoiceCron] Running weekly summary job");
  try {
    await connectDB();

    const now   = new Date();
    const since = new Date(now.getTime() - 7 * MS_PER_DAY);

    const users = await UserModel.find({ approved: true, "notificationPrefs.weeklyReport": true })
      .select("_id name email coins notificationPrefs expoPushToken fcmToken")
      .lean();

    for (const user of users) {
      const userId = String((user as any)._id);
      try {
        const cdrs = await CdrModel.find({ userId, endedAt: { $gte: since } }).lean();
        const callCount   = cdrs.length;
        const totalCoins  = cdrs.reduce((s, c) => s + ((c as any).coinsUsed ?? 0), 0);
        const totalMinutes = Math.floor(cdrs.reduce((s, c) => s + ((c as any).billsec ?? 0), 0) / 60);

        if (callCount === 0) continue;

        const title = "Your Weekly PRaww+ Summary";
        const body  = `This week: ${callCount} calls · ${totalMinutes} minutes · ${totalCoins} coins used. Balance: ${(user as any).coins} coins.`;

        if ((user as any).fcmToken || (user as any).expoPushToken) {
          await sendAdminPush((user as any).fcmToken, (user as any).expoPushToken, title, body, { type: "weekly_summary" });
        }
      } catch (err) {
        logger.error({ err, userId }, "[invoiceCron] Weekly summary push failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "[invoiceCron] runWeeklySummary failed");
  }
}

function scheduleWeeklySummaryJob(): void {
  const runOnMonday8am = () => {
    const d = new Date();
    if (d.getDay() === 1 && d.getHours() === 8) {
      runWeeklySummary().catch((e) =>
        logger.error({ err: e }, "[invoiceCron] Weekly summary threw"),
      );
    }
  };
  setInterval(runOnMonday8am, MS_PER_HOUR);
  logger.info("[invoiceCron] Weekly summary job scheduled (runs Mondays at 08:00)");
}

export { generateMonthlyInvoices, runLowBalanceAlerts, runWeeklySummary };
