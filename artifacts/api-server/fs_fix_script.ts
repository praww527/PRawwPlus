import { Client as SSHClient } from "ssh2";
import { cleanPrivateKey } from "./src/lib/sshKey";

const FS_HOST = (process.env.FREESWITCH_DOMAIN ?? "").replace(/^[a-z]+:\/\//i, "").split(":")[0].replace(/\/$/, "");
const FS_SSH_USER = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
const FS_SSH_PORT = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
const FS_ESL_PASS = process.env.FREESWITCH_ESL_PASSWORD ?? "";

function sshConnect(key: string): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect({ host: FS_HOST, port: FS_SSH_PORT, username: FS_SSH_USER, privateKey: cleanPrivateKey(key), readyTimeout: 10_000 });
  });
}

function exec(conn: SSHClient, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "", err = "";
    const t = setTimeout(() => reject(new Error(`Timeout: ${cmd.slice(0,60)}`)), 20_000);
    conn.exec(cmd, (e, s) => {
      if (e) { clearTimeout(t); reject(e); return; }
      s.on("data", (d: Buffer) => out += d);
      s.stderr.on("data", (d: Buffer) => err += d);
      s.on("close", (code: number) => { clearTimeout(t); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`)); });
    });
  });
}

async function main() {
  const rawKey = process.env.FREESWITCH_SSH_KEY;
  if (!rawKey || !FS_HOST) { console.error("Missing FREESWITCH_SSH_KEY or domain"); process.exit(1); }

  const conn = await sshConnect(rawKey);
  const eslPw = FS_ESL_PASS.replace(/'/g, "'\\''");

  // Find freeswitch binary and fs_cli
  const fsBin = await exec(conn, "command -v freeswitch 2>/dev/null || ls /usr/local/freeswitch/bin/freeswitch 2>/dev/null | head -1 || echo ''").then(s => s.trim()).catch(() => "");
  const fsCli = await exec(conn, "command -v fs_cli 2>/dev/null || ls /usr/local/freeswitch/bin/fs_cli 2>/dev/null | head -1 || echo ''").then(s => s.trim()).catch(() => "");
  console.log("freeswitch binary:", fsBin || "(not found)");
  console.log("fs_cli:", fsCli || "(not found)");

  // Step 1: Check whether ESL (port 8021) is up
  const esl8021 = await exec(conn, "ss -tlnp | grep ':8021 ' | grep -q LISTEN && echo yes || echo no").then(s => s.trim()).catch(() => "unknown");
  console.log("\nESL port 8021 status:", esl8021);

  if (esl8021 !== "yes" && fsBin) {
    console.log("ESL is DOWN — loading mod_event_socket via freeswitch binary...");
    const out = await exec(conn, `${fsBin} -p '${eslPw}' -x 'load mod_event_socket'`).catch(e => `FAILED: ${e.message}`);
    console.log("load mod_event_socket:", out);
    // Wait for it to come up
    await new Promise(r => setTimeout(r, 2000));
    const nowUp = await exec(conn, "ss -tlnp | grep ':8021 ' | grep -q LISTEN && echo yes || echo no").then(s => s.trim()).catch(() => "no");
    console.log("ESL port 8021 after load:", nowUp);
  }

  // Step 2: Use fs_cli (now 8021 should be up) for mod_verto and sofia
  const cli = fsCli ? `${fsCli} -H 127.0.0.1 -p '${eslPw}'` : "";

  // Step 3: Reload mod_verto (unload, wait for port free, load)
  console.log("\n--- mod_verto full cycle ---");
  if (cli) {
    const unloadOut = await exec(conn, `${cli} -x 'unload mod_verto'`).catch(e => `FAILED: ${e.message}`);
    console.log("unload mod_verto:", unloadOut);

    // Poll until port 8081 is free (up to 8s)
    let portFree = false;
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const chk = await exec(conn, "ss -tlnp | grep ':8081 ' | grep -q LISTEN && echo busy || echo free").then(s => s.trim()).catch(() => "free");
      console.log(`  port 8081 check ${i+1}/8: ${chk}`);
      if (chk === "free") { portFree = true; break; }
    }
    if (!portFree) {
      console.log("  Force-killing port 8081...");
      await exec(conn, "fuser -k 8081/tcp 2>/dev/null || true").catch(() => null);
      await new Promise(r => setTimeout(r, 500));
    }

    const loadOut = await exec(conn, `${cli} -x 'load mod_verto'`).catch(e => `FAILED: ${e.message}`);
    console.log("load mod_verto:", loadOut);
  } else if (fsBin) {
    const out = await exec(conn, `${fsBin} -p '${eslPw}' -x 'reload mod_verto'`).catch(e => `FAILED: ${e.message}`);
    console.log("reload mod_verto (via freeswitch bin):", out);
  }

  // Step 4: Start/rescan the SIP mobile profile
  console.log("\n--- sofia mobile profile ---");
  if (cli) {
    const startOut = await exec(conn, `${cli} -x 'sofia profile prawwplus_mobile start'`).catch(() => null);
    if (startOut) {
      console.log("sofia start:", startOut);
    } else {
      const rescanOut = await exec(conn, `${cli} -x 'sofia profile prawwplus_mobile rescan'`).catch(e => `FAILED: ${e.message}`);
      console.log("sofia rescan:", rescanOut);
    }
  }

  // Step 5: Reload mod_voicemail
  console.log("\n--- mod_voicemail ---");
  if (cli) {
    const vmOut = await exec(conn, `${cli} -x 'reload mod_voicemail'`).catch(e => `FAILED: ${e.message}`);
    console.log("reload mod_voicemail:", vmOut);
  }

  // Step 6: Final status
  console.log("\n--- FreeSWITCH status ---");
  const status = await exec(conn, fsCli ? `${fsCli} -H 127.0.0.1 -p '${eslPw}' -x 'status'` : `${fsBin} -p '${eslPw}' -x 'status'`).catch(e => `FAILED: ${e.message}`);
  console.log(status);

  // Step 7: Check Verto port
  const verto8081 = await exec(conn, "ss -tlnp | grep ':8081 ' | grep -q LISTEN && echo LISTENING || echo DOWN").then(s => s.trim()).catch(() => "unknown");
  console.log("Verto port 8081:", verto8081);

  // Step 8: Check SIP/WS port for mobile
  const sip5066 = await exec(conn, "ss -tlnp | grep ':5066 ' | grep -q LISTEN && echo LISTENING || echo DOWN").then(s => s.trim()).catch(() => "unknown");
  console.log("SIP/WS port 5066:", sip5066);

  conn.end();
  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
