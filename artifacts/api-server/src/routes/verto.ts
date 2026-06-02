import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, UserModel, SystemConfigModel } from "@workspace/db";
import { assignExtensionIfNeeded } from "../lib/extension";
import { getBaseUrl } from "../lib/appUrl";

/**
 * Generate time-limited TURN credentials using the Coturn REST API secret.
 *
 * Standard: https://tools.ietf.org/html/draft-uberti-behave-turn-rest-00
 *   username  = "<expiry_unix_ts>:<userId>"
 *   credential = HMAC-SHA1(secret, username) → base64
 *
 * Coturn must be configured with:
 *   use-auth-secret
 *   static-auth-secret=<TURN_SECRET>
 */
function generateTurnCredentials(
  userId: string,
  secret: string,
  ttlSeconds = 86_400,
): { username: string; credential: string } {
  const expires  = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expires}:${userId}`;
  const credential = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");
  return { username, credential };
}

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

  const user = await UserModel.findById(userId)
    .select("coins ringtone ringtoneDuration dnd freeswitchHost freeswitchPort phone phoneVerified locked")
    .lean();

  if (user?.locked) {
    res.status(403).json({
      error:   "Account locked",
      message: "Your account has been locked. Please contact support.",
    });
    return;
  }

  const coins = user?.coins ?? 0;
  const domain = process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";

  // Build the Verto WebSocket URL. Browser connects to wss://rtc.PRaww.co.za/api/verto/ws
  // and the proxy tunnels to FreeSWITCH internally (ws://FS_IP:8081).
  // APP_URL (production custom domain) takes priority; falls back to request headers.
  const appUrl = getBaseUrl(req);
  const wsUrl = appUrl.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/api/verto/ws";

  // SIP/WS URL for mobile JsSIP clients (proxied through this API server).
  // Prefer APP_URL so it matches the TLS-terminated public domain.
  const sipWsUrl = appUrl.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/api/sip/ws";

  const fsHost = user?.freeswitchHost ?? process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  const fsPort = user?.freeswitchPort ?? 5060;

  const defaultIceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ];

  // ── ICE server resolution ────────────────────────────────────────────────────
  //
  // Priority (highest → lowest):
  //   1. TURN_SECRET + TURN_HOST env vars  → auto-generate time-limited HMAC
  //      credentials for every request (Coturn REST API secret mode).
  //      Returns: STUN + TURN UDP + TURN TCP + TURNS TLS entries.
  //   2. DB (admin-configurable via /admin/ice-servers)
  //   3. ICE_SERVERS env var (JSON array)
  //   4. Built-in Google STUN defaults (STUN-only, not suitable for production)
  //
  let iceServers: { urls: string | string[]; username?: string; credential?: string }[] = defaultIceServers;

  const turnSecret = process.env.TURN_SECRET;
  const turnHost   = process.env.TURN_HOST;

  if (turnSecret && turnHost) {
    // Managed TURN mode — generate fresh short-lived credentials for this user.
    const { username, credential } = generateTurnCredentials(userId, turnSecret);
    iceServers = [
      { urls: `stun:${turnHost}:3478` },
      {
        urls: [
          `turn:${turnHost}:3478?transport=udp`,
          `turn:${turnHost}:3478?transport=tcp`,
          `turns:${turnHost}:5349?transport=tcp`,
        ],
        username,
        credential,
      },
    ];
  } else {
    // Manual / fallback mode
    try {
      const sysConfig = await SystemConfigModel.findById("singleton").lean();
      if (sysConfig?.iceServers?.length) {
        iceServers = sysConfig.iceServers as typeof iceServers;
      } else if (process.env.ICE_SERVERS) {
        iceServers = JSON.parse(process.env.ICE_SERVERS);
      }
    } catch {
      if (process.env.ICE_SERVERS) {
        try { iceServers = JSON.parse(process.env.ICE_SERVERS); } catch { /* use defaults */ }
      }
    }
  }

  // Only expose the phone number once it has been verified — unverified
  // numbers must not be used as caller-ID and must not be forwarded to the
  // WebRTC client.
  const verifiedPhone: string | undefined =
    user?.phoneVerified && user?.phone ? String(user.phone) : undefined;

  res.json({
    wsUrl,
    sipWsUrl,
    domain,
    extension: ext.extension,
    login: `${ext.extension}@${domain}`,
    password: ext.fsPassword,
    coins,
    configured: Boolean(wsUrl),
    phone: verifiedPhone,
    iceServers,
    settings: {
      ringtone: user?.ringtone ?? "default",
      ringtoneDuration: user?.ringtoneDuration ?? 30,
      dnd: user?.dnd ?? false,
      freeswitchHost: fsHost,
      freeswitchPort: fsPort,
    },
  });
});

/**
 * GET /api/sip/config
 *
 * Returns SIP/WS credentials for browser JsSIP clients.
 * Same underlying credentials as /api/verto/config — extension, password, domain —
 * but shaped for a standard SIP User Agent rather than the Verto protocol.
 *
 * The browser connects to wss://APP/api/sip/ws which the sipProxy tunnels to
 * ws://freeswitch:5066 (prawwplus_mobile SIP profile, mod_sofia).
 */
router.get("/sip/config", async (req: Request, res: Response) => {
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

  const user = await UserModel.findById(userId)
    .select("coins phone phoneVerified locked")
    .lean();

  if (user?.locked) {
    res.status(403).json({
      error:   "Account locked",
      message: "Your account has been locked. Please contact support.",
    });
    return;
  }

  const domain = process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  const appUrl = getBaseUrl(req);
  const sipWsUrl = appUrl.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/api/sip/ws";

  const defaultIceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  let iceServers: { urls: string | string[]; username?: string; credential?: string }[] = defaultIceServers;

  const turnSecret = process.env.TURN_SECRET;
  const turnHost   = process.env.TURN_HOST;

  if (turnSecret && turnHost) {
    const expires  = Math.floor(Date.now() / 1000) + 86_400;
    const username = `${expires}:${userId}`;
    const credential = crypto
      .createHmac("sha1", turnSecret)
      .update(username)
      .digest("base64");
    iceServers = [
      { urls: `stun:${turnHost}:3478` },
      {
        urls: [
          `turn:${turnHost}:3478?transport=udp`,
          `turn:${turnHost}:3478?transport=tcp`,
          `turns:${turnHost}:5349?transport=tcp`,
        ],
        username,
        credential,
      },
    ];
  } else {
    try {
      const sysConfig = await SystemConfigModel.findById("singleton").lean();
      if (sysConfig?.iceServers?.length) {
        iceServers = sysConfig.iceServers as typeof iceServers;
      } else if (process.env.ICE_SERVERS) {
        iceServers = JSON.parse(process.env.ICE_SERVERS);
      }
    } catch {
      if (process.env.ICE_SERVERS) {
        try { iceServers = JSON.parse(process.env.ICE_SERVERS); } catch { /* defaults */ }
      }
    }
  }

  const verifiedPhone: string | undefined =
    user?.phoneVerified && user?.phone ? String(user.phone) : undefined;

  res.json({
    sipWsUrl,
    domain,
    extension: ext.extension,
    sipUri: `sip:${ext.extension}@${domain}`,
    password: ext.fsPassword,
    configured: Boolean(process.env.FREESWITCH_DOMAIN),
    phone: verifiedPhone,
    iceServers,
  });
});

const FS_NOT_FOUND_XML = `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="result">
    <result status="not found" />
  </section>
</document>`;

async function handleFreeSwitchDirectory(req: Request, res: Response): Promise<void> {
  // Guard: when FREESWITCH_WEBHOOK_SECRET is set, require FreeSWITCH to send
  // it in the X-FreeSWITCH-Token header (configured in xml_curl.conf.xml).
  // This prevents unauthenticated enumeration of extension credentials.
  const dirSecret = process.env.FREESWITCH_WEBHOOK_SECRET;
  if (dirSecret) {
    const provided =
      req.get("x-freeswitch-token") ??
      req.get("x-fs-webhook-secret") ??
      "";
    if (provided !== dirSecret) {
      // IMPORTANT: return 200 not 403. FreeSWITCH's mod_xml_curl treats any
      // non-200 as a transport error and falls back to local config (no users).
      // A 200 "not found" XML is the correct way to deny a lookup so FS knows
      // the user simply doesn't exist rather than thinking the server is down.
      const { logger: log } = await import("../lib/logger");
      log.warn(
        { provided: provided ? "[set]" : "[empty]", path: req.path },
        "[DIR] Secret mismatch — push FreeSWITCH config again to sync the secret header",
      );
      res.setHeader("Content-Type", "text/xml");
      res.status(200).send(FS_NOT_FOUND_XML);
      return;
    }
  }

  await connectDB();

  // mod_xml_curl sends POST by default (form-encoded body).
  // Support both so manual GET debugging also works.
  const params = (req.method === "POST" ? req.body : req.query) as Record<string, string | undefined>;

  // FreeSWITCH mod_xml_curl sends: key_name=id&key_value=<ext> (standard).
  // Some builds send key_name=user or a bare user= field instead.
  // Accept all three so every FreeSWITCH version works.
  const ext =
    params["user"] ??
    (params["key_name"] === "id" || params["key_name"] === "user"
      ? params["key_value"]
      : undefined) ??
    params["number_alias"];
  const domain = params["domain"];

  // Log the full params so we can see exactly what FreeSWITCH sends
  const { logger } = await import("../lib/logger");
  logger.info({ params, method: req.method, ext }, "[DIR] FreeSWITCH directory request");

  res.setHeader("Content-Type", "text/xml");

  if (!ext) {
    logger.warn({ params }, "[DIR] No user/extension found in request — returning not found");
    res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="result">
    <result status="not found" />
  </section>
</document>`,
    );
    return;
  }

  const extensionNum = parseInt(ext, 10);
  if (isNaN(extensionNum)) {
    logger.warn({ ext }, "[DIR] Non-numeric extension — returning not found");
    res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="result">
    <result status="not found" />
  </section>
</document>`,
    );
    return;
  }

  const dbUser = await UserModel.findOne({ extension: extensionNum })
    .select(
      "extension fsPassword email username name dnd phone phoneVerified " +
      "callForwardAlwaysEnabled callForwardAlwaysTo " +
      "callForwardBusyEnabled callForwardBusyTo " +
      "callForwardNoAnswerEnabled callForwardNoAnswerTo " +
      "callForwardUnavailableEnabled callForwardUnavailableTo",
    )
    .lean();

  if (!dbUser || !dbUser.fsPassword) {
    res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="result">
    <result status="not found" />
  </section>
</document>`,
    );
    return;
  }

  const fsDomain = domain ?? process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  const rawName = dbUser.name ?? dbUser.username ?? dbUser.email ?? "PRaww+ User";

  // Escape XML special characters so names with &, <, >, " or ' cannot break the directory XML.
  const xmlEscape = (s: string) =>
    s.replace(/&/g, "&amp;")
     .replace(/</g, "&lt;")
     .replace(/>/g, "&gt;")
     .replace(/"/g, "&quot;")
     .replace(/'/g, "&apos;");

  const displayName  = xmlEscape(rawName);
  const safePassword = xmlEscape(dbUser.fsPassword!);
  const dndValue     = dbUser.dnd ? "true" : "false";

  // Use the user's mobile number as caller ID so other users see their phone
  // number instead of the internal extension.  We use phone even when
  // phoneVerified is false — caller-ID is display-only and does not require
  // verification.  Fall back to extension only when no phone is stored at all.
  const callerIdNumber = dbUser.phone
    ? xmlEscape(dbUser.phone)
    : String(extensionNum);
  const callForwardAlwaysEnabled = dbUser.callForwardAlwaysEnabled ? "true" : "false";
  const callForwardAlwaysTo = xmlEscape(dbUser.callForwardAlwaysTo ?? "");
  const callForwardBusyEnabled = dbUser.callForwardBusyEnabled ? "true" : "false";
  const callForwardBusyTo = xmlEscape(dbUser.callForwardBusyTo ?? "");
  const callForwardNoAnswerEnabled = dbUser.callForwardNoAnswerEnabled ? "true" : "false";
  const callForwardNoAnswerTo = xmlEscape(dbUser.callForwardNoAnswerTo ?? "");
  const callForwardUnavailableEnabled = dbUser.callForwardUnavailableEnabled ? "true" : "false";
  const callForwardUnavailableTo = xmlEscape(dbUser.callForwardUnavailableTo ?? "");

  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="${fsDomain}">
      <user id="${extensionNum}">
        <params>
          <param name="password" value="${safePassword}"/>
          <param name="vm-password" value="${safePassword}"/>
        </params>
        <variables>
          <variable name="toll_allow" value="domestic,international,local"/>
          <variable name="accountcode" value="${extensionNum}"/>
          <variable name="user_context" value="prawwplus"/>
          <variable name="effective_caller_id_name" value="${displayName}"/>
          <variable name="effective_caller_id_number" value="${callerIdNumber}"/>
          <variable name="outbound_caller_id_name" value="${displayName}"/>
          <variable name="outbound_caller_id_number" value="${callerIdNumber}"/>
          <variable name="dnd" value="${dndValue}"/>
          <variable name="callForwardAlwaysEnabled" value="${callForwardAlwaysEnabled}"/>
          <variable name="callForwardAlwaysTo" value="${callForwardAlwaysTo}"/>
          <variable name="callForwardBusyEnabled" value="${callForwardBusyEnabled}"/>
          <variable name="callForwardBusyTo" value="${callForwardBusyTo}"/>
          <variable name="callForwardNoAnswerEnabled" value="${callForwardNoAnswerEnabled}"/>
          <variable name="callForwardNoAnswerTo" value="${callForwardNoAnswerTo}"/>
          <variable name="callForwardUnavailableEnabled" value="${callForwardUnavailableEnabled}"/>
          <variable name="callForwardUnavailableTo" value="${callForwardUnavailableTo}"/>
        </variables>
      </user>
    </domain>
  </section>
</document>`,
  );
}

// mod_xml_curl POSTs by default; also accept GET for manual curl/browser testing
router.post("/freeswitch/directory", handleFreeSwitchDirectory);
router.get("/freeswitch/directory", handleFreeSwitchDirectory);

/**
 * GET /api/freeswitch/status
 *
 * Diagnostic endpoint — verifies that the FreeSWITCH directory integration is
 * working end-to-end.  Simulates a mod_xml_curl directory lookup for the
 * requesting user's own extension so you can confirm the lookup chain:
 *   FreeSWITCH → mod_xml_curl → this API → MongoDB → XML response
 *
 * Returns:
 *   { ok: true, extension, domain, xmlPreview }   on success
 *   { ok: false, reason }                          on failure
 *
 * Use this to quickly diagnose "connect failed" issues without SSH access:
 *   curl -H "Cookie: <session>" https://your-app/api/freeswitch/status
 */
router.get("/freeswitch/status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;

  const user = await UserModel.findById(userId)
    .select("extension fsPassword phone phoneVerified")
    .lean();

  if (!user) {
    res.status(404).json({ ok: false, reason: "User not found in database" });
    return;
  }

  if (!user.extension) {
    res.status(200).json({
      ok: false,
      reason: "No extension assigned — call GET /api/verto/config first to trigger assignment",
    });
    return;
  }

  if (!user.fsPassword) {
    res.status(200).json({
      ok: false,
      reason: "No FreeSWITCH password set — user record is incomplete in MongoDB",
    });
    return;
  }

  const domain = process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  const dirSecret = process.env.FREESWITCH_WEBHOOK_SECRET;

  // Simulate exactly what mod_xml_curl sends — POST with form-encoded body.
  // Use localhost to avoid TLS/hostname issues in the self-test; the handler
  // is on this same process, so localhost:PORT always works.
  const port = (req.socket as any)?.localPort ?? process.env.PORT ?? 8080;
  const selfTestUrl = `http://127.0.0.1:${port}/api/freeswitch/directory`;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (dirSecret) {
      headers["X-FreeSWITCH-Token"] = dirSecret;
    }

    const body = new URLSearchParams({
      user:       String(user.extension),
      domain,
      section:    "directory",
      tag_name:   "domain",
      key_name:   "name",
      key_value:  domain,
    });

    const resp = await fetch(selfTestUrl, {
      method:  "POST",
      headers,
      body:    body.toString(),
    });

    const xml = await resp.text();

    if (!resp.ok || xml.includes('status="not found"')) {
      res.status(200).json({
        ok:          false,
        reason:
          `Directory lookup returned HTTP ${resp.status} or "not found". ` +
          `If FREESWITCH_WEBHOOK_SECRET is set, confirm FreeSWITCH sends ` +
          `X-FreeSWITCH-Token with the same value.`,
        httpStatus:  resp.status,
        xmlPreview:  xml.slice(0, 500),
      });
      return;
    }

    const appBase = getBaseUrl(req);
    const vertoWsUrl  = appBase.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/api/verto/ws";
    const directoryUrl = appBase.replace(/\/$/, "") + "/api/freeswitch/directory";

    res.json({
      ok:                     true,
      extension:              user.extension,
      domain,
      phone:                  user.phone ?? null,
      phoneVerified:          user.phoneVerified ?? false,
      vertoWsUrl,
      directoryUrl,
      webhookSecretConfigured: Boolean(dirSecret),
      xmlPreview:             xml.slice(0, 800),
    });
  } catch (err: any) {
    res.status(200).json({
      ok:     false,
      reason: `Self-test fetch failed: ${err?.message ?? String(err)}`,
    });
  }
});

export default router;
