/**
 * POST /api/admin/setup
 *
 * One-time bootstrap endpoint to create the first admin user.
 * Automatically locks itself once any admin account exists in the database —
 * subsequent calls return 403 so it cannot be used to hijack a live system.
 *
 * Two modes:
 *   1. Create — supply email + password + optional name
 *              Creates a brand-new admin user with emailVerified=true.
 *   2. Promote — supply email only (no password)
 *              Finds an existing user by email and promotes them to admin.
 *
 * Usage on VPS after deploy:
 *   curl -s -X POST https://your-domain/api/admin/setup \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"admin@example.com","password":"str0ng!","name":"Admin"}'
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { connectDB, UserModel } from "@workspace/db";
import { assignExtensionIfNeeded } from "../lib/extension";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/admin/setup", async (req: Request, res: Response) => {
  try {
    await connectDB();
  } catch {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const adminCount = await UserModel.countDocuments({ role: "admin" });
  if (adminCount > 0) {
    res.status(403).json({
      error: "Setup already complete. An admin account already exists.",
    });
    return;
  }

  const { email, password, name } = req.body as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const existing = await UserModel.findOne({ email: normalizedEmail }).lean();

  if (existing) {
    await UserModel.updateOne(
      { _id: existing._id },
      {
        $set: {
          role: "admin",
          isAdmin: true,
          approved: true,
          emailVerified: true,
          locked: false,
        },
      },
    );

    logger.info({ email: normalizedEmail }, "[Setup] Existing user promoted to admin");
    res.json({
      ok: true,
      mode: "promoted",
      message: `${normalizedEmail} has been promoted to admin. Log in to access the admin panel.`,
    });
    return;
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({
      error:
        "No existing user found with that email. Provide a password (min 8 chars) to create a new admin account.",
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = randomUUID();

  const user = await UserModel.create({
    _id: userId,
    email: normalizedEmail,
    name: name?.trim() || "Admin",
    passwordHash,
    role: "admin",
    isAdmin: true,
    approved: true,
    emailVerified: true,
    locked: false,
    coins: 0,
  });

  await assignExtensionIfNeeded(userId).catch(() => {});

  logger.info({ email: normalizedEmail, userId }, "[Setup] New admin user created");
  res.status(201).json({
    ok: true,
    mode: "created",
    message: `Admin account created for ${normalizedEmail}. You can now log in.`,
  });
});

export default router;
