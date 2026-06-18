/**
 * FreeSWITCH admin routes — status, config push, diagnostics, and DID routing.
 *
 * Admin routes (admin-status, configure, test-ssh, gateway-status) require an
 * authenticated admin session or a valid ADMIN_API_KEY bearer token.
 * The /did-route and /inbound routes are unauthenticated and intended for
 * FreeSWITCH mod_curl — only reachable from localhost (127.0.0.1).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eslStatus, sendEslBgapiAwait } from "../lib/freeswitchESL";
import { pushFreeSwitchConfig, testSSHConnection } from "../lib/freeswitchSSH";
import { getAppUrl } from "../lib/appUrl";
import { connectDB } from "@workspace/db";
import { resolveDIDRoute } from "../lib/phoneResolver";
import { xmlEscape } from "../lib/freeswitchConfig";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

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

/**
 * GET /api/freeswitch/inbound?did=<number>
 *
 * Simplified inbound DID routing for the FreeSWITCH dialplan (prawwplus.xml).
 * Returns plain text that the dialplan uses directly as a transfer target:
 *   • "1001"                            — single agent extension
 *   • "user/1001@domain,user/1002@domain" — ring-group simultaneous ring
 *   • "queue:salesQueue"                — call-centre queue
 *   • "unrouted"                        — no route configured (falls to invalid_number)
 *
 * Falls back to the first admin extension (then any extension) when no DID
 * route is configured, so inbound calls always reach someone.
 * NO authentication — localhost only (called by FreeSWITCH mod_curl).
 */
router.get("/freeswitch/inbound", async (req: Request, res: Response) => {
  const remoteIp = req.socket?.remoteAddress ?? req.ip ?? "";
  const isLocalhost =
    remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
  if (!isLocalhost) { res.status(403).send("forbidden"); return; }

  const rawDid = ((req.query.did ?? req.query.number ?? "") as string).trim();
  if (!rawDid || rawDid.length < 7) { res.send("unrouted"); return; }

  res.setHeader("Content-Type", "text/plain");

  try {
    await connectDB();
    const route = await resolveDIDRoute(rawDid);

    switch (route.type) {
      case "agent":
        res.send(String(route.extension));
        return;
      case "ring_group": {
        const domain = process.env.FREESWITCH_DOMAIN ?? "158.180.29.84";
        const uris = route.extensions!.map((e) => `user/${e}@${domain}`);
        res.send(uris.join(","));
        return;
      }
      case "queue":
        res.send(`queue:${route.queueName}`);
        return;
      default:
        break;
    }
  } catch { /* fall through to extension fallback */ }

  // No DID route — fall back to first admin extension, then any registered extension
  try {
    const { UserModel } = await import("@workspace/db");
    const admin = await (UserModel as any)
      .findOne({ isAdmin: true, extension: { $exists: true, $ne: null } })
      .lean() as any;
    if (admin?.extension) { res.send(String(admin.extension)); return; }

    const anyUser = await (UserModel as any)
      .findOne({ extension: { $exists: true, $ne: null } })
      .lean() as any;
    if (anyUser?.extension) { res.send(String(anyUser.extension)); return; }
  } catch { /* ignore */ }

  res.send("unrouted");
});

/** GET /api/freeswitch/admin-status — ESL connection + config state (admin only) */
router.get("/freeswitch/admin-status", requireAdmin, (_req: Request, res: Response) => {
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
router.post("/freeswitch/configure", requireAdmin, async (_req: Request, res: Response) => {
  const result = await pushFreeSwitchConfig();
  res.status(result.success ? 200 : 500).json(result);
});

/** POST /api/freeswitch/test-ssh — verify SSH connectivity to the FreeSWITCH server */
router.post("/freeswitch/test-ssh", requireAdmin, async (_req: Request, res: Response) => {
  const result = await testSSHConnection();
  res.status(result.ok ? 200 : 500).json(result);
});

// ─── Gateway status helpers ────────────────────────────────────────────────

interface GatewayRow {
  name:        string;
  profile:     string;
  state:       string;
  stateDetail: string | null;
  realm:       string | null;
  username:    string | null;
  callsIn:     number | null;
  callsOut:    number | null;
  callsFailed: number | null;
  uptimeInState: string | null;
  fetchedAt:   string;
  error:       string | null;
}

/**
 * Parse the plain-text output of `sofia status` into a list of gateway rows.
 * Lines that describe a gateway look like:
 *   "          <profile>::<name>  gateway   <realm>   <STATE>"
 * or in older FS builds:
 *   "          <name>             gateway   <realm>   <STATE>"
 */
function parseSofiaStatus(raw: string): { name: string; profile: string; state: string; realm: string }[] {
  const gateways: { name: string; profile: string; state: string; realm: string }[] = [];
  for (const line of raw.split("\n")) {
    if (!line.toLowerCase().includes("gateway")) continue;
    const trimmed = line.trim();
    const parts   = trimmed.split(/\s+/);
    if (parts.length < 4) continue;

    const nameField = parts[0];
    const typeField = parts[1]?.toLowerCase();
    if (typeField !== "gateway") continue;

    const realm = parts[2] ?? "";
    const state = parts[parts.length - 1] ?? "UNKNOWN";

    let name    = nameField;
    let profile = "";

    if (nameField.includes("::")) {
      const idx = nameField.indexOf("::");
      profile   = nameField.slice(0, idx);
      name      = nameField.slice(idx + 2);
    }

    gateways.push({ name, profile, state, realm });
  }
  return gateways;
}

/**
 * Parse the plain-text output of `sofia status gateway <name>` into key→value pairs.
 * Lines are "Key\tValue" or "Key    Value" (tab or multi-space separated).
 */
function parseSofiaGatewayDetail(raw: string): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const tabIdx = line.indexOf("\t");
    if (tabIdx > 0) {
      const key = line.slice(0, tabIdx).trim();
      const val = line.slice(tabIdx + 1).trim();
      if (key) kv[key] = val;
      continue;
    }
    const m = line.match(/^(\S[\w\s\-]+?)\s{2,}(.+)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      if (key) kv[key] = val;
    }
  }
  return kv;
}

/**
 * GET /api/freeswitch/gateway-status
 *
 * Returns real-time SIP gateway registration state and available PSTN coin
 * balance without requiring SSH or fs_cli access.
 *
 * Response shape:
 * {
 *   fetchedAt:    ISO timestamp,
 *   eslConnected: boolean,
 *   gateways: [
 *     {
 *       name, profile, state, stateDetail,
 *       realm, username,
 *       callsIn, callsOut, callsFailed,
 *       uptimeInState,
 *       fetchedAt, error
 *     }
 *   ],
 *   credit: {
 *     totalCoins:     number,   // sum of all user coin balances
 *     userCount:      number,   // users with a non-zero balance
 *     lowBalanceThreshold: number,
 *   },
 *   pstnGatewayName: string | null,   // value of PSTN_GATEWAY_NAME env var
 * }
 *
 * Admin-only (session cookie or Authorization: Bearer <ADMIN_API_KEY>).
 */
router.get("/freeswitch/gateway-status", async (req: Request, res: Response) => {
  const adminKey  = process.env.ADMIN_API_KEY;
  const authHdr   = (req.headers["authorization"] ?? req.headers["x-admin-key"] ?? "").toString();
  const token     = authHdr.replace(/^Bearer\s+/i, "").trim();
  const bearerOk  = adminKey && token === adminKey;
  const sessionOk = (req as any).isAuthenticated?.() && (req as any).user?.isAdmin;

  if (!bearerOk && !sessionOk) {
    if (!adminKey && !sessionOk) {
      res.status(501).json({ error: "ADMIN_API_KEY not configured and no admin session" });
    } else {
      res.status(403).json({ error: "Admin access required" });
    }
    return;
  }

  const fetchedAt       = new Date().toISOString();
  const pstnGatewayName = process.env.PSTN_GATEWAY_NAME ?? null;
  const esl             = eslStatus();

  // ── 1. Query FreeSWITCH for all gateway states via ESL ───────────────────

  let gateways: GatewayRow[] = [];

  if (!esl.connected) {
    gateways = pstnGatewayName
      ? [{
          name: pstnGatewayName, profile: "", state: "UNKNOWN",
          stateDetail: null, realm: process.env.PSTN_GATEWAY_REALM ?? null,
          username: process.env.PSTN_GATEWAY_USERNAME ?? null,
          callsIn: null, callsOut: null, callsFailed: null,
          uptimeInState: null, fetchedAt,
          error: "ESL not connected — cannot query FreeSWITCH",
        }]
      : [];
  } else {
    const TIMEOUT_MS = 8_000;

    // Run sofia status (all gateways) and per-gateway detail in parallel.
    // We fetch the overview first to know which gateways exist, then detail.
    const sofiaStatusRaw = await sendEslBgapiAwait("sofia status", TIMEOUT_MS);
    const parsed         = parseSofiaStatus(sofiaStatusRaw);

    // If the configured PSTN gateway isn't in the sofia status output yet
    // (e.g. it's still trying to register), inject a placeholder so it
    // always appears in the response.
    if (pstnGatewayName && !parsed.some((g) => g.name === pstnGatewayName)) {
      parsed.push({
        name:    pstnGatewayName,
        profile: "",
        state:   "UNKNOWN",
        realm:   process.env.PSTN_GATEWAY_REALM ?? "",
      });
    }

    // Fetch detailed status for each gateway in parallel (cap to 10 to avoid
    // hammering ESL with dozens of commands on a heavily-provisioned FS box).
    gateways = await Promise.all(
      parsed.slice(0, 10).map(async (gw): Promise<GatewayRow> => {
        try {
          const detail = await sendEslBgapiAwait(`sofia status gateway ${gw.name}`, TIMEOUT_MS);
          if (detail.startsWith("-ERR")) {
            return {
              name:         gw.name,
              profile:      gw.profile,
              state:        gw.state,
              stateDetail:  null,
              realm:        gw.realm || null,
              username:     null,
              callsIn:      null,
              callsOut:     null,
              callsFailed:  null,
              uptimeInState: null,
              fetchedAt,
              error:        detail,
            };
          }

          const kv = parseSofiaGatewayDetail(detail);

          const state        = kv["State"]   ?? kv["state"]   ?? gw.state;
          const stateDetail  = kv["Status"]  ?? kv["status"]  ?? null;
          const realm        = kv["Realm"]   ?? kv["realm"]   ?? gw.realm ?? null;
          const username     = kv["Username"] ?? kv["username"] ?? null;
          const uptimeInState = kv["Uptime-In-State"] ?? kv["uptime-in-state"] ?? null;

          const toInt = (k: string) => {
            const v = kv[k] ?? kv[k.toLowerCase()];
            const n = v !== undefined ? parseInt(v, 10) : null;
            return n !== null && !isNaN(n) ? n : null;
          };
          const callsIn     = toInt("Calls-In");
          const callsOut    = toInt("Calls-Out");
          const callsFailed = toInt("Calls-Failed-Total") ?? toInt("Calls-Failed");

          return {
            name: gw.name, profile: gw.profile || (kv["Profile"] ?? kv["profile"] ?? ""),
            state, stateDetail, realm, username,
            callsIn, callsOut, callsFailed, uptimeInState,
            fetchedAt, error: null,
          };
        } catch (err: any) {
          return {
            name:         gw.name,
            profile:      gw.profile,
            state:        gw.state,
            stateDetail:  null,
            realm:        gw.realm || null,
            username:     null,
            callsIn:      null,
            callsOut:     null,
            callsFailed:  null,
            uptimeInState: null,
            fetchedAt,
            error:        String(err?.message ?? err),
          };
        }
      }),
    );
  }

  // ── 2. Query MongoDB for total available PSTN coin credit ────────────────

  let credit: {
    totalCoins:          number;
    userCount:           number;
    lowBalanceThreshold: number;
  } | null = null;

  try {
    await connectDB();
    const { UserModel } = await import("@workspace/db");
    const agg = await (UserModel as any).aggregate([
      { $match: { coins: { $gt: 0 } } },
      { $group: { _id: null, totalCoins: { $sum: "$coins" }, userCount: { $sum: 1 } } },
    ]) as Array<{ totalCoins: number; userCount: number }>;

    const row = agg[0] ?? { totalCoins: 0, userCount: 0 };
    credit = {
      totalCoins:          row.totalCoins,
      userCount:           row.userCount,
      lowBalanceThreshold: parseInt(process.env.LOW_BALANCE_THRESHOLD_COINS ?? "10", 10),
    };
  } catch {
    credit = null;
  }

  res.json({
    fetchedAt,
    eslConnected:    esl.connected,
    pstnGatewayName,
    gateways,
    credit,
  });
});

export default router;
