/**
 * Security Routes — Phase 4
 * 2FA (TOTP) setup/verify/disable + POPIA data export
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, UserModel, CallModel, CdrModel, BillingLedgerModel, AuditLogModel } from "@workspace/db";
import { generateTotpSecret, generateOtpAuthUrl, verifyTotp } from "../lib/totp";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: () => void): void {
  if (!(req as any).isAuthenticated?.()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ── TOTP 2FA Setup ─────────────────────────────────────────────────────────────

router.post("/security/2fa/setup", requireAuth, async (req, res) => {
  await connectDB();
  const userId = (req as any).user.id;

  const user = await UserModel.findById(userId).select("email username totpEnabled").lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if ((user as any).totpEnabled) {
    res.status(409).json({ error: "2FA is already enabled. Disable it first to re-setup." });
    return;
  }

  const secret  = generateTotpSecret();
  const email   = (user as any).email ?? (user as any).username ?? "user";
  const otpAuth = generateOtpAuthUrl(secret, email);

  await UserModel.findByIdAndUpdate(userId, {
    $set: { totpSecret: secret, totpVerified: false },
  });

  logger.info({ userId }, "[security] TOTP setup initiated");
  res.json({ secret, otpAuthUrl: otpAuth, message: "Scan the QR code and verify with a token to activate 2FA." });
});

router.post("/security/2fa/verify", requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: "token is required" }); return; }

  await connectDB();
  const userId = (req as any).user.id;
  const user   = await UserModel.findById(userId).select("totpSecret totpEnabled totpVerified").lean();

  if (!user || !(user as any).totpSecret) {
    res.status(400).json({ error: "2FA setup not initiated. Call /security/2fa/setup first." });
    return;
  }

  if (!(verifyTotp(String(token), (user as any).totpSecret))) {
    res.status(400).json({ error: "Invalid or expired token. Please try again." });
    return;
  }

  await UserModel.findByIdAndUpdate(userId, {
    $set: { totpEnabled: true, totpVerified: true },
  });

  logger.info({ userId }, "[security] TOTP enabled");
  res.json({ ok: true, message: "2FA has been enabled on your account." });
});

router.post("/security/2fa/disable", requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: "token is required to disable 2FA" }); return; }

  await connectDB();
  const userId = (req as any).user.id;
  const user   = await UserModel.findById(userId).select("totpSecret totpEnabled").lean();

  if (!user || !(user as any).totpEnabled) {
    res.status(400).json({ error: "2FA is not enabled on this account." });
    return;
  }

  if (!verifyTotp(String(token), (user as any).totpSecret!)) {
    res.status(400).json({ error: "Invalid token. Please verify your authenticator app code." });
    return;
  }

  await UserModel.findByIdAndUpdate(userId, {
    $unset: { totpSecret: 1, totpEnabled: 1, totpVerified: 1 },
  });

  logger.info({ userId }, "[security] TOTP disabled");
  res.json({ ok: true, message: "2FA has been disabled." });
});

router.get("/security/2fa/status", requireAuth, async (req, res) => {
  await connectDB();
  const user = await UserModel.findById((req as any).user.id)
    .select("totpEnabled totpVerified")
    .lean();

  res.json({
    enabled:  !!(user as any)?.totpEnabled,
    verified: !!(user as any)?.totpVerified,
  });
});

// ── Admin: validate a user's TOTP token ───────────────────────────────────────

router.post("/security/2fa/admin-check/:userId", requireAdmin, async (req, res) => {
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: "token is required" }); return; }

  await connectDB();
  const user = await UserModel.findById(req.params.userId)
    .select("totpSecret totpEnabled")
    .lean();

  if (!user || !(user as any).totpEnabled) {
    res.json({ valid: false, reason: "2FA not enabled for this user" });
    return;
  }

  const valid = verifyTotp(String(token), (user as any).totpSecret!);
  res.json({ valid });
});

// ── POPIA Data Export ─────────────────────────────────────────────────────────

router.post("/security/popia/export", requireAuth, async (req, res) => {
  await connectDB();
  const userId = (req as any).user.id;

  const [user, calls, cdrs, ledger, auditLogs] = await Promise.all([
    UserModel.findById(userId)
      .select("-passwordHash -totpSecret -fsPassword -webPushSubscription -__v")
      .lean(),
    CallModel.find({ $or: [{ userId }, { recipientUserId: userId }] })
      .sort({ createdAt: -1 }).limit(1000).lean(),
    CdrModel.find({ userId }).sort({ endedAt: -1 }).limit(1000).lean(),
    BillingLedgerModel.find({ userId }).sort({ createdAt: -1 }).limit(500).lean(),
    AuditLogModel.find({ actorId: userId }).sort({ createdAt: -1 }).limit(200).lean(),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    notice:     "This export contains all personal data held by PRaww+ for your account, in compliance with POPIA (Protection of Personal Information Act, South Africa).",
    profile:    user,
    calls:      calls.map((c: any) => ({ id: c._id, ...c })),
    cdr:        cdrs.map((c: any) => ({ id: c._id, ...c })),
    billingLedger: ledger.map((l: any) => ({ id: l._id, ...l })),
    auditTrail:  auditLogs.map((a: any) => ({ id: a._id, ...a })),
  };

  const filename = `popia-export-${userId}-${new Date().toISOString().slice(0,10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(exportData);

  logger.info({ userId }, "[security] POPIA data export requested");
});

// ── Admin: force-disable 2FA for a user (support action) ────────────────────

router.delete("/security/2fa/admin-reset/:userId", requireAdmin, async (req, res) => {
  await connectDB();
  await UserModel.findByIdAndUpdate(req.params.userId, {
    $unset: { totpSecret: 1, totpEnabled: 1, totpVerified: 1 },
  });
  logger.info({ userId: req.params.userId, adminId: (req as any).user.id }, "[security] Admin reset 2FA for user");
  res.json({ ok: true });
});

// ── Security Overview (admin) ─────────────────────────────────────────────────

router.get("/security/overview", requireAdmin, async (_req, res) => {
  await connectDB();
  const [total, twoFaEnabled, locked, pendingVerification] = await Promise.all([
    UserModel.countDocuments({}),
    UserModel.countDocuments({ totpEnabled: true }),
    UserModel.countDocuments({ locked: true }),
    UserModel.countDocuments({ verificationStatus: "pending" }),
  ]);
  res.json({
    totalUsers:          total,
    twoFaEnabledCount:   twoFaEnabled,
    twoFaAdoptionPct:    total > 0 ? Math.round((twoFaEnabled / total) * 100) : 0,
    lockedAccounts:      locked,
    pendingVerification,
    asOf:                new Date().toISOString(),
  });
});

export default router;
