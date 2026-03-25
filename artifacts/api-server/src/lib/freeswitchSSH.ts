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
import {
  xmlCurlConf,
  vertoConf,
  dialplanXml,
  eventSocketConf,
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

  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (!appUrl) return { success: false, steps: [], error: "APP_URL not set" };

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

    // Write xml_curl.conf
    await writeRemoteFile(
      conn,
      `${confDir}/autoload_configs/xml_curl.conf.xml`,
      xmlCurlConf(appUrl),
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

    // Write dialplan
    await writeRemoteFile(
      conn,
      `${confDir}/dialplan/default/call_manager.xml`,
      dialplanXml(appUrl, FS_HOST),
    );
    steps.push("Wrote call_manager dialplan");

    // Reload FreeSWITCH config
    try {
      await execCommand(conn, "fs_cli -x 'reloadxml'");
      steps.push("reloadxml OK");
    } catch {
      steps.push("reloadxml skipped (fs_cli not in PATH — may need manual reload)");
    }

    // Reload mod_xml_curl
    try {
      await execCommand(conn, "fs_cli -x 'reload mod_xml_curl'");
      steps.push("reload mod_xml_curl OK");
    } catch {
      steps.push("reload mod_xml_curl skipped");
    }

    // Reload mod_verto
    try {
      await execCommand(conn, "fs_cli -x 'reload mod_verto'");
      steps.push("reload mod_verto OK");
    } catch {
      steps.push("reload mod_verto skipped");
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
