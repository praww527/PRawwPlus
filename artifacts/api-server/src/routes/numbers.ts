import { Router, type IRouter } from "express";
import { connectDB, PhoneNumberModel, UserModel, PaymentModel } from "@workspace/db";
import { randomUUID } from "crypto";
import crypto from "crypto";

const router: IRouter = Router();

const PLAN_NUMBER_LIMITS: Record<string, number> = {
  basic: 1,
  pro: 2,
};

const NUMBER_CHANGE_FEE = 100;

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
  if (params.customStr2) fields.custom_str2 = params.customStr2;

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
  return `http://${req.headers.host ?? "localhost"}`;
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

function telnyxHeaders() {
  return {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function isPremiumNumber(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 4) return false;
  const last4 = digits.slice(-4);
  if (/^(\d)\1{3}$/.test(last4)) return true;
  if (/^(\d)\1{2}\d$/.test(last4)) return true;
  if (/1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321/.test(last4)) return true;
  return false;
}

/* ── GET /numbers — user's owned numbers ── */
router.get("/numbers", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await connectDB();
  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId).lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const myNumbers = await PhoneNumberModel.find({ userId }).lean();
  const plan = user.subscriptionPlan ?? "basic";
  const maxNumbers = PLAN_NUMBER_LIMITS[plan] ?? 1;

  res.json({
    myNumbers: myNumbers.map((n) => ({
      id: n._id,
      number: n.number,
      status: "active",
      telnyxNumberId: n.telnyxNumberId,
    })),
    maxNumbers,
    plan,
    subscriptionActive: user.subscriptionStatus === "active",
  });
});

/* ── GET /numbers/search — search Telnyx available numbers ── */
router.get("/numbers/search", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await connectDB();

  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId).lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.subscriptionStatus !== "active") {
    res.status(403).json({ error: "subscription_required", message: "Subscribe to search numbers." });
    return;
  }

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Telnyx not configured", message: "TELNYX_API_KEY is not set." });
    return;
  }

  const country = String(req.query.country_code ?? "ZA");
  const numberType = String(req.query.number_type ?? "local");
  const locality = req.query.locality ? String(req.query.locality) : undefined;

  const params = new URLSearchParams({
    "filter[country_code]": country,
    "filter[features][]": "voice",
    "filter[number_type]": numberType === "mobile" ? "mobile" : "local",
    "page[size]": "20",
  });
  if (locality) params.set("filter[locality]", locality);

  try {
    const telRes = await fetch(
      `https://api.telnyx.com/v2/available_phone_numbers?${params}`,
      { headers: telnyxHeaders() }
    );
    const data: any = await telRes.json();

    if (!telRes.ok) {
      res.status(502).json({
        error: "Telnyx error",
        message: data?.errors?.[0]?.detail ?? "Unable to fetch numbers. Try again.",
      });
      return;
    }

    const numbers = (data?.data ?? []).map((n: any) => ({
      phone_number: n.phone_number,
      number_type: n.number_type,
      region: n.region_information?.[0]?.region_name ?? null,
      monthly_cost: n.cost_information?.monthly_cost ?? null,
      upfront_cost: n.cost_information?.upfront_cost ?? null,
      is_premium: isPremiumNumber(n.phone_number),
    }));

    res.json({ numbers, total: numbers.length });
  } catch (_e) {
    res.status(502).json({ error: "network_error", message: "Unable to fetch numbers. Try again." });
  }
});

/* ── POST /numbers/buy — purchase via Telnyx & assign to user ── */
router.post("/numbers/buy", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await connectDB();

  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.subscriptionStatus !== "active") {
    res.status(403).json({ error: "subscription_required", message: "You need an active subscription to buy numbers." });
    return;
  }

  const plan = user.subscriptionPlan ?? "basic";
  const maxNumbers = PLAN_NUMBER_LIMITS[plan] ?? 1;
  const myNumbers = await PhoneNumberModel.find({ userId }).lean();
  if (myNumbers.length >= maxNumbers) {
    res.status(400).json({
      error: "number_limit_reached",
      message: `Your ${plan} plan allows ${maxNumbers} number(s). Remove an existing number first.`,
    });
    return;
  }

  const { phone_number } = req.body;
  if (!phone_number) { res.status(400).json({ error: "phone_number is required" }); return; }

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    // No Telnyx key — save a mock number for dev/testing
    const existing = await PhoneNumberModel.findOne({ number: phone_number });
    if (existing && existing.userId) {
      res.status(409).json({ error: "Number already owned" });
      return;
    }
    if (existing) {
      existing.userId = userId;
      await existing.save();
    } else {
      await PhoneNumberModel.create({ _id: randomUUID(), number: phone_number, userId, status: "active" });
    }
    res.json({ message: "Number assigned (dev mode)", number: { number: phone_number, status: "active" } });
    return;
  }

  try {
    const telRes = await fetch("https://api.telnyx.com/v2/number_orders", {
      method: "POST",
      headers: telnyxHeaders(),
      body: JSON.stringify({
        phone_numbers: [{ phone_number }],
        connection_id: process.env.TELNYX_SIP_CONNECTION_ID,
      }),
    });
    const data: any = await telRes.json();

    if (!telRes.ok) {
      res.status(502).json({
        error: "purchase_failed",
        message: data?.errors?.[0]?.detail ?? "Failed to purchase number. Try again.",
      });
      return;
    }

    const orderedNumber = data?.data?.phone_numbers?.[0]?.phone_number ?? phone_number;
    const telnyxNumberId = data?.data?.id ?? undefined;

    const existing = await PhoneNumberModel.findOne({ number: orderedNumber });
    if (existing) {
      existing.userId = userId;
      existing.telnyxNumberId = telnyxNumberId;
      await existing.save();
    } else {
      await PhoneNumberModel.create({
        _id: randomUUID(),
        number: orderedNumber,
        telnyxNumberId,
        userId,
        status: "active",
      });
    }

    res.json({ message: "Number purchased successfully", number: { number: orderedNumber, status: "active" } });
  } catch (_e) {
    res.status(502).json({ error: "network_error", message: "Unable to complete purchase. Try again." });
  }
});

/* ── DELETE /numbers/:id — release/remove a number ── */
router.delete("/numbers/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await connectDB();

  const userId = (req as any).user.id;
  const { id } = req.params;

  const number = await PhoneNumberModel.findOne({ _id: id, userId });
  if (!number) { res.status(404).json({ error: "Number not found or not owned by you" }); return; }

  const apiKey = process.env.TELNYX_API_KEY;
  if (apiKey && number.telnyxNumberId) {
    try {
      await fetch(`https://api.telnyx.com/v2/phone_numbers/${number.telnyxNumberId}`, {
        method: "DELETE",
        headers: telnyxHeaders(),
      });
    } catch (_e) {}
  }

  await PhoneNumberModel.deleteOne({ _id: id });
  res.json({ message: "Number removed successfully" });
});

/* ── POST /numbers/change — initiate number change (R100 via PayFast) ── */
router.post("/numbers/change", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await connectDB();

  const userId = (req as any).user.id;
  const { oldNumberId, newPhoneNumber } = req.body;

  if (!oldNumberId || !newPhoneNumber) {
    res.status(400).json({ error: "oldNumberId and newPhoneNumber are required" });
    return;
  }

  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.subscriptionStatus !== "active") {
    res.status(403).json({ error: "subscription_required" });
    return;
  }

  const oldNumber = await PhoneNumberModel.findOne({ _id: oldNumberId, userId });
  if (!oldNumber) { res.status(404).json({ error: "Number not found or not owned by you" }); return; }

  const paymentId = randomUUID();
  const base = getBaseUrl(req);
  const { merchantId, merchantKey, passphrase, paymentUrl } = getPayFastCredentials();

  await PaymentModel.create({
    _id: paymentId,
    userId,
    amount: NUMBER_CHANGE_FEE,
    coinsAdded: 0,
    status: "pending",
    paymentType: "number_change",
    meta: { oldNumberId, newPhoneNumber },
  });

  const formFields = buildPayFastData({
    merchantId,
    merchantKey,
    returnUrl: `${base}/profile?payment=success`,
    cancelUrl: `${base}/profile?payment=cancelled`,
    notifyUrl: `${base}/api/payments/webhook`,
    paymentId,
    userId,
    amount: NUMBER_CHANGE_FEE,
    itemName: "Number Change Fee",
    passphrase,
  });

  res.json({ paymentUrl, amount: NUMBER_CHANGE_FEE.toFixed(2), itemName: "Number Change Fee", paymentId, formFields });
});

export default router;
