import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, UserModel, PhoneNumberModel } from "@workspace/db";
import { lookupUserByPhone } from "../lib/phoneResolver";

const router: IRouter = Router();

router.get("/users/me", async (req: Request, res: Response) => {
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
  const { fsPassword: _fsPassword, extension: _extension, phoneOtp: _phoneOtp, phoneOtpExpiry: _phoneOtpExpiry, ...safeUser } = user as any;
  res.json({ ...safeUser, id: user._id });
});

router.patch("/users/me/profile-image", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { profileImage } = req.body;
  if (!profileImage || typeof profileImage !== "string") {
    res.status(400).json({ error: "profileImage is required" });
    return;
  }
  if (profileImage.length > 4_000_000) {
    res.status(400).json({ error: "Image too large (max 4MB)" });
    return;
  }
  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: { profileImage } },
    { new: true }
  ).lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ message: "Profile image updated", profileImage: (user as any).profileImage });
});

router.patch("/users/me/name", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { name } = req.body;
  if (!name || typeof name !== "string" || name.trim().length < 1) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: { name: name.trim().slice(0, 80) } },
    { new: true }
  ).lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ message: "Name updated", name: (user as any).name });
});

router.post("/users/me/request-verification", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { docType, docUrl, policyAgreed } = req.body;
  if (!docType || !["id", "company"].includes(docType)) {
    res.status(400).json({ error: "docType must be 'id' or 'company'" });
    return;
  }
  if (!docUrl || typeof docUrl !== "string") {
    res.status(400).json({ error: "docUrl is required" });
    return;
  }
  if (docUrl.length > 5_000_000) {
    res.status(400).json({ error: "Document too large" });
    return;
  }
  if (!policyAgreed) {
    res.status(400).json({ error: "You must agree to the Responsible Use Policy before submitting." });
    return;
  }
  const update: Record<string, any> = {
    verificationStatus: "pending",
    verificationDocType: docType,
    verificationDocUrl: docUrl,
    verificationDocSubmittedAt: new Date(),
    policyAgreedAt: new Date(),
  };
  const user = await UserModel.findByIdAndUpdate(userId, { $set: update }, { new: true }).lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ message: "Verification request submitted. An admin will review your document." });
});

router.post("/users/me/agree-policy", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  await UserModel.updateOne({ _id: userId }, { $set: { policyAgreedAt: new Date() } });
  res.json({ message: "Responsible Use Policy agreed." });
});

router.get("/users/phone-lookup", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const { phone } = req.query as { phone?: string };

  if (!phone || typeof phone !== "string" || phone.trim().length < 7) {
    res.status(400).json({ error: "phone query parameter is required" });
    return;
  }

  try {
    const result = await lookupUserByPhone(phone.trim());
    if (!result) {
      res.json({ found: false });
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Lookup failed" });
  }
});

/**
 * GET /api/users/directory?q=...
 * Name-based colleague lookup — returns name + DID number (no extensions exposed).
 * Available to any authenticated user for conference invite name resolution.
 */
router.get("/users/directory", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await connectDB();
  const requestingUserId = String((req as any).user.id);
  const q = req.query.q ? String(req.query.q).trim() : "";
  if (!q || q.length < 2) { res.json({ users: [] }); return; }

  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(safeQ, "i");

  const users = await UserModel.find({
    _id: { $ne: requestingUserId },
    $or: [{ name: regex }, { username: regex }],
  })
    .select("_id name username")
    .limit(10)
    .lean();

  const userIds = users.map((u: any) => String(u._id));
  const phones = userIds.length
    ? await PhoneNumberModel.find({ userId: { $in: userIds } }).select("userId number").lean()
    : [];
  const didMap = Object.fromEntries(phones.map((p: any) => [String(p.userId), p.number]));

  res.json({
    users: users.map((u: any) => ({
      id:       String(u._id),
      name:     u.name ?? u.username ?? String(u._id),
      username: u.username ?? null,
      did:      didMap[String(u._id)] ?? null,
    })),
  });
});

router.get("/users/extension-lookup", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const { extension } = req.query as { extension?: string };
  if (!extension || typeof extension !== "string") {
    res.status(400).json({ error: "extension query parameter is required" });
    return;
  }
  const extNum = parseInt(extension.trim(), 10);
  if (isNaN(extNum)) {
    res.json({ found: false });
    return;
  }
  try {
    const user = await UserModel.findOne({ extension: extNum })
      .select("name username email phone phoneVerified")
      .lean();
    if (!user) {
      res.json({ found: false });
      return;
    }
    const displayName = user.name ?? user.username ?? user.email ?? String(extNum);
    res.json({
      found: true,
      name: displayName,
      // Only return the phone number if it has been verified — unverified numbers
      // may be incorrect and must not be presented to other users as caller ID.
      phone: user.phoneVerified ? (user.phone ?? null) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Lookup failed" });
  }
});

router.get("/users/call-forwarding", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;

  const user = await UserModel.findById(userId)
    .select(
      "callForwardAlwaysEnabled callForwardAlwaysTo " +
      "callForwardBusyEnabled callForwardBusyTo " +
      "callForwardNoAnswerEnabled callForwardNoAnswerTo " +
      "callForwardUnavailableEnabled callForwardUnavailableTo",
    )
    .lean();

  res.json({
    callForwardAlwaysEnabled: user?.callForwardAlwaysEnabled ?? false,
    callForwardAlwaysTo: user?.callForwardAlwaysTo ?? null,
    callForwardBusyEnabled: user?.callForwardBusyEnabled ?? false,
    callForwardBusyTo: user?.callForwardBusyTo ?? null,
    callForwardNoAnswerEnabled: user?.callForwardNoAnswerEnabled ?? false,
    callForwardNoAnswerTo: user?.callForwardNoAnswerTo ?? null,
    callForwardUnavailableEnabled: user?.callForwardUnavailableEnabled ?? false,
    callForwardUnavailableTo: user?.callForwardUnavailableTo ?? null,
  });
});

router.patch("/users/call-forwarding", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const body = req.body as Record<string, unknown>;

  const update: Record<string, unknown> = {};

  const validateTarget = (v: unknown, field: string): string | null => {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v !== "string") {
      throw new Error(`${field} must be a string`);
    }
    const s = v.trim();
    // Allow extension (1000-9999), E.164-ish numbers, or SIP URI.
    if (/^[1-9]\d{3}$/.test(s)) return s;
    if (/^\+?[1-9]\d{6,14}$/.test(s)) return s;
    if (/^sip:/i.test(s)) return s;
    throw new Error(`${field} must be an extension, phone number, or sip: URI`);
  };

  try {
    if ("callForwardAlwaysEnabled" in body) update.callForwardAlwaysEnabled = Boolean(body.callForwardAlwaysEnabled);
    if ("callForwardAlwaysTo" in body) {
      const target = validateTarget(body.callForwardAlwaysTo, "callForwardAlwaysTo");
      update.callForwardAlwaysTo = target || undefined;
    }

    if ("callForwardBusyEnabled" in body) update.callForwardBusyEnabled = Boolean(body.callForwardBusyEnabled);
    if ("callForwardBusyTo" in body) {
      const target = validateTarget(body.callForwardBusyTo, "callForwardBusyTo");
      update.callForwardBusyTo = target || undefined;
    }

    if ("callForwardNoAnswerEnabled" in body) update.callForwardNoAnswerEnabled = Boolean(body.callForwardNoAnswerEnabled);
    if ("callForwardNoAnswerTo" in body) {
      const target = validateTarget(body.callForwardNoAnswerTo, "callForwardNoAnswerTo");
      update.callForwardNoAnswerTo = target || undefined;
    }

    if ("callForwardUnavailableEnabled" in body) update.callForwardUnavailableEnabled = Boolean(body.callForwardUnavailableEnabled);
    if ("callForwardUnavailableTo" in body) {
      const target = validateTarget(body.callForwardUnavailableTo, "callForwardUnavailableTo");
      update.callForwardUnavailableTo = target || undefined;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid call forwarding settings";
    res.status(400).json({ error: message });
    return;
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  await UserModel.updateOne({ _id: userId }, { $set: update });

  const updated = await UserModel.findById(userId)
    .select(
      "callForwardAlwaysEnabled callForwardAlwaysTo " +
      "callForwardBusyEnabled callForwardBusyTo " +
      "callForwardNoAnswerEnabled callForwardNoAnswerTo " +
      "callForwardUnavailableEnabled callForwardUnavailableTo",
    )
    .lean();

  res.json({
    message: "Call forwarding updated",
    callForwarding: {
      callForwardAlwaysEnabled: updated?.callForwardAlwaysEnabled ?? false,
      callForwardAlwaysTo: updated?.callForwardAlwaysTo ?? null,
      callForwardBusyEnabled: updated?.callForwardBusyEnabled ?? false,
      callForwardBusyTo: updated?.callForwardBusyTo ?? null,
      callForwardNoAnswerEnabled: updated?.callForwardNoAnswerEnabled ?? false,
      callForwardNoAnswerTo: updated?.callForwardNoAnswerTo ?? null,
      callForwardUnavailableEnabled: updated?.callForwardUnavailableEnabled ?? false,
      callForwardUnavailableTo: updated?.callForwardUnavailableTo ?? null,
    },
  });
});

const RINGTONES = ["default", "classic", "digital", "soft", "urgent", "none"] as const;

router.patch("/users/settings", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;

  const {
    ringtone,
    ringtoneDuration,
    dnd,
    freeswitchHost,
    freeswitchPort,
  } = req.body as {
    ringtone?: string;
    ringtoneDuration?: number;
    dnd?: boolean;
    freeswitchHost?: string;
    freeswitchPort?: number;
  };

  const update: Record<string, unknown> = {};

  if (ringtone !== undefined) {
    if (!RINGTONES.includes(ringtone as any)) {
      res.status(400).json({ error: `Invalid ringtone. Choose from: ${RINGTONES.join(", ")}` });
      return;
    }
    update.ringtone = ringtone;
  }

  if (ringtoneDuration !== undefined) {
    const d = Number(ringtoneDuration);
    if (isNaN(d) || d < 5 || d > 120) {
      res.status(400).json({ error: "ringtoneDuration must be between 5 and 120 seconds" });
      return;
    }
    update.ringtoneDuration = d;
  }

  if (dnd !== undefined) {
    update.dnd = Boolean(dnd);
  }

  if (freeswitchHost !== undefined) {
    if (typeof freeswitchHost !== "string" || freeswitchHost.length > 253) {
      res.status(400).json({ error: "Invalid freeswitchHost" });
      return;
    }
    update.freeswitchHost = freeswitchHost.trim();
  }

  if (freeswitchPort !== undefined) {
    const p = Number(freeswitchPort);
    if (isNaN(p) || p < 1 || p > 65535) {
      res.status(400).json({ error: "freeswitchPort must be between 1 and 65535" });
      return;
    }
    update.freeswitchPort = p;
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  await UserModel.updateOne({ _id: userId }, { $set: update });

  const updated = await UserModel.findById(userId)
    .select("ringtone ringtoneDuration dnd freeswitchHost freeswitchPort")
    .lean();

  res.json({
    message: "Settings updated",
    settings: {
      ringtone: updated?.ringtone ?? "default",
      ringtoneDuration: updated?.ringtoneDuration ?? 30,
      dnd: updated?.dnd ?? false,
      freeswitchHost: updated?.freeswitchHost ?? process.env.FREESWITCH_DOMAIN ?? "freeswitch.local",
      freeswitchPort: updated?.freeswitchPort ?? 5060,
    },
  });
});

const NOTIF_BOOL_KEYS = [
  "incomingCalls", "missedCalls", "voicemail", "lowBalance",
  "sms", "promotions", "weeklyReport", "sound", "vibration",
  "badge", "pushEnabled",
] as const;

router.patch("/users/notification-prefs", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const body = req.body as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  for (const key of NOTIF_BOOL_KEYS) {
    if (key in body) {
      update[`notificationPrefs.${key}`] = Boolean(body[key]);
    }
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No valid notification preference fields provided" });
    return;
  }

  await UserModel.updateOne({ _id: userId }, { $set: update });

  const updated = await UserModel.findById(userId)
    .select("notificationPrefs")
    .lean();

  const prefs = updated?.notificationPrefs ?? {};
  res.json({ message: "Notification preferences updated", notificationPrefs: prefs });
});

router.post("/users/push-token", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { token } = req.body as { token?: string };

  if (!token || typeof token !== "string" || !token.startsWith("ExponentPushToken[")) {
    res.status(400).json({ error: "Invalid Expo push token" });
    return;
  }

  await UserModel.updateOne({ _id: userId }, { $set: { expoPushToken: token } });
  res.json({ message: "Push token registered" });
});

router.delete("/users/push-token", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  await UserModel.updateOne({ _id: userId }, { $unset: { expoPushToken: 1 } });
  res.json({ message: "Push token removed" });
});

router.get("/users/vapid-public-key", (_req: Request, res: Response) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    res.status(503).json({ error: "Web push not configured on this server" });
    return;
  }
  res.json({ key });
});

router.post("/users/web-push-subscription", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { subscription } = req.body as {
    subscription?: { endpoint?: string; keys?: { auth?: string; p256dh?: string } };
  };

  if (!subscription?.endpoint || !subscription?.keys?.auth || !subscription?.keys?.p256dh) {
    res.status(400).json({ error: "Invalid push subscription" });
    return;
  }

  await UserModel.updateOne({ _id: userId }, { $set: { webPushSubscription: subscription } });
  res.json({ message: "Web push subscription saved" });
});

router.delete("/users/web-push-subscription", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  await UserModel.updateOne({ _id: userId }, { $unset: { webPushSubscription: 1 } });
  res.json({ message: "Web push subscription removed" });
});

router.post("/users/fcm-token", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { token } = req.body as { token?: string };

  if (!token || typeof token !== "string" || token.length < 10) {
    res.status(400).json({ error: "Invalid FCM token" });
    return;
  }

  await UserModel.updateOne({ _id: userId }, { $set: { fcmToken: token } });
  res.json({ message: "FCM token registered" });
});

router.delete("/users/fcm-token", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  await UserModel.updateOne({ _id: userId }, { $unset: { fcmToken: 1 } });
  res.json({ message: "FCM token removed" });
});

export default router;
