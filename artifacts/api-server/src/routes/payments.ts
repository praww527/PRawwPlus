import { Router, type IRouter } from "express";
import { db, paymentsTable, usersTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import crypto from "crypto";

const router: IRouter = Router();

const SUBSCRIPTION_AMOUNT = 100;
const SUBSCRIPTION_CREDIT = 20;

function buildPayFastData(params: {
  merchantId: string;
  merchantKey: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  paymentId: string;
  userId: string;
  amount: number;
  itemName: string;
  passphrase?: string;
}): Record<string, string> {
  const fields: Record<string, string> = {
    merchant_id: params.merchantId,
    merchant_key: params.merchantKey,
    return_url: params.returnUrl,
    cancel_url: params.cancelUrl,
    notify_url: params.notifyUrl,
    m_payment_id: params.paymentId,
    amount: params.amount.toFixed(2),
    item_name: params.itemName,
    custom_str1: params.userId,
  };

  const signatureStr = Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`)
    .join("&") + (params.passphrase ? `&passphrase=${encodeURIComponent(params.passphrase).replace(/%20/g, "+")}` : "");

  fields.signature = crypto.createHash("md5").update(signatureStr).digest("hex");
  return fields;
}

function getBaseUrl(req: any): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domains) return `https://${domains}`;
  const host = req.headers.host ?? "localhost";
  return `http://${host}`;
}

router.post("/payments/subscribe", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = (req as any).user.id;
  const paymentId = randomUUID();
  const base = getBaseUrl(req);

  const merchantId = process.env.PAYFAST_MERCHANT_ID ?? "10000100";
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY ?? "46f0cd694581a";
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const isSandbox = !process.env.PAYFAST_MERCHANT_ID;

  await db.insert(paymentsTable).values({
    id: paymentId,
    userId,
    amount: SUBSCRIPTION_AMOUNT,
    creditAdded: SUBSCRIPTION_CREDIT,
    status: "pending",
    paymentType: "subscription",
  });

  const notifyUrl = `${base}/api/payments/webhook`;
  const formFields = buildPayFastData({
    merchantId,
    merchantKey,
    returnUrl: `${base}/?payment=success`,
    cancelUrl: `${base}/subscription?payment=cancelled`,
    notifyUrl,
    paymentId,
    userId,
    amount: SUBSCRIPTION_AMOUNT,
    itemName: "Call Manager Monthly Subscription",
    passphrase,
  });

  const paymentUrl = isSandbox
    ? "https://sandbox.payfast.co.za/eng/process"
    : "https://www.payfast.co.za/eng/process";

  res.json({
    paymentUrl,
    amount: SUBSCRIPTION_AMOUNT.toFixed(2),
    itemName: "Call Manager Monthly Subscription",
    paymentId,
    formFields,
  });
});

router.post("/payments/webhook", async (req, res) => {
  const body: Record<string, string> = req.body;
  const { m_payment_id, payment_status, custom_str1: userId } = body;

  if (!m_payment_id || !payment_status) {
    res.status(400).send("Invalid webhook");
    return;
  }

  if (payment_status === "COMPLETE") {
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, m_payment_id));
    if (!payment) {
      res.status(400).send("Payment not found");
      return;
    }

    const now = new Date();
    const nextPayment = new Date(now);
    nextPayment.setMonth(nextPayment.getMonth() + 1);

    await db.update(paymentsTable).set({
      status: "completed",
      completedAt: now,
    }).where(eq(paymentsTable.id, m_payment_id));

    const targetUserId = userId ?? payment.userId;

    await db.update(usersTable).set({
      creditBalance: payment.creditAdded,
      subscriptionStatus: "active",
      lastPaymentDate: now,
      nextPaymentDate: nextPayment,
    }).where(eq(usersTable.id, targetUserId));
  } else if (payment_status === "FAILED" || payment_status === "CANCELLED") {
    await db.update(paymentsTable).set({ status: "failed" }).where(eq(paymentsTable.id, m_payment_id));
  }

  res.sendStatus(200);
});

router.get("/payments/history", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = (req as any).user.id;
  const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.userId, userId)).orderBy(desc(paymentsTable.createdAt));
  const total = payments.length;
  res.json({ payments, total });
});

router.post("/credits/topup", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = (req as any).user.id;
  const { amount } = req.body;

  if (!amount || amount < 10) {
    res.status(400).json({ error: "Minimum top-up amount is R10" });
    return;
  }

  const paymentId = randomUUID();
  const base = getBaseUrl(req);

  const merchantId = process.env.PAYFAST_MERCHANT_ID ?? "10000100";
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY ?? "46f0cd694581a";
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const isSandbox = !process.env.PAYFAST_MERCHANT_ID;

  await db.insert(paymentsTable).values({
    id: paymentId,
    userId,
    amount,
    creditAdded: amount,
    status: "pending",
    paymentType: "topup",
  });

  const notifyUrl = `${base}/api/payments/webhook`;
  const formFields = buildPayFastData({
    merchantId,
    merchantKey,
    returnUrl: `${base}/?payment=success`,
    cancelUrl: `${base}/credits?payment=cancelled`,
    notifyUrl,
    paymentId,
    userId,
    amount,
    itemName: `Call Credit Top-Up R${amount}`,
    passphrase,
  });

  const paymentUrl = isSandbox
    ? "https://sandbox.payfast.co.za/eng/process"
    : "https://www.payfast.co.za/eng/process";

  res.json({
    paymentUrl,
    amount: amount.toFixed(2),
    itemName: `Call Credit Top-Up R${amount}`,
    paymentId,
    formFields,
  });
});

export default router;
