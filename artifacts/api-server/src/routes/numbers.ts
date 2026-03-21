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

async function syncTelnyxNumbers() {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch(
      "https://api.telnyx.com/v2/phone_numbers?page[size]=50&status=active",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!res.ok) return;
    const data: any = await res.json();
    const numbers: any[] = data?.data ?? [];
    for (const n of numbers) {
      const num = n.phone_number;
      const telnyxNumberId = n.id;
      const existing = await PhoneNumberModel.findOne({ number: num });
      if (!existing) {
        await PhoneNumberModel.create({
          _id: randomUUID(),
          number: num,
          telnyxNumberId,
          userId: null,
        });
      }
    }
  } catch (_e) {}
}

router.get("/numbers", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();

  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId).lean();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.subscriptionStatus !== "active") {
    res.status(403).json({ error: "subscription_required", message: "Subscribe to access phone numbers." });
    return;
  }

  await syncTelnyxNumbers();

  const allNumbers = await PhoneNumberModel.find().lean();
  const myNumbers = allNumbers.filter((n) => n.userId === userId);
  const plan = user.subscriptionPlan ?? "basic";
  const maxNumbers = PLAN_NUMBER_LIMITS[plan] ?? 1;

  res.json({
    numbers: allNumbers.map((n) => ({
      id: n._id,
      number: n.number,
      status: n.userId === userId ? "owned" : n.userId ? "taken" : "free",
      userId: n.userId ?? null,
    })),
    myNumbers: myNumbers.map((n) => ({ id: n._id, number: n.number })),
    maxNumbers,
    plan,
  });
});

router.post("/numbers/select", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { numberId } = req.body;

  if (!numberId) {
    res.status(400).json({ error: "numberId is required" });
    return;
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.subscriptionStatus !== "active") {
    res.status(403).json({ error: "subscription_required", message: "You need an active subscription to select a number." });
    return;
  }

  const plan = user.subscriptionPlan ?? "basic";
  const maxNumbers = PLAN_NUMBER_LIMITS[plan] ?? 1;

  const myNumbers = await PhoneNumberModel.find({ userId }).lean();

  if (myNumbers.length >= maxNumbers) {
    res.status(400).json({
      error: "number_limit_reached",
      message: `Your ${plan} plan allows a maximum of ${maxNumbers} number(s). Release an existing number first or change it.`,
    });
    return;
  }

  const number = await PhoneNumberModel.findById(numberId);
  if (!number) {
    res.status(404).json({ error: "Number not found" });
    return;
  }

  if (number.userId) {
    res.status(409).json({ error: "Number already taken" });
    return;
  }

  number.userId = userId;
  await number.save();

  res.json({ message: "Number assigned successfully", number: { id: number._id, number: number.number } });
});

router.post("/numbers/change", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { oldNumberId, newNumberId } = req.body;

  if (!oldNumberId || !newNumberId) {
    res.status(400).json({ error: "oldNumberId and newNumberId are required" });
    return;
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.subscriptionStatus !== "active") {
    res.status(403).json({ error: "subscription_required", message: "You need an active subscription to change numbers." });
    return;
  }

  const oldNumber = await PhoneNumberModel.findOne({ _id: oldNumberId, userId });
  if (!oldNumber) {
    res.status(404).json({ error: "Old number not found or not owned by you" });
    return;
  }

  const newNumber = await PhoneNumberModel.findById(newNumberId);
  if (!newNumber) {
    res.status(404).json({ error: "New number not found" });
    return;
  }

  if (newNumber.userId) {
    res.status(409).json({ error: "New number is already taken" });
    return;
  }

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
    meta: { oldNumberId, newNumberId },
  });

  const formFields = buildPayFastData({
    merchantId,
    merchantKey,
    returnUrl: `${base}/numbers?payment=success`,
    cancelUrl: `${base}/numbers?payment=cancelled`,
    notifyUrl: `${base}/api/payments/webhook`,
    paymentId,
    userId,
    amount: NUMBER_CHANGE_FEE,
    itemName: "Number Change Fee",
    passphrase,
  });

  res.json({
    paymentUrl,
    amount: NUMBER_CHANGE_FEE.toFixed(2),
    itemName: "Number Change Fee",
    paymentId,
    formFields,
  });
});

export default router;
