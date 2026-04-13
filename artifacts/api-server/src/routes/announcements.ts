import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { connectDB, AnnouncementModel, AnnouncementViewModel } from "@workspace/db";

const router: IRouter = Router();

router.get("/announcements", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();

  const user = (req as any).user;
  const role: string = user.role ?? "user";

  const now = new Date();
  const targetFilter = role === "reseller"
    ? { target: { $in: ["all", "resellers"] } }
    : { target: { $in: ["all", "users"] } };

  const announcements = await AnnouncementModel.find({
    isActive: true,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
    ...targetFilter,
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  if (announcements.length === 0) {
    res.json({ announcements: [] });
    return;
  }

  const ids = announcements.map((a) => a._id);
  const views = await AnnouncementViewModel.find({
    announcementId: { $in: ids },
    userId: user.id,
  })
    .select("announcementId")
    .lean();

  const viewedSet = new Set(views.map((v) => v.announcementId));

  res.json({
    announcements: announcements.map((a) => ({
      ...a,
      id: a._id,
      viewed: viewedSet.has(a._id),
    })),
  });
});

router.post("/announcements/:announcementId/view", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();

  const { announcementId } = req.params;
  const userId = (req as any).user.id;

  try {
    await AnnouncementViewModel.updateOne(
      { announcementId, userId },
      { $setOnInsert: { _id: randomUUID(), announcementId, userId, viewedAt: new Date() } },
      { upsert: true },
    );
  } catch {
    // duplicate key on race condition is fine — already viewed
  }

  res.json({ ok: true });
});

export default router;
