/**
 * FreeSWITCH admin routes — status, config push, diagnostics.
 * All routes require the requesting user to be an admin.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eslStatus } from "../lib/freeswitchESL";
import { pushFreeSwitchConfig, testSSHConnection } from "../lib/freeswitchSSH";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response): boolean {
  if (!req.isAuthenticated() || !(req as any).user?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

/** GET /api/freeswitch/status — ESL connection + config state */
router.get("/freeswitch/status", (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const esl = eslStatus();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");

  res.json({
    esl,
    config: {
      domain:       process.env.FREESWITCH_DOMAIN ?? null,
      wsUrl:        process.env.FREESWITCH_WS_URL ?? null,
      appUrl,
      directoryUrl: appUrl ? `${appUrl}/api/freeswitch/directory` : null,
      webhookUrl:   appUrl ? `${appUrl}/api/calls/webhook/freeswitch` : null,
      sshKeySet:    Boolean(process.env.FREESWITCH_SSH_KEY),
    },
  });
});

/** POST /api/freeswitch/configure — push XML config to FreeSWITCH via SSH */
router.post("/freeswitch/configure", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const result = await pushFreeSwitchConfig();
  res.status(result.success ? 200 : 500).json(result);
});

/** POST /api/freeswitch/test-ssh — verify SSH connectivity to the FreeSWITCH server */
router.post("/freeswitch/test-ssh", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const result = await testSSHConnection();
  res.status(result.ok ? 200 : 500).json(result);
});

export default router;
