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
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/email";
import { assignExtensionIfNeeded } from "../lib/extension";

const router: IRouter = Router();

function getBaseUrl(req: Request): string {
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers["host"] as string) || "localhost";
  return `${proto}://${host}`;
}

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

router.post("/auth/signup", async (req: Request, res: Response) => {
  try {
    await connectDB();
  } catch (dbErr: any) {
    res.status(503).json({
      error: "Database unavailable. Please ensure MongoDB Atlas allows connections from this server. Check your Network Access settings.",
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
    const verificationToken = generateToken();
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const userId = crypto.randomUUID();

    await UserModel.create({
      _id: userId,
      email: email.toLowerCase(),
      username: email.toLowerCase().split("@")[0],
      name: name || email.split("@")[0],
      passwordHash,
      emailVerified: false,
      verificationToken,
      verificationTokenExpiry,
      coins: 0,
      subscriptionStatus: "inactive",
      isAdmin: false,
    });

    const baseUrl = getBaseUrl(req);
    await sendVerificationEmail(email.toLowerCase(), verificationToken, baseUrl);

    res.status(201).json({
      message: "Account created. Please check your email to verify your account.",
    });
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
    res.json({ user: sessionData.user });
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

router.get("/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.redirect("/");
});

export default router;
