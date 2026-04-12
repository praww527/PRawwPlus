import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, UserModel } from "@workspace/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  clearSession,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { sendVerificationEmail, sendPasswordResetEmail, sendPhoneOtpEmail } from "../lib/email";
import { assignExtensionIfNeeded } from "../lib/extension";
import { getBaseUrl } from "../lib/appUrl";

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json({ user: req.isAuthenticated() ? req.user : null });
});

function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

router.post("/auth/signup", async (req: Request, res: Response) => {
  try {
    await connectDB();
  } catch (dbErr: any) {
    res.status(503).json({
      error: "Database unavailable. Please ensure MongoDB allows connections from this server's IP address.",
    });
    return;
  }
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const existing = await UserModel.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID();

    // When SMTP is not configured, auto-verify the account immediately so
    // users can log in without needing an email verification step.
    const smtpReady = isSmtpConfigured();
    const verificationToken = smtpReady ? generateToken() : undefined;
    const verificationTokenExpiry = smtpReady
      ? new Date(Date.now() + 24 * 60 * 60 * 1000)
      : undefined;

    const user = await UserModel.create({
      _id: userId,
      email: email.toLowerCase(),
      username: email.toLowerCase().split("@")[0],
      name: name || email.split("@")[0],
      passwordHash,
      emailVerified: !smtpReady,
      verificationToken,
      verificationTokenExpiry,
      coins: 0,
      subscriptionStatus: "inactive",
      isAdmin: false,
    });

    if (smtpReady && verificationToken) {
      const baseUrl = getBaseUrl(req);
      await sendVerificationEmail(email.toLowerCase(), verificationToken, baseUrl);
      res.status(201).json({
        message: "Account created. Please check your email to verify your account.",
      });
    } else {
      // SMTP not configured — auto-verified, log in immediately
      await assignExtensionIfNeeded(user._id as string);
      const sessionData: SessionData = {
        user: {
          id: user._id as string,
          username: user.username ?? (user._id as string),
          name: user.name ?? undefined,
          profileImage: user.profileImage ?? undefined,
          isAdmin: user.isAdmin,
        },
        access_token: generateToken(),
      };
      const sid = await createSession(sessionData);
      setSessionCookie(res, sid);
      res.status(201).json({
        message: "Account created. You are now logged in.",
        user: sessionData.user,
        token: sid,
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to create account" });
  }
});

router.post("/auth/login", async (req: Request, res: Response) => {
  try {
    try {
      await connectDB();
    } catch (dbErr: any) {
      res.status(503).json({
        error: dbErr?.message?.includes("MONGODB_URI")
          ? "Database not configured. Please set the MONGODB_URI secret."
          : "Database unavailable. Please try again shortly.",
      });
      return;
    }
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await UserModel.findOne({ email: email.toLowerCase() });
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (!user.emailVerified) {
      res.status(403).json({
        error: "email_not_verified",
        message: "Please verify your email before logging in.",
      });
      return;
    }

    await assignExtensionIfNeeded(user._id as string);

    const sessionData: SessionData = {
      user: {
        id: user._id as string,
        username: user.username ?? (user._id as string),
        name: user.name ?? undefined,
        profileImage: user.profileImage ?? undefined,
        isAdmin: user.isAdmin,
      },
      access_token: generateToken(),
    };

    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);
    // Include `token` so mobile apps can use Authorization: Bearer <token>
    res.json({ user: sessionData.user, token: sid });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/auth/verify-email", async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    const user = await UserModel.findOne({
      verificationToken: token,
      verificationTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      res.status(400).json({ error: "Invalid or expired verification link" });
      return;
    }

    user.emailVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpiry = undefined;
    await user.save();

    await assignExtensionIfNeeded(user._id as string);

    const sessionData: SessionData = {
      user: {
        id: user._id as string,
        username: user.username ?? (user._id as string),
        name: user.name ?? undefined,
        profileImage: user.profileImage ?? undefined,
        isAdmin: user.isAdmin,
      },
      access_token: generateToken(),
    };

    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);
    res.json({ message: "Email verified successfully", user: sessionData.user });
  } catch (err) {
    res.status(500).json({ error: "Verification failed" });
  }
});

router.post("/auth/resend-verification", async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const user = await UserModel.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.json({ message: "If that email exists, a verification link has been sent." });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ error: "Email is already verified" });
      return;
    }

    const verificationToken = generateToken();
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    user.verificationToken = verificationToken;
    user.verificationTokenExpiry = verificationTokenExpiry;
    await user.save();

    const baseUrl = getBaseUrl(req);
    await sendVerificationEmail(email.toLowerCase(), verificationToken, baseUrl);

    res.json({ message: "Verification email resent." });
  } catch (err) {
    res.status(500).json({ error: "Failed to resend verification email" });
  }
});

router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const user = await UserModel.findOne({ email: email.toLowerCase() });
    if (user) {
      const resetPasswordToken = generateToken();
      const resetPasswordTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
      user.resetPasswordToken = resetPasswordToken;
      user.resetPasswordTokenExpiry = resetPasswordTokenExpiry;
      await user.save();

      const baseUrl = getBaseUrl(req);
      await sendPasswordResetEmail(email.toLowerCase(), resetPasswordToken, baseUrl);
    }

    res.json({ message: "If that email exists, a password reset link has been sent." });
  } catch (err) {
    res.status(500).json({ error: "Failed to send reset email" });
  }
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({ error: "Token and password are required" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const user = await UserModel.findOne({
      resetPasswordToken: token,
      resetPasswordTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      res.status(400).json({ error: "Invalid or expired reset link" });
      return;
    }

    user.passwordHash = await bcrypt.hash(password, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpiry = undefined;
    await user.save();

    res.json({ message: "Password reset successfully. You can now log in." });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// ── Phone number OTP verification ────────────────────────────────────────────

function generateOtp(): string {
  const bytes = crypto.randomBytes(3);
  const num = (bytes.readUIntBE(0, 3) % 900000) + 100000;
  return String(num);
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (raw.startsWith("+")) return "+" + digits;
  if (digits.startsWith("0") && digits.length === 10) return "+27" + digits.slice(1);
  if (digits.length >= 10) return "+" + digits;
  return null;
}

router.post("/auth/phone/send-otp", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    await connectDB();
    const userId = (req as any).user.id;
    const { phone } = req.body as { phone?: string };

    if (!phone || typeof phone !== "string") {
      res.status(400).json({ error: "Phone number is required" });
      return;
    }

    const normalized = normalizePhone(phone.trim());
    if (!normalized) {
      res.status(400).json({ error: "Invalid phone number. Use international format, e.g. +27821234567" });
      return;
    }

    const existing = await UserModel.findOne({
      phone: normalized,
      _id: { $ne: userId },
    });
    if (existing) {
      res.status(409).json({ error: "This phone number is already registered to another account" });
      return;
    }

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await UserModel.updateOne(
      { _id: userId },
      { $set: { phone: normalized, phoneVerified: false, phoneOtp: otp, phoneOtpExpiry: otpExpiry } },
    );

    const user = await UserModel.findById(userId).select("email name").lean();
    const smtpReady = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

    if (smtpReady && user?.email) {
      try {
        await sendPhoneOtpEmail(user.email, normalized, otp);
      } catch (emailErr) {
        console.warn("[auth] Failed to send OTP email:", emailErr);
      }
    }

    const devMode = process.env.NODE_ENV !== "production";
    res.json({
      message: smtpReady
        ? `Verification code sent to ${user?.email ?? "your email"}. Check your inbox.`
        : `Verification code generated. Check server logs or use the code below (dev mode only).`,
      phone: normalized,
      ...(devMode && !smtpReady ? { otp } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to send OTP" });
  }
});

router.post("/auth/phone/verify-otp", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    await connectDB();
    const userId = (req as any).user.id;
    const { otp } = req.body as { otp?: string };

    if (!otp || typeof otp !== "string") {
      res.status(400).json({ error: "OTP is required" });
      return;
    }

    const user = await UserModel.findById(userId).select("phone phoneOtp phoneOtpExpiry phoneVerified");
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.phone || !user.phoneOtp) {
      res.status(400).json({ error: "No pending phone verification. Please request a new code." });
      return;
    }

    if (!user.phoneOtpExpiry || user.phoneOtpExpiry < new Date()) {
      res.status(400).json({ error: "Verification code has expired. Please request a new one." });
      return;
    }

    if (otp.trim() !== user.phoneOtp) {
      res.status(400).json({ error: "Invalid verification code. Please try again." });
      return;
    }

    await UserModel.updateOne(
      { _id: userId },
      { $set: { phoneVerified: true }, $unset: { phoneOtp: 1, phoneOtpExpiry: 1 } },
    );

    res.json({ message: "Phone number verified successfully", phone: user.phone });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to verify OTP" });
  }
});

router.get("/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.redirect("/");
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ message: "Logged out" });
});

export default router;
