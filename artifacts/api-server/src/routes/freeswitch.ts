/**
 * FreeSWITCH admin routes — status, config push, diagnostics, and DID routing.
 *
 * Admin routes require the requesting user to be an admin.
 * The /lookup and /did-route routes are unauthenticated and intended for
 * FreeSWITCH mod_curl — only reachable from localhost (127.0.0.1).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eslStatus } from "../lib/freeswitchESL";
import { pushFreeSwitchConfig, testSSHConnection } from "../lib/freeswitchSSH";
import { getAppUrl } from "../lib/appUrl";
import { connectDB } from "@workspace/db";
import { resolvePhoneToExtension, resolveDIDRoute } from "../lib/phoneResolver";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response): boolean {
  if (!req.isAuthenticated() || !(req as any).user?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * GET /api/freeswitch/lookup?number=0XXXXXXXXX
 *
 * Legacy endpoint: resolves a phone number to an extension (for internal
 * phone-number-to-extension lookup from the dialplan).
 * NO authentication — only reachable from localhost.
 */
router.get("/freeswitch/lookup", async (req: Request, res: Response) => {
  // Loopback-only — called by FreeSWITCH mod_curl from the same host
  const remoteIp = req.socket?.remoteAddress ?? req.ip ?? "";
  const isLocalhost =
    remoteIp === "127.0.0.1" ||
    remoteIp === "::1" ||
    remoteIp === "::ffff:127.0.0.1";
  if (!isLocalhost) {
    res.status(403).send("");
    return;
  }

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
  } catch {
    res.status(500).send("");
  }
});

/**
 * GET /api/freeswitch/did-route?number=+27...
 *
 * Called by FreeSWITCH mod_curl when an inbound DID call arrives.
 * Resolves the DID to its configured route (agent extension, ring group, or queue)
 * and returns plain-text directives that the dialplan uses to execute the call.
 *
 * Response format (plain text):
 *   agent:<extension>
 *   ring_group:<ext1>,<ext2>,...|<strategy>
 *   queue:<queueName>
 *   unrouted
 *
 * NO authentication — only reachable from localhost (FreeSWITCH loopback).
 */
router.get("/freeswitch/did-route", async (req: Request, res: Response) => {
  // Enforce loopback-only access: this endpoint is called by FreeSWITCH mod_curl
  // running on the same host. Reject any request not originating from localhost.
  const remoteIp = req.socket?.remoteAddress ?? req.ip ?? "";
  const isLocalhost =
    remoteIp === "127.0.0.1" ||
    remoteIp === "::1" ||
    remoteIp === "::ffff:127.0.0.1";
  if (!isLocalhost) {
    res.status(403).send("forbidden");
    return;
  }

  const { number } = req.query as { number?: string };
  if (!number || typeof number !== "string" || number.trim().length < 7) {
    res.status(400).send("unrouted");
    return;
  }

  try {
    await connectDB();
    const route = await resolveDIDRoute(number.trim());

    res.setHeader("Content-Type", "text/plain");

    /*
     * Response format (used directly by dialplan `bridge` or `transfer`):
     *
     *   transfer:<ext>                         — agent: transfer to extension in prawwplus
     *   ringall:<user/1001>,<user/1002>,...    — ring group ring-all (comma = simultaneous)
     *   seqring:<user/1001>|<user/1002>|...   — ring group round-robin (pipe = sequential)
     *   queue:<queueName>                      — callcenter queue
     *   unrouted                               — no route configured
     *
     * Using `user/<ext>` bridge URIs resolves through the FS directory so both
     * SIP and Verto registrations are found automatically.
     */
    switch (route.type) {
      case "agent":
        res.send(`transfer:${route.extension}`);
        break;
      case "ring_group": {
        const userUris = route.extensions!.map((e) => `user/${e}`);
        if (route.strategy === "round-robin") {
          res.send(`seqring:${userUris.join("|")}`);
        } else {
          res.send(`ringall:${userUris.join(",")}`);
        }
        break;
      }
      case "queue":
        res.send(`queue:${xmlEscape(route.queueName!)}`);
        break;
      default:
        res.status(404).send("unrouted");
    }
  } catch {
    res.status(500).send("unrouted");
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
      didRouteUrl:  appUrl ? `${appUrl}/api/freeswitch/did-route` : null,
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
