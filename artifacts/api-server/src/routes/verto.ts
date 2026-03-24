import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, UserModel } from "@workspace/db";
import { assignExtensionIfNeeded } from "../lib/extension";

const router: IRouter = Router();

router.get("/verto/config", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;

  const ext = await assignExtensionIfNeeded(userId);
  if (!ext) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const wsUrl = process.env.FREESWITCH_WS_URL ?? "";
  const domain = process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";

  res.json({
    wsUrl,
    domain,
    extension: ext.extension,
    login: `${ext.extension}@${domain}`,
    password: ext.fsPassword,
    configured: Boolean(wsUrl),
  });
});

export default router;
