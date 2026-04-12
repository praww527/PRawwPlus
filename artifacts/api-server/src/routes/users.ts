import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, UserModel } from "@workspace/db";
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
