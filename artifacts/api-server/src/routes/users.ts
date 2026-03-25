import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, UserModel } from "@workspace/db";

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
  res.json({ ...user, id: user._id });
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

export default router;
