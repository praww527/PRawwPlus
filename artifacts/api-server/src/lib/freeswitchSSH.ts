/**
 * FreeSWITCH SSH Configuration Push
 *
 * SSH into the FreeSWITCH server and deploy the XML config files so that:
 *  - mod_xml_curl points to our directory API
 *  - mod_verto is properly bound
 *  - mod_event_socket is open for ESL
 *  - The dialplan routes extensions and fires call webhooks
 *
 * The SSH private key is read from FREESWITCH_SSH_KEY env var.
 * The SSH user defaults to "ubuntu" (override with FREESWITCH_SSH_USER).
 * The config root defaults to /etc/freeswitch (override with FREESWITCH_CONF_DIR).
 */

import { Client as SSHClient } from "ssh2";
import { logger } from "./logger";
import { getAppUrl } from "./appUrl";
import {
  xmlCurlConf,
  voicemailConf,
  vertoConf,
  dialplanXml,
  eventSocketConf,
  sipProfileXml,
} from "./freeswitchConfig";

const FS_DOMAIN    = process.env.FREESWITCH_DOMAIN ?? "";
const FS_SSH_PORT  = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
const FS_SSH_USER  = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
const FS_CONF_DIR  = process.env.FREESWITCH_CONF_DIR ?? "/usr/local/freeswitch/conf";
const FS_ESL_PASS  = process.env.FREESWITCH_ESL_PASSWORD ?? "ClueCon";

/** Strip protocol (wss://, ws://, https://, http://) and path/port for SSH/TCP use. */
function bareHost(raw: string): string {
  try {
    if (/^[a-z]+:\/\//i.test(raw)) return new URL(raw).hostname;
  } catch { /* fall through */ }
  return raw.split(":")[0].replace(/\/$/, "");
}

const FS_HOST = bareHost(FS_DOMAIN);

function cleanKey(raw: string): string {
  let s = raw.trim();

  // Handle literal \n escape sequences
  if (s.includes("\\n")) {
    s = s.replace(/\\n/g, "\n");
  }

  // Handle keys stored as a single line with spaces replacing newlines.
  // We extract header/footer separately so their internal spaces are preserved.
  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const headerMatch = s.match(/(-----BEGIN [^-]+-----)/);
    const footerMatch = s.match(/(-----END [^-]+-----)/);
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      const contentStart = s.indexOf(header) + header.length;
      const contentEnd = s.indexOf(footer);
      const body = s.slice(contentStart, contentEnd).trim().replace(/\s+/g, "\n");
      s = `${header}\n${body}\n${footer}`;
    }
  }

  return s
    .split("\n")
    .map((l) => l.trimStart())
    .join("\n")
    .trim();
}

function sshConnect(privateKey: string): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect({
      host:       FS_HOST,
      port:       FS_SSH_PORT,
      username:   FS_SSH_USER,
      privateKey: cleanKey(privateKey),
      readyTimeout: 10_000,
    });
  });
}

function execCommand(conn: SSHClient, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      let out = "";
      let errOut = "";
      stream.on("data", (d: Buffer) => { out += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
      stream.on("close", (code: number) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(errOut.trim() || `Exit code ${code}`));
      });
    });
  });
}

function writeRemoteFile(conn: SSHClient, path: string, content: string): Promise<void> {
  const escaped = content.replace(/'/g, "'\\''");
  return execCommand(conn, `mkdir -p "$(dirname '${path}')" && printf '%s' '${escaped}' > '${path}'`).then(() => {});
}

export interface PushResult {
  success:  boolean;
  steps:    string[];
  error?:   string;
}

export interface PushOptions {
  /**
   * Light reload (default: false).
   *
   * When true, only xml_curl and voicemail are reloaded — mod_verto and
   * mod_sofia are left alone.  Use this for automatic startup pushes where
   * disrupting active WebSocket connections is undesirable.  The mod_verto
   * config (verto.conf.xml) rarely changes between deploys, so skipping the
   * reload is safe once the initial full push has been done.
   *
   * When false (the full admin push), mod_verto and the Sofia SIP profile are
   * also unloaded + reloaded so they pick up any profile-level changes.
   */
  lightReload?: boolean;
}

export async function pushFreeSwitchConfig(opts: PushOptions = {}): Promise<PushResult> {
  const { lightReload = false } = opts;
  const rawKey = process.env.FREESWITCH_SSH_KEY;
  if (!rawKey) return { success: false, steps: [], error: "FREESWITCH_SSH_KEY not set" };
  if (!FS_HOST) return { success: false, steps: [], error: "FREESWITCH_DOMAIN not set" };

  const appUrl = getAppUrl();
  if (!appUrl) return { success: false, steps: [], error: "APP_URL not set — configure https://rtc.PRaww.co.za in environment" };

  // In development, APP_URL may point at production; override with a reachable URL
  // (e.g. ngrok / Cloudflare Tunnel) via DEV_DIRECTORY_BASE_URL=https://your-tunnel.example
  const devDirectoryBase = process.env.DEV_DIRECTORY_BASE_URL?.replace(/\/$/, "");
  const directoryBaseUrl =
    process.env.NODE_ENV !== "production" && devDirectoryBase
      ? devDirectoryBase
      : appUrl;

  const steps: string[] = [];
  let conn: SSHClient | null = null;

  try {
    steps.push("Connecting via SSH…");
    conn = await sshConnect(rawKey);
    steps.push(`SSH connected to ${FS_HOST}`);

    // Detect the actual FreeSWITCH config root by probing the filesystem.
    // We always probe — the env var FREESWITCH_CONF_DIR may be stale or wrong
    // (e.g. set to /etc/freeswitch on a source-compiled install that uses
    // /usr/local/freeswitch/conf). The probe checks for freeswitch.xml, which
    // is the canonical marker of the real config root.
    let confDir = FS_CONF_DIR; // fallback if probe fails
    try {
      const probed = await execCommand(
        conn,
        // Check for freeswitch.xml in both common locations; prefer the one that exists.
        "if [ -f /usr/local/freeswitch/conf/freeswitch.xml ]; then echo /usr/local/freeswitch/conf; " +
        "elif [ -f /etc/freeswitch/freeswitch.xml ]; then echo /etc/freeswitch; " +
        "elif [ -d /usr/local/freeswitch/conf ]; then echo /usr/local/freeswitch/conf; " +
        "else echo /etc/freeswitch; fi",
      );
      if (probed) confDir = probed.trim();
    } catch (err) {
      logger.debug({ err }, "[FSH] conf dir probe failed — using default");
    }
    steps.push(`Config dir: ${confDir}`);

    // Write xml_curl.conf — use directoryBaseUrl so FreeSWITCH reaches THIS instance
    steps.push(`Directory URL base: ${directoryBaseUrl}`);
    await writeRemoteFile(
      conn,
      `${confDir}/autoload_configs/xml_curl.conf.xml`,
      xmlCurlConf(directoryBaseUrl),
    );
    steps.push("Wrote xml_curl.conf.xml");

    // Write verto.conf
    await writeRemoteFile(
      conn,
      `${confDir}/autoload_configs/verto.conf.xml`,
      vertoConf(FS_HOST),
    );
    steps.push("Wrote verto.conf.xml");

    // Write event_socket.conf
    await writeRemoteFile(
      conn,
      `${confDir}/autoload_configs/event_socket.conf.xml`,
      eventSocketConf(),
    );
    steps.push("Wrote event_socket.conf.xml");

    // Write voicemail.conf
    await writeRemoteFile(
      conn,
      `${confDir}/autoload_configs/voicemail.conf.xml`,
      voicemailConf(),
    );
    steps.push("Wrote voicemail.conf.xml");

    // Write SIP/WS profile for mobile JsSIP clients
    await writeRemoteFile(
      conn,
      `${confDir}/sip_profiles/prawwplus_mobile.xml`,
      sipProfileXml(FS_HOST, appUrl),
    );
    steps.push("Wrote prawwplus_mobile SIP profile");

    // Write dialplan — top-level dialplan/ dir so FreeSWITCH's
    // "dialplan/*.xml" include picks it up as a standalone context.
    // The context is named "prawwplus" (not "default") so it is
    // completely isolated from the default FreeSWITCH dialplan.
    await writeRemoteFile(
      conn,
      `${confDir}/dialplan/prawwplus.xml`,
      dialplanXml(FS_HOST),
    );
    steps.push("Wrote prawwplus dialplan");

    // Remove old call_manager files if they exist (migration cleanup)
    for (const oldFile of [
      `${confDir}/sip_profiles/call_manager_ws.xml`,
      `${confDir}/dialplan/call_manager.xml`,
      `${confDir}/dialplan/default/call_manager.xml`,
    ]) {
      try {
        await execCommand(conn, `rm -f '${oldFile}'`);
        steps.push(`Removed old ${oldFile} (if present)`);
      } catch { /* ignore */ }
    }

    // Locate fs_cli — try common install paths
    const fsCli = await execCommand(
      conn,
      "command -v fs_cli 2>/dev/null || " +
      "ls /usr/local/freeswitch/bin/fs_cli /usr/bin/fs_cli 2>/dev/null | head -1 || " +
      "echo ''",
    ).then((p) => p.trim()).catch(() => "");

    if (!fsCli) {
      steps.push("fs_cli not found — skipping reload (FreeSWITCH will pick up changes on next restart)");
    } else {
      // Build a helper that always includes the ESL password.
      // Running fs_cli without -p fails authentication when a non-default password is set.
      const eslPassword = FS_ESL_PASS.replace(/'/g, "'\\''");
      const cli = `${fsCli} -p '${eslPassword}'`;

      // 1. Reload FreeSWITCH XML config — must happen FIRST so subsequent module
      //    reloads read the new files from the XML cache, not the stale in-memory copy.
      try {
        await execCommand(conn, `${cli} -x 'reloadxml'`);
        steps.push("reloadxml OK");
      } catch (e) {
        steps.push(`reloadxml failed: ${(e as Error).message}`);
      }

      // 2. Reload mod_xml_curl so it picks up the new gateway URL.
      //    `reload mod_xml_curl` is unreliable — it can leave the module in a
      //    broken state where it is "loaded" but has no gateway URL configured.
      //    We use an explicit unload + load cycle for a guaranteed clean state.
      try {
        await execCommand(conn, `${cli} -x 'unload mod_xml_curl'`);
        await new Promise((r) => setTimeout(r, 500));
        await execCommand(conn, `${cli} -x 'load mod_xml_curl'`);
        steps.push("mod_xml_curl unload+load OK");
      } catch (e) {
        steps.push(`mod_xml_curl unload+load failed: ${(e as Error).message}`);
      }

      // NOTE: We intentionally do NOT reload mod_event_socket here.
      // Reloading it via its own socket (fs_cli) causes the module to enter a bad state
      // where ESL stops accepting connections entirely, breaking all subsequent fs_cli calls
      // and requiring a full FreeSWITCH restart to recover.
      // The event_socket.conf.xml is written above so it will be used on the next
      // FreeSWITCH restart. The ESL password is set once and rarely changes.
      steps.push("event_socket.conf.xml written (reload skipped — requires FS restart to take effect)");

      if (lightReload) {
        // Lightweight startup refresh — skip mod_verto and mod_sofia reloads to
        // avoid dropping active WebSocket connections right as users reconnect.
        // mod_xml_curl (above) is the only module that MUST reflect the new
        // APP_URL directory endpoint; verto.conf rarely changes between deploys.
        //
        // Safety net for first-install: attempt to START the prawwplus_mobile
        // Sofia profile.  `sofia profile <name> start` is a no-op (returns an
        // error we catch) when the profile is already running, but on a fresh
        // install where the profile XML was just written for the first time it
        // boots the profile so PSTN gateway + mobile SIP/WS work immediately
        // — without requiring an admin to click "Push Config" in the UI.
        try {
          const out = await execCommand(conn, `${cli} -x 'sofia profile prawwplus_mobile start'`);
          if (/already|exists/i.test(out)) {
            steps.push("Light reload: prawwplus_mobile already running (skipped)");
          } else {
            steps.push("Light reload: started prawwplus_mobile (first-install)");
          }
        } catch {
          // Profile already loaded — `start` returns non-zero. Safe to ignore.
          steps.push("Light reload: prawwplus_mobile already running (skipped)");
        }
        steps.push("Light reload: skipping mod_verto reload (connections preserved)");
      } else {
        // 3. Full reload: unload + load mod_verto so it picks up the new verto.conf.
        //    `reload mod_verto` does NOT reliably reload profile bindings — only a
        //    full cycle does.  reloadxml already ran above so the cache is fresh.
        try {
          await execCommand(conn, `${cli} -x 'unload mod_verto'`);
          await new Promise((r) => setTimeout(r, 1000));
          await execCommand(conn, `${cli} -x 'load mod_verto'`);
          steps.push("mod_verto unload+load OK");
        } catch (e) {
          steps.push(`mod_verto unload+load failed: ${(e as Error).message}`);
        }

        // 4. Reload mod_voicemail to pick up voicemail.conf
        try {
          await execCommand(conn, `${cli} -x 'reload mod_voicemail'`);
          steps.push("reload mod_voicemail OK");
        } catch (e) {
          steps.push(`reload mod_voicemail failed (may not be critical): ${(e as Error).message}`);
        }

        // 5. Handle the SIP/WS mobile profile.
        //    `reload mod_sofia` reloads existing profiles but does NOT start new ones.
        //    We attempt to start the profile first; if it's already running, rescan it.
        try {
          await execCommand(conn, `${cli} -x 'sofia profile prawwplus_mobile start'`);
          steps.push("sofia profile prawwplus_mobile start OK");
        } catch (e) {
          try {
            await execCommand(conn, `${cli} -x 'sofia profile prawwplus_mobile rescan'`);
            steps.push("sofia profile prawwplus_mobile rescan OK");
          } catch (e2) {
            steps.push(`sofia profile prawwplus_mobile start/rescan failed (may not be critical): ${(e2 as Error).message}`);
          }
        }
      }
    }

    conn.end();
    steps.push("Done ✓");
    logger.info({ steps }, "[FSH] Config push complete");
    return { success: true, steps };
  } catch (err: unknown) {
    const message = (err as Error)?.message ?? String(err);
    logger.error({ err: message, steps }, "[FSH] Config push failed");
    conn?.end();
    return { success: false, steps, error: message };
  }
}

export async function testSSHConnection(): Promise<{ ok: boolean; error?: string }> {
  const rawKey = process.env.FREESWITCH_SSH_KEY;
  if (!rawKey) return { ok: false, error: "FREESWITCH_SSH_KEY not set" };
  if (!FS_HOST) return { ok: false, error: "FREESWITCH_DOMAIN not set" };

  try {
    const conn = await sshConnect(rawKey);
    const fsCli = await execCommand(
      conn,
      "command -v fs_cli 2>/dev/null || ls /usr/local/freeswitch/bin/fs_cli /usr/bin/fs_cli 2>/dev/null | head -1 || echo ''",
    ).then((p) => p.trim()).catch(() => "fs_cli");
    const eslPassword = FS_ESL_PASS.replace(/'/g, "'\\''");
    const out = await execCommand(conn, `${fsCli} -p '${eslPassword}' -x 'status' 2>/dev/null || echo 'freeswitch running'`);
    conn.end();
    return { ok: true, error: out };
  } catch (err: unknown) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}
