import { Router, type IRouter } from "express";
import { randomUUID, randomBytes } from "crypto";
import {
  connectDB,
  UserModel,
  OrganisationModel,
  OrgInviteModel,
} from "@workspace/db";
import { sendOrgInviteEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function requireOrgOwnerOrAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = req.user as any;
  if (!user.orgId) {
    res.status(403).json({ error: "You are not part of an organisation" });
    return;
  }
  if (user.orgRole !== "owner" && user.orgRole !== "admin") {
    res.status(403).json({ error: "Organisation owner or admin access required" });
    return;
  }
  next();
}

function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

router.post("/org", requireAuth, async (req, res) => {
  await connectDB();
  const userId = (req as any).user.id;

  const existing = await UserModel.findById(userId).select("orgId orgRole").lean();
  if (existing?.orgId) {
    res.status(400).json({ error: "You are already part of an organisation" });
    return;
  }

  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Organisation name is required" });
    return;
  }

  const orgId = randomUUID();
  await OrganisationModel.create({
    _id: orgId,
    name: name.trim(),
    ownerId: userId,
    coins: 0,
    totalCallsUsed: 0,
    totalCoinsUsed: 0,
  });

  await UserModel.updateOne(
    { _id: userId },
    { $set: { orgId, orgRole: "owner" } },
  );

  const org = await OrganisationModel.findById(orgId).lean();
  res.json({ ok: true, org });
});

router.get("/org/me", requireAuth, async (req, res) => {
  await connectDB();
  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId).select("orgId orgRole").lean();

  if (!user?.orgId) {
    res.json({ org: null });
    return;
  }

  const [org, members, pendingInvites] = await Promise.all([
    OrganisationModel.findById(user.orgId).lean(),
    UserModel.find({ orgId: user.orgId })
      .select("_id name email username orgRole totalCallsUsed totalCoinsUsed coins createdAt")
      .lean(),
    user.orgRole === "owner" || user.orgRole === "admin"
      ? OrgInviteModel.find({ orgId: user.orgId, acceptedAt: null, expiresAt: { $gt: new Date() } }).lean()
      : Promise.resolve([]),
  ]);

  res.json({
    org,
    role: user.orgRole,
    members: members.map((m: any) => ({ ...m, id: String(m._id) })),
    pendingInvites: (pendingInvites as any[]).map((i: any) => ({ ...i, id: String(i._id) })),
  });
});

router.post("/org/invite", requireOrgOwnerOrAdmin, async (req, res) => {
  await connectDB();
  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId).select("orgId orgRole name email").lean();
  if (!user?.orgId) {
    res.status(403).json({ error: "No organisation" });
    return;
  }

  const { email, role } = req.body;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  const inviteRole = role === "admin" ? "admin" : "member";

  const invitee = await UserModel.findOne({ email: email.toLowerCase().trim() })
    .select("orgId")
    .lean();
  if (invitee?.orgId) {
    res.status(400).json({ error: "This user is already part of an organisation" });
    return;
  }

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await OrgInviteModel.findOneAndUpdate(
    { orgId: user.orgId, email: email.toLowerCase().trim(), acceptedAt: null },
    {
      $set: {
        orgId: user.orgId,
        email: email.toLowerCase().trim(),
        token,
        role: inviteRole,
        createdBy: userId,
        expiresAt,
        acceptedAt: null,
      },
      $setOnInsert: { _id: randomUUID() },
    },
    { upsert: true, new: true },
  );

  const org = await OrganisationModel.findById(user.orgId).select("name").lean();
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  try {
    await sendOrgInviteEmail(email.toLowerCase().trim(), {
      orgName: (org as any)?.name ?? "an organisation",
      inviterName: (user as any)?.name ?? (user as any)?.email ?? "A team member",
      token,
      baseUrl,
    });
  } catch (err) {
    logger.warn({ err }, "[Org] Invite email send failed");
  }

  res.json({ ok: true, message: `Invite sent to ${email}` });
});

router.post("/org/accept-invite", requireAuth, async (req, res) => {
  await connectDB();
  const userId = (req as any).user.id;
  const { token } = req.body;

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  const invite = await OrgInviteModel.findOne({ token, acceptedAt: null, expiresAt: { $gt: new Date() } });
  if (!invite) {
    res.status(404).json({ error: "Invite not found or expired" });
    return;
  }

  const user = await UserModel.findById(userId).select("orgId email").lean();
  if (user?.orgId) {
    res.status(400).json({ error: "You are already part of an organisation" });
    return;
  }

  invite.acceptedAt = new Date();
  await invite.save();

  await UserModel.updateOne(
    { _id: userId },
    { $set: { orgId: invite.orgId, orgRole: invite.role } },
  );

  const org = await OrganisationModel.findById(invite.orgId).lean();
  res.json({ ok: true, org });
});

router.get("/org/invite/:token", async (req, res) => {
  await connectDB();
  const { token } = req.params;
  const invite = await OrgInviteModel.findOne({ token, acceptedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!invite) {
    res.status(404).json({ error: "Invite not found or expired" });
    return;
  }
  const org = await OrganisationModel.findById((invite as any).orgId).select("name").lean();
  res.json({
    valid: true,
    orgName: (org as any)?.name ?? "Unknown",
    role: (invite as any).role,
    email: (invite as any).email,
  });
});

router.delete("/org/members/:memberId", requireOrgOwnerOrAdmin, async (req, res) => {
  await connectDB();
  const actorId = (req as any).user.id;
  const { memberId } = req.params;

  const actor = await UserModel.findById(actorId).select("orgId orgRole").lean();
  if (!actor?.orgId) {
    res.status(403).json({ error: "No organisation" });
    return;
  }

  if (memberId === actorId) {
    res.status(400).json({ error: "You cannot remove yourself" });
    return;
  }

  const member = await UserModel.findById(memberId).select("orgId orgRole").lean();
  if (!member || member.orgId !== actor.orgId) {
    res.status(404).json({ error: "Member not found in your organisation" });
    return;
  }

  if (member.orgRole === "owner") {
    res.status(400).json({ error: "Cannot remove the organisation owner" });
    return;
  }

  await UserModel.updateOne(
    { _id: memberId },
    { $unset: { orgId: 1, orgRole: 1 } },
  );

  res.json({ ok: true, message: "Member removed from organisation" });
});

router.post("/org/leave", requireAuth, async (req, res) => {
  await connectDB();
  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId).select("orgId orgRole").lean();

  if (!user?.orgId) {
    res.status(400).json({ error: "You are not part of an organisation" });
    return;
  }
  if (user.orgRole === "owner") {
    res.status(400).json({ error: "Organisation owners cannot leave. Transfer ownership or delete the organisation." });
    return;
  }

  await UserModel.updateOne({ _id: userId }, { $unset: { orgId: 1, orgRole: 1 } });
  res.json({ ok: true });
});

router.post("/org/topup", requireOrgOwnerOrAdmin, async (req, res) => {
  await connectDB();
  const userId = (req as any).user.id;
  const user = await UserModel.findById(userId).select("orgId").lean();
  if (!user?.orgId) {
    res.status(403).json({ error: "No organisation" });
    return;
  }

  const { amount } = req.body;
  if (!amount || amount < 10) {
    res.status(400).json({ error: "Minimum top-up amount is R10" });
    return;
  }

  const COIN_VALUE = 0.9;
  const coinsAdded = Math.floor(amount / COIN_VALUE);

  const { randomUUID: uuid } = await import("crypto");
  const { PaymentModel } = await import("@workspace/db");
  const { getBaseUrl } = await import("../lib/appUrl");

  const paymentId = randomUUID();
  const base = getBaseUrl(req);

  const crypto = await import("crypto");
  const rawMerchantId = process.env.PAYFAST_MERCHANT_ID?.trim() || undefined;
  const rawMerchantKey = process.env.PAYFAST_MERCHANT_KEY?.trim() || undefined;
  const merchantId = rawMerchantId ?? "10000100";
  const merchantKey = rawMerchantKey ?? "46f0cd694581a";
  const passphrase = process.env.PAYFAST_PASSPHRASE?.trim() || undefined;
  const isSandbox = !rawMerchantId;
  const paymentUrl = isSandbox
    ? "https://sandbox.payfast.co.za/eng/process"
    : "https://www.payfast.co.za/eng/process";

  await PaymentModel.create({
    _id: paymentId,
    userId,
    amount,
    coinsAdded,
    status: "pending",
    paymentType: "org_topup",
    meta: { orgId: user.orgId },
  });

  const fields: Record<string, string> = {
    merchant_id:  merchantId,
    merchant_key: merchantKey,
    return_url:   `${base}/team?payment=success`,
    cancel_url:   `${base}/team?payment=cancelled`,
    notify_url:   `${base}/api/payments/webhook`,
    m_payment_id: paymentId,
    amount:       amount.toFixed(2),
    item_name:    `Organisation Wallet Top-Up R${amount} (${coinsAdded} coins)`,
    custom_str1:  userId,
    custom_str2:  "org_topup",
    custom_str3:  user.orgId,
  };

  const signatureStr =
    Object.entries(fields)
      .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`)
      .join("&") +
    (passphrase
      ? `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`
      : "");
  fields.signature = crypto.default.createHash("md5").update(signatureStr).digest("hex");

  res.json({
    paymentUrl,
    amount: amount.toFixed(2),
    itemName: `Organisation Top-Up R${amount} (${coinsAdded} coins)`,
    coinsAdded,
    paymentId,
    formFields: fields,
  });
});

export default router;
