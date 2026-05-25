import { Router, type IRouter } from "express";
import { connectDB, PaymentModel, UserModel, PhoneNumberModel, EarningModel } from "@workspace/db";
import { randomUUID } from "crypto";
import crypto from "crypto";
import { getBaseUrl } from "../lib/appUrl";
import { getTrustedClientIp } from "../lib/clientIp";
import { sendCommissionEarningEmail } from "../lib/email";
import { logger } from "../lib/logger";

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

function getPayFastCredentials() {
  // Treat the env var as absent if it is set but empty ("") — an empty string
  // is falsy in JS but process.env returns "" instead of undefined when the var
  // exists with no value, so we normalise to undefined for a clean check.
  const rawMerchantId  = process.env.PAYFAST_MERCHANT_ID?.trim()  || undefined;
  const rawMerchantKey = process.env.PAYFAST_MERCHANT_KEY?.trim() || undefined;
  const merchantId  = rawMerchantId  ?? "10000100";
  const merchantKey = rawMerchantKey ?? "46f0cd694581a";
  const passphrase  = process.env.PAYFAST_PASSPHRASE?.trim() || undefined;
  const isSandbox   = !rawMerchantId;
  if (isSandbox) {
    logger.warn("[PayFast] PAYFAST_MERCHANT_ID is not set — using sandbox credentials. Set PAYFAST_MERCHANT_ID in production.");
  }
  const paymentUrl = isSandbox
    ? "https://sandbox.payfast.co.za/eng/process"
    : "https://www.payfast.co.za/eng/process";
  return { merchantId, merchantKey, passphrase, paymentUrl, isSandbox };
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
  const expBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signature);
  if (expBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expBuf, sigBuf);
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
  const { m_payment_id, payment_status, custom_str1: _userId, custom_str2 } = body;

  if (
    typeof m_payment_id !== "string" ||
    typeof payment_status !== "string" ||
    !m_payment_id ||
    !payment_status
  ) {
    res.status(400).send("Invalid webhook");
    return;
  }

  // Use getPayFastCredentials() for the sandbox check so that an empty-string
  // PAYFAST_MERCHANT_ID (e.g. set but blank in the environment) is treated
  // identically to "not set" — both cases activate sandbox mode.
  const { passphrase, isSandbox } = getPayFastCredentials();

  if (isSandbox && process.env.NODE_ENV === "production") {
    logger.error("[PayFast] Webhook received in production but PAYFAST_MERCHANT_ID is not set — rejecting to prevent spoofed payments.");
    res.status(500).send("Server misconfiguration");
    return;
  }

  if (!isSandbox) {
    const clientIp = getTrustedClientIp(req);
    if (!PAYFAST_VALID_IPS.includes(clientIp)) {
      res.status(403).send("Forbidden");
      return;
    }

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

    // Atomic idempotency lock: use findOneAndUpdate with a $ne filter so only
    // the first concurrent webhook delivery wins. Any replay or duplicate delivery
    // will find status already "completed" and return null — safe to ACK and exit.
    const now = new Date();
    const nextPayment = new Date(now);
    nextPayment.setMonth(nextPayment.getMonth() + 1);

    const claimed = await PaymentModel.findOneAndUpdate(
      { _id: m_payment_id, status: { $ne: "completed" } },
      { $set: { status: "completed", completedAt: now } },
      { new: false },
    );
    if (!claimed) {
      // Already processed — acknowledge and exit
      res.sendStatus(200);
      return;
    }

    const targetUserId = claimed.userId;

    // ── Referral commission (30%) ──────────────────────────────────────────
    try {
      const buyer = await UserModel.findById(targetUserId).select("referredBy").lean();
      if (buyer?.referredBy && buyer.referredBy !== targetUserId) {
        const reseller = await UserModel.findById(buyer.referredBy)
          .select("role approved locked")
          .lean();
        if (reseller && reseller.role === "reseller" && reseller.approved && !reseller.locked) {
          const commissionAmount = parseFloat((payment.amount * 0.30).toFixed(2));
          const earningType =
            payment.paymentType === "subscription"
              ? "subscription"
              : payment.paymentType === "topup"
              ? "topup"
              : "number_purchase";
          // Use create() inside a try/catch for duplicate key (code 11000).
          // This is atomic — the unique index on referenceId prevents double-payouts
          // even under concurrent webhook retries, without a separate exists() read.
          let earningCreated = false;
          try {
            await EarningModel.create({
              _id: randomUUID(),
              resellerId: String(reseller._id),
              userId: targetUserId,
              amount: commissionAmount,
              purchaseAmount: payment.amount,
              type: earningType,
              referenceId: m_payment_id,
              status: "pending",
            });
            earningCreated = true;
          } catch (dupErr: any) {
            if (dupErr?.code !== 11000) throw dupErr;
          }

          if (earningCreated) {
            // Notify reseller by email (fire-and-forget)
            UserModel.findById(reseller._id).select("email name username").lean().then(async (resellerUser: any) => {
              const buyer = await UserModel.findById(targetUserId).select("name username").lean();
              if (resellerUser?.email) {
                sendCommissionEarningEmail(resellerUser.email, {
                  amount: commissionAmount,
                  purchaseAmount: payment.amount,
                  type: earningType,
                  buyerName: buyer?.name || buyer?.username || "a referred user",
                }).catch(() => {});
              }
            }).catch(() => {});
          }
        }
      }
    } catch (commissionErr) {
      logger.error({ err: commissionErr }, "[Commission] Failed to record commission");
    }

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
      const newPhoneNumber = meta?.newPhoneNumber;
      const changeNow = new Date();
      if (oldNumberId) {
        await PhoneNumberModel.updateOne({ _id: oldNumberId }, { userId: null, assignedAt: null });
      }
      if (newPhoneNumber) {
        const existingNew = await PhoneNumberModel.findOne({ number: newPhoneNumber });
        if (existingNew) {
          // Only assign if the number is still in the pool (not taken by someone else)
          if (!existingNew.userId) {
            await PhoneNumberModel.updateOne({ _id: existingNew._id }, { userId: targetUserId, assignedAt: changeNow });
          }
        } else {
          // Number doesn't exist in pool yet — create it assigned to this user
          await PhoneNumberModel.create({ _id: randomUUID(), number: newPhoneNumber, userId: targetUserId, assignedAt: changeNow });
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
  res.json({ payments: payments.map((p: any) => ({ ...p, id: String(p._id) })), total: payments.length });
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
