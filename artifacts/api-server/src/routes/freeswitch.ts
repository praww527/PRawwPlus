/**
 * FreeSWITCH admin routes — status, config push, diagnostics.
 * Admin routes require the requesting user to be an admin.
 * The /lookup route is unauthenticated and intended for FreeSWITCH mod_curl.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eslStatus } from "../lib/freeswitchESL";
import { pushFreeSwitchConfig, testSSHConnection } from "../lib/freeswitchSSH";
import { getAppUrl } from "../lib/appUrl";
import { connectDB } from "@workspace/db";
import { resolvePhoneToExtension } from "../lib/phoneResolver";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response): boolean {
  if (!req.isAuthenticated() || !(req as any).user?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

/**
 * GET /api/freeswitch/lookup?number=0XXXXXXXXX
 *
 * Called internally by FreeSWITCH mod_curl during dialplan execution.
 * Receives a South African local-format phone number (0-prefixed, 10 digits)
 * and returns the registered user's extension as plain text, or an empty
 * body with 404 when no matching user is found.
 *
 * NO authentication — this endpoint is only reachable from localhost
 * (FreeSWITCH binds ESL / mod_curl to 127.0.0.1) and must not require a
 * session cookie or API key that FreeSWITCH cannot supply.
 */
router.get("/freeswitch/lookup", async (req: Request, res: Response) => {
  const { number } = req.query as { number?: string };
  if (!number || typeof number !== "string" || number.trim().length < 9) {
    res.status(400).send("");
    return;
  }

  try {
    await connectDB();
    const extension = await resolvePhoneToExtension(number.trim());
    if (!extension) {
      res.status(404).send("");
      return;
    }
    res.setHeader("Content-Type", "text/plain");
    res.send(String(extension));
  } catch (err) {
    res.status(500).send("");
  }
});

/** GET /api/freeswitch/admin-status — ESL connection + config state (admin only) */
router.get("/freeswitch/admin-status", (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const esl = eslStatus();
  const appUrl = getAppUrl();

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
