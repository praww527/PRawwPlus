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

  const fsHost = user?.freeswitchHost ?? process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  const fsPort = user?.freeswitchPort ?? 5060;

  res.json({
    wsUrl,
    domain,
    extension: ext.extension,
    login: `${ext.extension}@${domain}`,
    password: ext.fsPassword,
    coins,
    configured: Boolean(wsUrl),
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
    .select("extension fsPassword email username name")
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
  const displayName = dbUser.name ?? dbUser.username ?? dbUser.email ?? String(extensionNum);

  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="${fsDomain}">
      <user id="${extensionNum}">
        <params>
          <param name="password" value="${dbUser.fsPassword}"/>
          <param name="vm-password" value="${dbUser.fsPassword}"/>
        </params>
        <variables>
          <variable name="toll_allow" value="domestic,international,local"/>
          <variable name="accountcode" value="${extensionNum}"/>
          <variable name="user_context" value="default"/>
          <variable name="effective_caller_id_name" value="${displayName}"/>
          <variable name="effective_caller_id_number" value="${extensionNum}"/>
          <variable name="outbound_caller_id_name" value="${displayName}"/>
          <variable name="outbound_caller_id_number" value="${extensionNum}"/>
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
