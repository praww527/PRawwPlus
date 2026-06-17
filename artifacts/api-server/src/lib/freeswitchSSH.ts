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
import { cleanPrivateKey } from "./sshKey";
import {
  xmlCurlConf,
  voicemailConf,
  vertoConf,
  dialplanXml,
  eventSocketConf,
  sipProfileXml,
  publicDidDialplanXml,
} from "./freeswitchConfig";

const FS_DOMAIN    = process.env.FREESWITCH_DOMAIN ?? "";
const FS_SSH_PORT  = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
const FS_SSH_USER  = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
const FS_CONF_DIR  = process.env.FREESWITCH_CONF_DIR ?? "/usr/local/freeswitch/conf";
// Read from env only — never fall back to the insecure FreeSWITCH default.
const FS_ESL_PASS  = process.env.FREESWITCH_ESL_PASSWORD ?? "";

/** Strip protocol (wss://, ws://, https://, http://) and path/port for SSH/TCP use. */
function bareHost(raw: string): string {
  try {
    if (/^[a-z]+:\/\//i.test(raw)) return new URL(raw).hostname;
  } catch { /* fall through */ }
  return raw.split(":")[0].replace(/\/$/, "");
}

const FS_HOST = bareHost(FS_DOMAIN);

// FREESWITCH_EXT_IP: explicit public IP used for ext-rtp-ip / ext-sip-ip in the
// generated config.  FreeSWITCH does NOT resolve hostnames in ext-rtp-ip on all
// versions — it may embed the literal string in the SDP, making RTP unreachable
// from browsers.  Always set this to the bare public IPv4 of the VPS
// (e.g. "158.180.29.84").  Falls back to FS_HOST for backward compatibility.
const FS_EXT_IP = process.env.FREESWITCH_EXT_IP ? process.env.FREESWITCH_EXT_IP.trim() : FS_HOST;

function sshConnect(privateKey: string): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect({
      host:       FS_HOST,
      port:       FS_SSH_PORT,
      username:   FS_SSH_USER,
      privateKey: cleanPrivateKey(privateKey),
      readyTimeout: 10_000,
    });
  });
}

function execCommand(conn: SSHClient, cmd: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${cmd.slice(0, 80)}`));
      }
    }, timeoutMs);

    conn.exec(cmd, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        settled = true;
        reject(err);
        return;
      }
      let out = "";
      let errOut = "";
      stream.on("data", (d: Buffer) => { out += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code === 0) resolve(out.trim());
        else reject(new Error(errOut.trim() || `Exit code ${code}`));
      });
    });
  });
}

function writeRemoteFile(conn: SSHClient, path: string, content: string): Promise<void> {
  // Encode file content as base64 and decode it on the remote side.
  // This avoids the ssh2 stdin-EOF hang where `cat > file` blocks waiting
  // for EOF that never arrives when stream.end() isn't handled correctly.
  const b64 = Buffer.from(content, "utf8").toString("base64");
  const safePath = path.replace(/'/g, "'\\''");
  const safeDir  = path.replace(/'/g, "'\\''");
  const cmd =
    `mkdir -p "$(dirname '${safeDir}')" && ` +
    `echo '${b64}' | base64 -d > '${safePath}'`;
  return execCommand(conn, cmd, 20_000).then(() => undefined);
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

const PUSH_TOTAL_TIMEOUT_MS = 90_000;

export async function pushFreeSwitchConfig(opts: PushOptions = {}): Promise<PushResult> {
  const timeoutGuard = new Promise<PushResult>((resolve) =>
    setTimeout(() => resolve({
      success: false,
      steps: [],
      error: `pushFreeSwitchConfig timed out after ${PUSH_TOTAL_TIMEOUT_MS / 1000}s — check SSH/fs_cli access`,
    }), PUSH_TOTAL_TIMEOUT_MS),
  );
  return Promise.race([_pushFreeSwitchConfigImpl(opts), timeoutGuard]);
}

async function _pushFreeSwitchConfigImpl(opts: PushOptions = {}): Promise<PushResult> {
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

    // Write xml_curl.conf.
    //
    // IMPORTANT — secret source priority:
    //   1. Read FREESWITCH_WEBHOOK_SECRET from the VPS production .env so the
    //      token embedded in the URL always matches what the VPS API validates.
    //   2. Fall back to the local (Replit/dev) FREESWITCH_WEBHOOK_SECRET only
    //      when the VPS file is not accessible.
    //
    // This prevents a "secret mismatch" where the Replit env holds a different
    // value than the VPS API — which causes the directory to return "not found"
    // for every SIP auth request, blocking all registrations.
    steps.push(`Directory URL base: ${directoryBaseUrl}`);
    let webhookSecret = process.env.FREESWITCH_WEBHOOK_SECRET;
    try {
      const vpsEnvPath = "/home/ubuntu/PRawwPlus/.env";
      const vpsSecretLine = await execCommand(
        conn,
        `grep '^FREESWITCH_WEBHOOK_SECRET' '${vpsEnvPath}' 2>/dev/null | head -1 | cut -d= -f2-`,
        8_000,
      );
      const vpsSecret = vpsSecretLine.trim().replace(/^['"]|['"]$/g, "");
      if (vpsSecret) {
        webhookSecret = vpsSecret;
        steps.push("Using VPS production FREESWITCH_WEBHOOK_SECRET for xml_curl URL");
      } else {
        steps.push("VPS secret not found — falling back to local FREESWITCH_WEBHOOK_SECRET");
      }
    } catch (err) {
      steps.push(`VPS secret read failed (${(err as Error).message}) — using local secret`);
    }
    await writeRemoteFile(
      conn,
      `${confDir}/autoload_configs/xml_curl.conf.xml`,
      xmlCurlConf(directoryBaseUrl, webhookSecret),
    );
    steps.push("Wrote xml_curl.conf.xml");

    // Write verto.conf
    await writeRemoteFile(
      conn,
      `${confDir}/autoload_configs/verto.conf.xml`,
      vertoConf(FS_EXT_IP),
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
      sipProfileXml(FS_EXT_IP, appUrl),
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

    // Write public DID dialplan — replaces the stock FreeSWITCH placeholder
    // (5551212 → 1000 XML default) with a real lookup that routes any inbound
    // PSTN DID to the correct user extension via the PRaww+ API.
    const apiPort = parseInt(process.env.PORT ?? "8080");
    await writeRemoteFile(
      conn,
      `${confDir}/dialplan/public/00_inbound_did.xml`,
      publicDidDialplanXml(apiPort),
    );
    steps.push("Wrote public DID dialplan (00_inbound_did.xml)");

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

    // Remove stock FreeSWITCH default directory user files (extensions 1000-1019).
    //
    // FreeSWITCH ships with static XML files for these extensions in
    // conf/directory/default/.  Those files use $${domain} as their domain
    // name, which expands to FREESWITCH_DOMAIN (158.180.29.84).  When
    // mod_verto authenticates a login for e.g. 1001@158.180.29.84 it finds
    // these static files FIRST (before xml_curl is invoked) and compares the
    // stored $${default_password} against our per-user password — mismatch →
    // -32601 "Permission Denied".  Deleting the static files forces
    // FreeSWITCH to fall through to xml_curl for every user lookup.
    try {
      await execCommand(
        conn,
        `rm -f ${confDir}/directory/default/10{0,1}{0,1,2,3,4,5,6,7,8,9}.xml`,
      );
      steps.push("Removed stock default directory user files (1000-1019) so xml_curl is used for auth");
    } catch { /* ignore */ }

    // Locate fs_cli — try common install paths
    const fsCli = await execCommand(
      conn,
      "command -v fs_cli 2>/dev/null || " +
      "ls /usr/local/freeswitch/bin/fs_cli /usr/bin/fs_cli 2>/dev/null | head -1 || " +
      "echo ''",
    ).then((p) => p.trim()).catch(() => "");

    if (!fsCli) {
      // fs_cli not available — fall back to sending ESL commands directly via
      // the FreeSWITCH binary's -rp (reload profiles) flag, or via a raw TCP
      // ESL command using netcat / socat if present.
      // Most reliable fallback: use the freeswitch binary to send ESL commands
      // via its built-in -x flag (works even without fs_cli installed).
      const fsBin = await execCommand(
        conn,
        "command -v freeswitch 2>/dev/null || " +
        "ls /usr/local/freeswitch/bin/freeswitch /usr/bin/freeswitch 2>/dev/null | head -1 || " +
        "echo ''",
      ).then((p) => p.trim()).catch(() => "");

      const eslPassword = FS_ESL_PASS.replace(/'/g, "'\\''");

      // Also try netcat-based ESL: echo "auth <pass>\napi reloadxml\nexit\n" | nc host port
      const hasNc = await execCommand(conn, "command -v nc 2>/dev/null || echo ''")
        .then((p) => p.trim()).catch(() => "");

      if (fsBin) {
        // FreeSWITCH binary supports -x 'command' just like fs_cli
        try {
          await execCommand(conn, `${fsBin} -p '${eslPassword}' -x 'reloadxml'`);
          steps.push("reloadxml OK (via freeswitch binary)");
        } catch (e) {
          steps.push(`reloadxml via freeswitch binary failed: ${(e as Error).message}`);
        }
        try {
          await execCommand(conn, `${fsBin} -p '${eslPassword}' -x 'unload mod_xml_curl'`);
          await execCommand(conn, `${fsBin} -p '${eslPassword}' -x 'load mod_xml_curl'`);
          steps.push("mod_xml_curl reload OK (via freeswitch binary)");
        } catch (e) {
          steps.push(`mod_xml_curl reload via freeswitch binary failed: ${(e as Error).message}`);
        }
      } else if (hasNc) {
        // Last resort: pipe raw ESL commands through netcat
        const ncCmd =
          `printf 'auth ${eslPassword}\\n\\napi reloadxml\\n\\nexit\\n\\n' | ` +
          `nc -q2 127.0.0.1 8021 2>/dev/null || true`;
        try {
          await execCommand(conn, ncCmd);
          steps.push("reloadxml OK (via netcat ESL)");
        } catch {
          steps.push("reloadxml via netcat failed — FreeSWITCH will pick up changes on next restart");
        }
      } else {
        steps.push("fs_cli not found and no fallback available — FreeSWITCH will pick up changes on next restart");
      }
    } else {
      // Build a helper that always includes the ESL password and forces IPv4.
      // Without -H 127.0.0.1, fs_cli on dual-stack hosts may try ::1 first,
      // which is rejected when event_socket.conf binds only 127.0.0.1.
      const eslPassword = FS_ESL_PASS.replace(/'/g, "'\\''");
      const cli = `${fsCli} -H 127.0.0.1 -p '${eslPassword}'`;

      // 1. Reload FreeSWITCH XML config — must happen FIRST so subsequent module
      //    reloads read the new files from the XML cache, not the stale in-memory copy.
      //    fs_cli returns "+OK" on success and "-ERR ..." on failure WITHOUT a
      //    non-zero exit code, so we must inspect the response text — never
      //    silently continue on a failed reload.
      try {
        const reloadOut = (await execCommand(conn, `${cli} -x 'reloadxml'`)) ?? "";
        if (/\+OK/i.test(reloadOut)) {
          steps.push("reloadxml OK");
        } else {
          const msg = `reloadxml did NOT return +OK — response: ${reloadOut.trim().slice(0, 200) || "(empty)"}`;
          steps.push(msg);
          logger.error(`[FS] ${msg}`);
        }
      } catch (e) {
        const msg = `reloadxml failed: ${(e as Error).message}`;
        steps.push(msg);
        logger.error(`[FS] ${msg}`);
      }

      // 2. Reload mod_xml_curl so it picks up the new gateway URL.
      //    IMPORTANT: we use `reload` (not unload+load) here because unloading
      //    mod_xml_curl causes FreeSWITCH to lose its XML provider momentarily,
      //    which triggers an internal configuration refresh that stops
      //    mod_event_socket as a side effect — and FreeSWITCH does NOT
      //    automatically reload it. `reload mod_xml_curl` avoids this by
      //    hot-swapping the module without dropping the XML provider registration.
      try {
        await execCommand(conn, `${cli} -x 'reload mod_xml_curl'`);
        steps.push("mod_xml_curl reload OK");
      } catch (e) {
        steps.push(`mod_xml_curl reload failed: ${(e as Error).message}`);
      }

      // 2b. Safety net: if mod_event_socket went down (port 8021 not listening)
      //     due to any FreeSWITCH internal reload, restore it.  We use netcat
      //     here instead of fs_cli because fs_cli itself needs ESL (8021) to
      //     connect — if the port is down, fs_cli can't help.  The freeswitch
      //     binary -x flag is equivalent and does NOT require 8021 to be up.
      try {
        const is8021Up = await execCommand(conn, "ss -tlnp | grep ':8021 ' | grep -q LISTEN && echo yes || echo no")
          .then((o) => o.trim() === "yes").catch(() => false);
        if (!is8021Up) {
          // Try freeswitch binary -x first, fall back to netcat ESL
          const fsBin = await execCommand(
            conn,
            "command -v freeswitch 2>/dev/null || ls /usr/local/freeswitch/bin/freeswitch 2>/dev/null | head -1 || echo ''",
          ).then((p) => p.trim()).catch(() => "");
          const eslPw = FS_ESL_PASS.replace(/'/g, "'\\''");
          if (fsBin) {
            await execCommand(conn, `${fsBin} -p '${eslPw}' -x 'load mod_event_socket'`).catch(() => null);
          }
          // Verify it came back up
          await new Promise((r) => setTimeout(r, 1000));
          const nowUp = await execCommand(conn, "ss -tlnp | grep ':8021 ' | grep -q LISTEN && echo yes || echo no")
            .then((o) => o.trim() === "yes").catch(() => false);
          steps.push(nowUp
            ? "mod_event_socket restored (was down after xml_curl reload)"
            : "mod_event_socket still down after restore attempt — FS restart may be needed");
        } else {
          steps.push("mod_event_socket still listening on 8021 after xml_curl reload ✓");
        }
      } catch (e) {
        steps.push(`mod_event_socket safety check failed: ${(e as Error).message}`);
      }

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
        // 3. Reload mod_event_socket so the new ACL/password takes effect immediately.
        //    Only runs on a full admin-triggered push, NOT on startup (lightReload).
        //
        //    CRITICAL DESIGN NOTE — do NOT use `unload mod_event_socket` here.
        //    Unloading mod_event_socket closes port 8021, which immediately drops
        //    fs_cli's connection.  The subsequent `load mod_event_socket` then fails
        //    because fs_cli needs port 8021 to be open to issue commands — leaving ESL
        //    permanently dead until FreeSWITCH is manually restarted.
        //
        //    Strategy (in order of preference):
        //      1. `reload mod_event_socket` via fs_cli — hot-swaps the module without
        //         dropping the ESL connection.  reloadxml already updated the XML cache,
        //         so the new password/ACL is picked up on reload.
        //      2. Netcat raw ESL — pipe the reload command directly to port 8021 without
        //         needing fs_cli (useful if fs_cli isn't available).
        //      3. Skip gracefully — reloadxml already refreshed the config; the new
        //         settings take effect on the next FreeSWITCH restart at worst.
        try {
          const reloadOut = await execCommand(conn, `${cli} -x 'reload mod_event_socket'`);
          steps.push(`mod_event_socket reload OK — ESL config reloaded${reloadOut ? `: ${reloadOut.slice(0, 120)}` : ""}`);
        } catch (e) {
          const msg = (e as Error).message ?? "";
          // Fallback: pipe the reload command directly to ESL via netcat (no fs_cli needed).
          const hasNc = await execCommand(conn, "command -v nc 2>/dev/null || echo ''")
            .then((p) => p.trim()).catch(() => "");
          if (hasNc) {
            const eslPw2 = FS_ESL_PASS.replace(/'/g, "'\\''");
            const ncCmd = `printf 'auth ${eslPw2}\\n\\napi reload mod_event_socket\\n\\nexit\\n\\n' | nc -q2 127.0.0.1 8021 2>/dev/null || true`;
            await execCommand(conn, ncCmd).catch(() => null);
            steps.push("mod_event_socket reload via netcat ESL fallback");
          } else {
            // reloadxml already refreshed the XML cache; new settings take effect on next restart.
            steps.push(`mod_event_socket reload skipped (${msg.slice(0, 80)}) — reloadxml already applied new config`);
          }
        }

        // 4. Full reload: unload + load mod_verto so it picks up the new verto.conf.
        //    `reload mod_verto` does NOT reliably reload profile bindings — only a
        //    full cycle does.  reloadxml already ran above so the cache is fresh.
        //
        //    CRITICAL: after `unload mod_verto` the kernel keeps port 8081 in
        //    TIME_WAIT for a short period (TCP linger).  Loading immediately causes
        //    `Bind Error!, errno=98 (Address already in use)` which leaves mod_verto
        //    with no listeners.  We poll `ss` until the port is free (up to 6 s)
        //    before issuing `load mod_verto`.
        try {
          await execCommand(conn, `${cli} -x 'unload mod_verto'`);

          // Poll until port 8081 is released (max 6 × 1 s = 6 s)
          let portFree = false;
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            const portCheck = await execCommand(
              conn,
              "ss -tlnp | grep ':8081 ' | grep -q LISTEN && echo busy || echo free",
            ).then((o) => o.trim()).catch(() => "free");
            if (portCheck === "free") { portFree = true; break; }
          }
          if (!portFree) {
            // Force-free the port: kill any lingering process bound to 8081
            await execCommand(conn, "fuser -k 8081/tcp 2>/dev/null || true").catch(() => null);
            await new Promise((r) => setTimeout(r, 500));
          }

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
        } catch (_e) {
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

export async function testSSHConnection(): Promise<{ ok: boolean; output?: string; error?: string }> {
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
    return { ok: true, output: out };
  } catch (err: unknown) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}
