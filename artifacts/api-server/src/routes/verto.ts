import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, UserModel } from "@workspace/db";
import { assignExtensionIfNeeded } from "../lib/extension";
import { getAppUrl } from "../lib/appUrl";

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
    .select("coins ringtone ringtoneDuration dnd freeswitchHost freeswitchPort")
    .lean();

  const coins = user?.coins ?? 0;
  const domain = process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";

  // Build the Verto WebSocket URL. Browser connects to wss://rtc.PRaww.co.za/api/verto/ws
  // and the proxy tunnels to FreeSWITCH internally (ws://FS_IP:8081).
  // APP_URL (production custom domain) takes priority; falls back to request headers.
  const appUrl = getAppUrl();
  let wsUrl: string;
  if (appUrl) {
    wsUrl = appUrl.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/api/verto/ws";
  } else {
    wsUrl = process.env.FREESWITCH_WS_URL ?? "";
  }

  // SIP/WS URL for mobile JsSIP clients (proxied through this API server).
  // Prefer APP_URL so it matches the TLS-terminated public domain.
  let sipWsUrl: string;
  if (appUrl) {
    sipWsUrl = appUrl.replace(/^https?:\/\//, "wss://").replace(/\/$/, "") + "/api/sip/ws";
  } else {
    sipWsUrl = process.env.FREESWITCH_SIP_WS_URL ?? "";
  }

  const fsHost = user?.freeswitchHost ?? process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  const fsPort = user?.freeswitchPort ?? 5060;

  const iceServers = process.env.ICE_SERVERS
    ? JSON.parse(process.env.ICE_SERVERS)
    : [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
    ];

  res.json({
    wsUrl,
    sipWsUrl,
    domain,
    extension: ext.extension,
    login: `${ext.extension}@${domain}`,
    password: ext.fsPassword,
    coins,
    configured: Boolean(wsUrl),
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

async function handleFreeSwitchDirectory(req: Request, res: Response): Promise<void> {
  await connectDB();

  // mod_xml_curl sends POST by default (form-encoded body).
  // Support both so manual GET debugging also works.
  const params = (req.method === "POST" ? req.body : req.query) as Record<string, string | undefined>;

  // FreeSWITCH versions vary: some send `user=<ext>`, others send `key_name=user&key_value=<ext>`.
  // Also check `huntgroup_id` and `number_alias` as additional fallbacks.
  const ext =
    params["user"] ??
    (params["key_name"] === "user" ? params["key_value"] : undefined) ??
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
      "extension fsPassword email username name dnd " +
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
  const rawName = dbUser.name ?? dbUser.username ?? dbUser.email ?? String(extensionNum);

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
          <variable name="user_context" value="call_manager"/>
          <variable name="effective_caller_id_name" value="${displayName}"/>
          <variable name="effective_caller_id_number" value="${extensionNum}"/>
          <variable name="outbound_caller_id_name" value="${displayName}"/>
          <variable name="outbound_caller_id_number" value="${extensionNum}"/>
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

export default router;
