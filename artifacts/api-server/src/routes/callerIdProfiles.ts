/**
 * Caller ID Profile Routes
 *
 * Allows users to request additional outbound caller ID numbers beyond their
 * personal verified mobile.  Admin approval is required before a profile can
 * be used on outbound calls (anti-spoofing gate).
 *
 * User endpoints:
 *   GET    /caller-id-profiles          — list own profiles
 *   POST   /caller-id-profiles          — request a new profile
 *   PATCH  /caller-id-profiles/:id      — update name / set default
 *   DELETE /caller-id-profiles/:id      — delete own profile
 *
 * Admin endpoints:
 *   GET    /admin/caller-id-profiles           — list all profiles (paginated)
 *   PATCH  /admin/caller-id-profiles/:id/approve — approve a profile
 *   PATCH  /admin/caller-id-profiles/:id/reject  — reject a profile
 */

import { Router, type IRouter } from "express";
import { connectDB, CallerIdProfileModel } from "@workspace/db";
import { randomUUID } from "crypto";
import { normalizePhoneNumber } from "../lib/phoneNormalize";
import { logger } from "../lib/logger";
import { parsePageLimit } from "../lib/pagination";

const router: IRouter = Router();

// ── User: list own profiles ──────────────────────────────────────────────────

router.get("/caller-id-profiles", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;

  const profiles = await CallerIdProfileModel.find({ userId })
    .sort({ createdAt: -1 })
    .lean();

  res.json({ profiles: profiles.map((p: any) => ({ ...p, id: p._id })) });
});

// ── User: request a new profile ──────────────────────────────────────────────

router.post("/caller-id-profiles", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId   = (req as any).user.id;
  const { number: rawNumber, name, isDefault } = req.body;

  if (!rawNumber || !name) {
    res.status(400).json({ error: "number and name are required" });
    return;
  }

  const norm = normalizePhoneNumber(String(rawNumber).trim());
  if (!norm.ok) {
    res.status(400).json({ error: "Invalid phone number", detail: norm.reason });
    return;
  }
  const number = norm.e164;

  const existing = await CallerIdProfileModel.findOne({ userId, number }).lean();
  if (existing) {
    res.status(409).json({ error: "A profile for this number already exists" });
    return;
  }

  if (isDefault) {
    await CallerIdProfileModel.updateMany({ userId, isDefault: true }, { isDefault: false });
  }

  const profile = await CallerIdProfileModel.create({
    _id:       randomUUID(),
    userId,
    number,
    name:      String(name).slice(0, 60),
    status:    "pending",
    isDefault: Boolean(isDefault),
  });

  logger.info(
    { userId, profileId: String(profile._id), number, isDefault: Boolean(isDefault) },
    "[callerIdProfiles] New caller ID profile requested — pending admin approval",
  );

  res.status(201).json({ profile: { ...profile.toObject(), id: profile._id } });
});

// ── User: update name / isDefault ────────────────────────────────────────────

router.patch("/caller-id-profiles/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId    = (req as any).user.id;
  const profileId = req.params.id;
  const { name, isDefault } = req.body;

  const profile = await CallerIdProfileModel.findOne({ _id: profileId, userId });
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  if (name !== undefined)      profile.name      = String(name).slice(0, 60);
  if (isDefault !== undefined) {
    if (Boolean(isDefault)) {
      await CallerIdProfileModel.updateMany(
        { userId, _id: { $ne: profileId }, isDefault: true },
        { isDefault: false },
      );
    }
    profile.isDefault = Boolean(isDefault);
  }

  await profile.save();
  res.json({ profile: { ...profile.toObject(), id: profile._id } });
});

// ── User: delete own profile ─────────────────────────────────────────────────

router.delete("/caller-id-profiles/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId    = (req as any).user.id;
  const profileId = req.params.id;

  const result = await CallerIdProfileModel.deleteOne({ _id: profileId, userId });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  res.json({ ok: true });
});

// ── Admin: list all profiles ─────────────────────────────────────────────────

router.get("/admin/caller-id-profiles", async (req, res) => {
  if (!req.isAuthenticated() || !(req as any).user.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await connectDB();

  const { page, limit, skip } = parsePageLimit(req.query);
  const statusFilter = req.query.status as string | undefined;
  const filter: Record<string, unknown> = statusFilter ? { status: statusFilter } : {};

  const [profiles, total] = await Promise.all([
    CallerIdProfileModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CallerIdProfileModel.countDocuments(filter),
  ]);

  res.json({
    profiles: profiles.map((p: any) => ({ ...p, id: p._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// ── Admin: approve ───────────────────────────────────────────────────────────

router.patch("/admin/caller-id-profiles/:id/approve", async (req, res) => {
  if (!req.isAuthenticated() || !(req as any).user.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await connectDB();
  const adminId   = (req as any).user.id;
  const profileId = req.params.id;

  const profile = await CallerIdProfileModel.findById(profileId);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  profile.status = "approved";
  profile.reason = req.body.reason ?? undefined;
  await profile.save();

  logger.info(
    { adminId, profileId, userId: profile.userId, number: profile.number },
    "[callerIdProfiles] Admin approved caller ID profile",
  );

  res.json({ profile: { ...profile.toObject(), id: profile._id } });
});

// ── Admin: reject ────────────────────────────────────────────────────────────

router.patch("/admin/caller-id-profiles/:id/reject", async (req, res) => {
  if (!req.isAuthenticated() || !(req as any).user.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await connectDB();
  const adminId   = (req as any).user.id;
  const profileId = req.params.id;

  const profile = await CallerIdProfileModel.findById(profileId);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  profile.status = "rejected";
  profile.reason = req.body.reason ?? undefined;
  await profile.save();

  logger.info(
    { adminId, profileId, userId: profile.userId, number: profile.number, reason: profile.reason },
    "[callerIdProfiles] Admin rejected caller ID profile",
  );

  res.json({ profile: { ...profile.toObject(), id: profile._id } });
});

export default router;
