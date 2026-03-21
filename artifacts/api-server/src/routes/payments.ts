import { Router, type IRouter } from "express";
import { connectDB, PaymentModel, UserModel, PhoneNumberModel } from "@workspace/db";
import { randomUUID } from "crypto";
import crypto from "crypto";

const router: IRouter = Router();

const PLAN_PRICES: Record<string, number> = {
  basic: 59,
  pro: 109,
};

const COIN_VALUE = 0.9;

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
  customStr2?: string;
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

  if (params.customStr2) {
    fields.custom_str2 = params.customStr2;
  }

  const signatureStr =
    Object.entries(fields)
      .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`)
      .join("&") +
    (params.passphrase
      ? `&passphrase=${encodeURIComponent(params.passphrase).replace(/%20/g, "+")}`
      : "");

  fields.signature = crypto.createHash("md5").update(signatureStr).digest("hex");
  return fields;
}

function getBaseUrl(req: any): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domains) return `https://${domains}`;
  const host = req.headers.host ?? "localhost";
  return `http://${host}`;
}

function getPayFastCredentials() {
  const merchantId = process.env.PAYFAST_MERCHANT_ID ?? "10000100";
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY ?? "46f0cd694581a";
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const isSandbox = !process.env.PAYFAST_MERCHANT_ID;
  const paymentUrl = isSandbox
    ? "https://sandbox.payfast.co.za/eng/process"
    : "https://www.payfast.co.za/eng/process";
  return { merchantId, merchantKey, passphrase, paymentUrl };
}

function verifyPayFastSignature(body: Record<string, string>, passphrase?: string): boolean {
  const { signature, ...rest } = body;
  if (!signature) return false;

  const ordered: Record<string, string> = {};
  const expectedKeys = [
    "m_payment_id","pf_payment_id","payment_status","item_name","item_description",
    "amount_gross","amount_fee","amount_net","custom_str1","custom_str2","custom_str3",
    "custom_str4","custom_str5","custom_int1","custom_int2","custom_int3","custom_int4",
    "custom_int5","name_first","name_last","email_address","merchant_id",
  ];
  for (const key of expectedKeys) {
    if (rest[key] !== undefined && rest[key] !== "") {
      ordered[key] = rest[key];
    }
  }

  let signatureStr = Object.entries(ordered)
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`)
    .join("&");

  if (passphrase) {
    signatureStr += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`;
  }

  const expected = crypto.createHash("md5").update(signatureStr).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

const PAYFAST_VALID_IPS = [
  "41.74.179.194",
  "41.74.179.195",
  "41.74.179.196",
  "41.74.179.197",
  "41.74.179.198",
  "41.74.179.199",
  "197.97.145.144",
  "197.97.145.145",
  "197.97.145.146",
  "197.97.145.147",
];

function getClientIp(req: any): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress ?? "";
}

router.post("/payments/subscribe", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { plan } = req.body;

  const selectedPlan = plan === "pro" ? "pro" : "basic";
  const amount = PLAN_PRICES[selectedPlan];
  const paymentId = randomUUID();
  const base = getBaseUrl(req);
  const { merchantId, merchantKey, passphrase, paymentUrl } = getPayFastCredentials();

  await PaymentModel.create({
    _id: paymentId,
    userId,
    amount,
    coinsAdded: 0,
    status: "pending",
    paymentType: "subscription",
    subscriptionPlan: selectedPlan,
  });

  const formFields = buildPayFastData({
    merchantId,
    merchantKey,
    returnUrl: `${base}/?payment=success`,
    cancelUrl: `${base}/subscription?payment=cancelled`,
    notifyUrl: `${base}/api/payments/webhook`,
    paymentId,
    userId,
    amount,
    itemName: `${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} Plan - Monthly Subscription`,
    passphrase,
    customStr2: selectedPlan,
  });

  res.json({
    paymentUrl,
    amount: amount.toFixed(2),
    itemName: `${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} Plan`,
    paymentId,
    formFields,
  });
});

router.post("/payments/webhook", async (req, res) => {
  const body: Record<string, string> = req.body;
  const { m_payment_id, payment_status, custom_str1: userId, custom_str2 } = body;

  if (!m_payment_id || !payment_status) {
    res.status(400).send("Invalid webhook");
    return;
  }

  const isSandbox = !process.env.PAYFAST_MERCHANT_ID;

  if (!isSandbox) {
    const clientIp = getClientIp(req);
    if (!PAYFAST_VALID_IPS.includes(clientIp)) {
      res.status(403).send("Forbidden");
      return;
    }

    const { passphrase } = getPayFastCredentials();
    const signatureValid = verifyPayFastSignature(body, passphrase);
    if (!signatureValid) {
      res.status(400).send("Invalid signature");
      return;
    }
  }

  await connectDB();

  if (payment_status === "COMPLETE") {
    const payment = await PaymentModel.findById(m_payment_id);
    if (!payment) {
      res.status(400).send("Payment not found");
      return;
    }

    if (payment.status === "completed") {
      res.sendStatus(200);
      return;
    }

    const now = new Date();
    const nextPayment = new Date(now);
    nextPayment.setMonth(nextPayment.getMonth() + 1);

    await PaymentModel.updateOne({ _id: m_payment_id }, { status: "completed", completedAt: now });

    const targetUserId = payment.userId;

    if (payment.paymentType === "subscription") {
      const plan = payment.subscriptionPlan ?? custom_str2 ?? "basic";
      await UserModel.updateOne(
        { _id: targetUserId },
        {
          subscriptionStatus: "active",
          subscriptionPlan: plan,
          subscriptionExpiresAt: nextPayment,
          lastPaymentDate: now,
          nextPaymentDate: nextPayment,
        },
      );
    } else if (payment.paymentType === "topup") {
      const coinsToAdd = payment.coinsAdded;
      await UserModel.updateOne(
        { _id: targetUserId },
        { $inc: { coins: coinsToAdd } },
      );
    } else if (payment.paymentType === "number_change") {
      const meta = payment.meta as any;
      const oldNumberId = meta?.oldNumberId;
      const newNumberId = meta?.newNumberId;
      if (oldNumberId) {
        await PhoneNumberModel.updateOne({ _id: oldNumberId }, { userId: null });
      }
      if (newNumberId) {
        const alreadyTaken = await PhoneNumberModel.findOne({ _id: newNumberId, userId: { $ne: null } });
        if (!alreadyTaken) {
          await PhoneNumberModel.updateOne({ _id: newNumberId }, { userId: targetUserId });
        }
      }
    }
  } else if (payment_status === "FAILED" || payment_status === "CANCELLED") {
    await PaymentModel.updateOne({ _id: m_payment_id }, { status: "failed" });
  }

  res.sendStatus(200);
});

router.get("/payments/history", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const payments = await PaymentModel.find({ userId }).sort({ createdAt: -1 }).lean();
  res.json({ payments: payments.map((p) => ({ ...p, id: String(p._id) })), total: payments.length });
});

router.post("/credits/topup", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { amount } = req.body;

  if (!amount || amount < 10) {
    res.status(400).json({ error: "Minimum top-up amount is R10" });
    return;
  }

  const coinsAdded = Math.floor(amount / COIN_VALUE);
  const paymentId = randomUUID();
  const base = getBaseUrl(req);
  const { merchantId, merchantKey, passphrase, paymentUrl } = getPayFastCredentials();

  await PaymentModel.create({
    _id: paymentId,
    userId,
    amount,
    coinsAdded,
    status: "pending",
    paymentType: "topup",
  });

  const formFields = buildPayFastData({
    merchantId,
    merchantKey,
    returnUrl: `${base}/?payment=success`,
    cancelUrl: `${base}/wallet?payment=cancelled`,
    notifyUrl: `${base}/api/payments/webhook`,
    paymentId,
    userId,
    amount,
    itemName: `Wallet Top-Up R${amount} (${coinsAdded} coins)`,
    passphrase,
  });

  res.json({
    paymentUrl,
    amount: amount.toFixed(2),
    itemName: `Wallet Top-Up R${amount} (${coinsAdded} coins)`,
    coinsAdded,
    paymentId,
    formFields,
  });
});

export default router;
