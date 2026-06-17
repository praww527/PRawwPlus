import { Router, type IRouter } from "express";
import { connectDB, PhoneNumberModel, UserModel, PaymentModel } from "@workspace/db";
import { randomUUID } from "crypto";
import crypto from "crypto";
import { getBaseUrl } from "../lib/appUrl";
import { logger } from "../lib/logger";
import { hasDidProvider, getActiveDidProvider } from "../lib/didProviders";

const router: IRouter = Router();

const PLAN_NUMBER_LIMITS: Record<string, number> = {
  basic: 1,
  pro: 2,
};

const NUMBER_CHANGE_FEE = 100;
const NUMBER_LOCK_DAYS = 30;

function getLockedUntil(assignedAt: Date | null | undefined): Date | null {
  if (!assignedAt) return null;
  const unlock = new Date(assignedAt);
  unlock.setDate(unlock.getDate() + NUMBER_LOCK_DAYS);
  return unlock;
}

function isLocked(assignedAt: Date | null | undefined): boolean {
  const until = getLockedUntil(assignedAt);
  return until !== null && until > new Date();
}

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


function getPayFastCredentials() {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  if (!merchantId || !merchantKey) {
    throw new Error("PayFast credentials not configured. Set PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY.");
  }
  const paymentUrl = "https://www.payfast.co.za/eng/process";
  return { merchantId, merchantKey, passphrase, paymentUrl };
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
    myNumbers: myNumbers.map((n: any) => {
      const lockedUntil = getLockedUntil(n.assignedAt);
      return {
        id: n._id,
        number: n.number,
        status: "active",
        assignedAt: n.assignedAt ? n.assignedAt.toISOString() : null,
        lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
        locked: isLocked(n.assignedAt),
      };
    }),
    maxNumbers,
    plan,
    subscriptionActive: user.subscriptionStatus === "active",
  });
});

/* ── GET /numbers/search — search available numbers ── */
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

  const countryCode  = String(req.query.country_code  ?? "ZA").trim() || "ZA";
  const numberType   = req.query.number_type   ? String(req.query.number_type)  : undefined;
  const contains     = req.query.contains      ? String(req.query.contains)     : undefined;

  // ── Route through external DID provider when configured ──────────────────
  if (hasDidProvider()) {
    try {
      const provider = getActiveDidProvider();
      const dids = await provider.searchAvailable({ countryCode, numberType, contains, limit: 50 });
      const numbers = dids.map((d) => ({
        phone_number:  d.phoneNumber,
        number_type:   d.numberType,
        region:        d.region,
        monthly_cost:  d.monthlyRateZar,
        upfront_cost:  d.upfrontCostZar,
        is_premium:    d.isPremium,
        provider_ref:  d.providerRef,
        source:        "provider",
      }));
      res.json({ numbers, total: numbers.length, provider: provider.name });
      return;
    } catch (err: any) {
      logger.error({ err: err?.message }, "[numbers/search] DID provider error — falling back to local pool");
    }
  }

  // ── Fallback: local number pool ───────────────────────────────────────────
  const poolFilter =
    countryCode === "ZA"
      ? {
          userId: null,
          $or: [
            { country: "ZA" },
            { country: { $in: [null, ""] } },
            { country: { $exists: false } },
          ],
        }
      : { userId: null, country: countryCode };
  const available = await PhoneNumberModel.find(poolFilter).lean();

  const numbers = available.map((n: any) => ({
    phone_number: n.number,
    number_type:  n.country ?? "local",
    region:       n.region ?? null,
    monthly_cost: null,
    upfront_cost: null,
    is_premium:   isPremiumNumber(n.number),
    source:       "local",
  }));

  res.json({ numbers, total: numbers.length, provider: null });
});

/* ── POST /numbers/buy — assign a number from the pool to the user ── */
router.post("/numbers/buy", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await connectDB();

  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.subscriptionStatus !== "active") {
    res.status(403).json({ error: "subscription_required", message: "You need an active subscription to get a number." });
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

  const { phone_number, provider_ref } = req.body;
  if (!phone_number) { res.status(400).json({ error: "phone_number is required" }); return; }

  const now = new Date();

  // ── Route through external DID provider when configured ──────────────────
  if (hasDidProvider()) {
    try {
      const provider = getActiveDidProvider();
      const sipTrunkHost = process.env.BIZVOIP_SIP_TRUNK_HOST ?? process.env.SIP_TRUNK_HOST ?? "";
      const provisioned = await provider.provision({
        phoneNumber:   phone_number,
        providerRef:   provider_ref ?? phone_number,
        sipTrunkHost,
      });
      // Record in local DB so ownership, locking, and caller-ID selection all work
      const alreadyOwned = await PhoneNumberModel.findOne({ number: phone_number });
      if (alreadyOwned) {
        if (alreadyOwned.userId && alreadyOwned.userId !== userId) {
          res.status(409).json({ error: "Number already owned by another user" });
          return;
        }
        await PhoneNumberModel.updateOne({ _id: alreadyOwned._id }, { userId, assignedAt: now, providerRef: provisioned.providerRef, source: "provider" });
      } else {
        await PhoneNumberModel.create({ _id: randomUUID(), number: phone_number, userId, assignedAt: now, providerRef: provisioned.providerRef, source: "provider" });
      }
      logger.info({ userId, phoneNumber: phone_number, provider: provider.name }, "[numbers/buy] DID provisioned via provider");
      res.json({ message: "Number provisioned successfully", number: { number: phone_number, status: "active" } });
      return;
    } catch (err: any) {
      logger.error({ err: err?.message, userId, phoneNumber: phone_number }, "[numbers/buy] DID provider provisioning failed");
      res.status(502).json({ error: "provider_error", message: err?.message ?? "Number provisioning failed. Please try again." });
      return;
    }
  }

  // ── Fallback: local pool atomic claim ────────────────────────────────────
  // Assign only if the number is currently unassigned. Performing the check
  // and the write in one updateOne closes the race where two requests both
  // read userId:null and both assign the same number.
  const claim = await PhoneNumberModel.updateOne(
    { number: phone_number, $or: [{ userId: null }, { userId: { $exists: false } }] },
    { userId, assignedAt: now },
  );

  if (claim.matchedCount === 0) {
    // Nothing unassigned matched — the number either doesn't exist yet or is
    // already owned. Re-read and resolve deterministically.
    let existing = await PhoneNumberModel.findOne({ number: phone_number });
    if (!existing) {
      try {
        await PhoneNumberModel.create({ _id: randomUUID(), number: phone_number, userId, assignedAt: now });
      } catch (err: any) {
        // Lost a create race against a concurrent request (unique index on
        // `number`). Re-read and fall through to the ownership resolution below.
        if (err?.code !== 11000) throw err;
        existing = await PhoneNumberModel.findOne({ number: phone_number });
      }
    }
    if (existing) {
      if (existing.userId && existing.userId !== userId) {
        res.status(409).json({ error: "Number already owned by another user" });
        return;
      }
      if (!existing.userId) {
        // Became free between checks — claim it atomically.
        const reclaim = await PhoneNumberModel.updateOne(
          { _id: existing._id, $or: [{ userId: null }, { userId: { $exists: false } }] },
          { userId, assignedAt: now },
        );
        // If the conditional claim matched nothing, another request grabbed it
        // in the race window — confirm who owns it before reporting success.
        if (reclaim.matchedCount === 0) {
          const owner = await PhoneNumberModel.findOne({ number: phone_number });
          if (owner?.userId && owner.userId !== userId) {
            res.status(409).json({ error: "Number already owned by another user" });
            return;
          }
        }
      }
    }
  }

  res.json({ message: "Number assigned successfully", number: { number: phone_number, status: "active" } });
});

/* ── DELETE /numbers/:id — release/remove a number ── */
router.delete("/numbers/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await connectDB();

  const userId = (req as any).user.id;
  const { id } = req.params;

  const number = await PhoneNumberModel.findOne({ _id: id, userId });
  if (!number) { res.status(404).json({ error: "Number not found or not owned by you" }); return; }

  if (isLocked(number.assignedAt)) {
    const until = getLockedUntil(number.assignedAt)!;
    const daysLeft = Math.ceil((until.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    res.status(403).json({
      error: "number_locked",
      message: `This number is locked for ${daysLeft} more day${daysLeft !== 1 ? "s" : ""}. Numbers cannot be removed within 30 days of assignment.`,
      lockedUntil: until.toISOString(),
    });
    return;
  }

  // If the number was provisioned via an external DID provider, release it there first
  const providerRef = (number as any).providerRef ?? null;
  const source      = (number as any).source ?? null;
  if (source === "provider" && providerRef && hasDidProvider()) {
    try {
      const provider = getActiveDidProvider();
      await provider.release({ phoneNumber: number.number, providerRef });
      logger.info({ userId, phoneNumber: number.number, providerRef, provider: provider.name }, "[numbers/delete] DID released from provider");
    } catch (err: any) {
      logger.error({ err: err?.message, userId, phoneNumber: number.number }, "[numbers/delete] DID provider release failed — removing from local DB anyway");
    }
  }

  // Release back to the pool (set userId to null) so the number can be reused
  await PhoneNumberModel.updateOne({ _id: id }, { $set: { userId: null, assignedAt: null, providerRef: null, source: null } });
  res.json({ message: "Number removed successfully" });
});

/* ── PUT /numbers/:id/route — assign DID routing (admin only) ── */
router.put("/numbers/:id/route", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: "Admin access required" }); return; }

  await connectDB();
  const { id } = req.params;
  const { routeType, routeTarget } = req.body;

  const validRouteTypes = ["agent", "ring_group", "queue"];
  if (!routeType || !validRouteTypes.includes(routeType)) {
    res.status(400).json({ error: `routeType must be one of: ${validRouteTypes.join(", ")}` });
    return;
  }
  if (!routeTarget || typeof routeTarget !== "string") {
    res.status(400).json({ error: "routeTarget is required (userId, ringGroupId, or queueId)" });
    return;
  }

  const number = await PhoneNumberModel.findById(id);
  if (!number) { res.status(404).json({ error: "Number not found" }); return; }

  await PhoneNumberModel.updateOne(
    { _id: id },
    { $set: { routeType, routeTarget } },
  );

  logger.info({ numberId: id, routeType, routeTarget }, "[numbers/route] DID route updated");
  res.json({ ok: true, number: number.number, routeType, routeTarget });
});

/* ── GET /numbers/admin — list all numbers with route info (admin only) ── */
router.get("/numbers/admin", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = (req as any).user;
  if (!user?.isAdmin) { res.status(403).json({ error: "Admin access required" }); return; }

  await connectDB();
  const numbers = await PhoneNumberModel.find({}).sort({ number: 1 }).lean();

  const userIds = numbers.map((n: any) => n.userId).filter(Boolean);
  const users = userIds.length
    ? await UserModel.find({ _id: { $in: userIds } }).select("_id name username extension").lean()
    : [];
  const userMap = Object.fromEntries(users.map((u: any) => [String(u._id), u]));

  res.json({
    numbers: numbers.map((n: any) => ({
      id: n._id,
      number: n.number,
      userId: n.userId,
      user: n.userId ? (userMap[n.userId] ?? null) : null,
      routeType: n.routeType ?? "agent",
      routeTarget: n.routeTarget ?? n.userId,
      assignedAt: n.assignedAt,
      lockedUntil: getLockedUntil(n.assignedAt),
      locked: isLocked(n.assignedAt),
      country: n.country,
      region: n.region,
      source: n.source,
      providerRef: n.providerRef,
    })),
  });
});

/* ── POST /numbers/admin/provision — admin provision a DID directly (no plan limits) ── */
router.post("/numbers/admin/provision", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const adminUser = (req as any).user;
  if (!adminUser?.isAdmin) { res.status(403).json({ error: "Admin access required" }); return; }

  await connectDB();
  const { phone_number, provider_ref, routeType, routeTarget } = req.body;
  if (!phone_number) { res.status(400).json({ error: "phone_number is required" }); return; }

  const now = new Date();

  if (hasDidProvider()) {
    try {
      const provider = getActiveDidProvider();
      const sipTrunkHost = process.env.BIZVOIP_SIP_TRUNK_HOST ?? process.env.SIP_TRUNK_HOST ?? "";
      const provisioned = await provider.provision({
        phoneNumber:   phone_number,
        providerRef:   provider_ref ?? phone_number,
        sipTrunkHost,
      });
      const existing = await PhoneNumberModel.findOne({ number: phone_number });
      if (existing) {
        await PhoneNumberModel.updateOne({ _id: existing._id }, {
          assignedAt: now,
          providerRef: provisioned.providerRef,
          source: "provider",
          routeType: routeType ?? "agent",
          routeTarget: routeTarget ?? null,
        });
      } else {
        await PhoneNumberModel.create({
          _id: randomUUID(),
          number: phone_number,
          userId: routeType === "agent" ? routeTarget : null,
          assignedAt: now,
          providerRef: provisioned.providerRef,
          source: "provider",
          routeType: routeType ?? "agent",
          routeTarget: routeTarget ?? null,
        });
      }
      logger.info({ phoneNumber: phone_number, provider: provider.name, routeType }, "[numbers/admin/provision] DID provisioned");
      res.json({ message: "Number provisioned successfully", number: phone_number, routeType, routeTarget });
      return;
    } catch (err: any) {
      logger.error({ err: err?.message, phoneNumber: phone_number }, "[numbers/admin/provision] Provider error");
      res.status(502).json({ error: "provider_error", message: err?.message ?? "Provisioning failed." });
      return;
    }
  }

  // Local pool fallback
  const existing = await PhoneNumberModel.findOne({ number: phone_number });
  if (existing) {
    await PhoneNumberModel.updateOne({ _id: existing._id }, {
      assignedAt: now,
      userId: routeType === "agent" ? routeTarget : null,
      routeType: routeType ?? "agent",
      routeTarget: routeTarget ?? null,
    });
  } else {
    await PhoneNumberModel.create({
      _id: randomUUID(),
      number: phone_number,
      userId: routeType === "agent" ? routeTarget : null,
      assignedAt: now,
      source: "local",
      routeType: routeType ?? "agent",
      routeTarget: routeTarget ?? null,
    });
  }

  logger.info({ phoneNumber: phone_number, routeType }, "[numbers/admin/provision] DID created in local pool");
  res.json({ message: "Number provisioned successfully", number: phone_number, routeType, routeTarget });
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

  if (isLocked(oldNumber.assignedAt)) {
    const until = getLockedUntil(oldNumber.assignedAt)!;
    const daysLeft = Math.ceil((until.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    res.status(403).json({
      error: "number_locked",
      message: `This number is locked for ${daysLeft} more day${daysLeft !== 1 ? "s" : ""}. Numbers cannot be changed within 30 days of assignment.`,
      lockedUntil: until.toISOString(),
    });
    return;
  }

  const availableNum = await PhoneNumberModel.findOne({ number: newPhoneNumber, userId: null });
  if (!availableNum) {
    res.status(404).json({
      error: "number_unavailable",
      message: "The requested phone number is not available. Please choose a different number.",
    });
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
