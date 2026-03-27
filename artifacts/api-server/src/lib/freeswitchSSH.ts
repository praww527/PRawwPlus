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
 * The SSH user defaults to "root" (override with FREESWITCH_SSH_USER).
 * The config root defaults to /etc/freeswitch (override with FREESWITCH_CONF_DIR).
 */

import { Client as SSHClient } from "ssh2";
import { logger } from "./logger";
import { getAppUrl } from "./appUrl";
import {
  xmlCurlConf,
  vertoConf,
  dialplanXml,
  eventSocketConf,
  sipProfileXml,
} from "./freeswitchConfig";

const FS_HOST     = process.env.FREESWITCH_DOMAIN ?? "";
const FS_SSH_PORT = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
const FS_SSH_USER = process.env.FREESWITCH_SSH_USER ?? "root";
const FS_CONF_DIR = process.env.FREESWITCH_CONF_DIR ?? "/usr/local/freeswitch/conf";

function cleanKey(raw: string): string {
  return raw
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

export async function pushFreeSwitchConfig(): Promise<PushResult> {
  const rawKey = process.env.FREESWITCH_SSH_KEY;
  if (!rawKey) return { success: false, steps: [], error: "FREESWITCH_SSH_KEY not set" };
  if (!FS_HOST) return { success: false, steps: [], error: "FREESWITCH_DOMAIN not set" };

  const appUrl = getAppUrl();
  if (!appUrl) return { success: false, steps: [], error: "APP_URL not set — configure https://rtc.PRaww.co.za in environment" };

  // In development, APP_URL points to the production domain which may not route
  // to this dev server. Use the PRaww dev domain so FreeSWITCH can reach the
  // directory endpoint on the currently running instance.
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  const directoryBaseUrl =
    process.env.NODE_ENV !== "production" && replitDevDomain
      ? `https://${replitDevDomain}`
      : appUrl;

  const steps: string[] = [];
  let conn: SSHClient | null = null;

  try {
    steps.push("Connecting via SSH…");
    conn = await sshConnect(rawKey);
    steps.push(`SSH connected to ${FS_HOST}`);

    // Detect FreeSWITCH config root
    let confDir = FS_CONF_DIR;
    try {
      const alt = await execCommand(conn, "[ -d /usr/local/freeswitch/conf ] && echo /usr/local/freeswitch/conf || echo /etc/freeswitch");
      if (alt) confDir = alt.trim();
    } catch {}
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

    // Write SIP/WS profile for mobile JsSIP clients
    await writeRemoteFile(
      conn,
      `${confDir}/sip_profiles/call_manager_ws.xml`,
      sipProfileXml(FS_HOST, appUrl),
    );
    steps.push("Wrote call_manager_ws SIP profile");

    // Write dialplan — top-level dialplan/ dir so FreeSWITCH's
    // "dialplan/*.xml" include picks it up as a standalone context.
    // The context is named "call_manager" (not "default") so it is
    // completely isolated from the default FreeSWITCH dialplan.
    await writeRemoteFile(
      conn,
      `${confDir}/dialplan/call_manager.xml`,
      dialplanXml(FS_HOST),
    );
    steps.push("Wrote call_manager dialplan");

    // Remove the old file from dialplan/default/ if it exists (cleanup)
    try {
      await execCommand(conn, `rm -f '${confDir}/dialplan/default/call_manager.xml'`);
      steps.push("Removed old dialplan/default/call_manager.xml (if present)");
    } catch { /* ignore */ }

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
      // Reload FreeSWITCH XML config
      try {
        await execCommand(conn, `${fsCli} -x 'reloadxml'`);
        steps.push("reloadxml OK");
      } catch (e) {
        steps.push(`reloadxml failed: ${(e as Error).message}`);
      }

      // Reload mod_xml_curl so it picks up the new gateway URL
      try {
        await execCommand(conn, `${fsCli} -x 'reload mod_xml_curl'`);
        steps.push("reload mod_xml_curl OK");
      } catch (e) {
        steps.push(`reload mod_xml_curl failed: ${(e as Error).message}`);
      }

      // Reload mod_verto to pick up the new verto.conf (port binding)
      try {
        await execCommand(conn, `${fsCli} -x 'reload mod_verto'`);
        steps.push("reload mod_verto OK");
      } catch (e) {
        steps.push(`reload mod_verto failed: ${(e as Error).message}`);
      }

      // Reload/start the SIP/WS profile for mobile clients
      try {
        await execCommand(conn, `${fsCli} -x 'reload mod_sofia'`);
        steps.push("reload mod_sofia OK");
      } catch (e) {
        steps.push(`reload mod_sofia failed (may not be critical): ${(e as Error).message}`);
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
    const out  = await execCommand(conn, "fs_cli -x 'status' 2>/dev/null || echo 'freeswitch running'");
    conn.end();
    return { ok: true, error: out };
  } catch (err: unknown) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}
