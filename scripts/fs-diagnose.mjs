/**
 * FreeSWITCH SSH Diagnostic Script
 * Connects via SSH and runs comprehensive call-flow diagnostics.
 */
import { Client as SSHClient } from "ssh2";

function cleanPrivateKey(raw) {
  let s = raw.trim();
  if (s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const headerMatch = s.match(/(-----BEGIN [^-]+-----)/);
    const footerMatch = s.match(/(-----END [^-]+-----)/);
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      const contentStart = s.indexOf(header) + header.length;
      const contentEnd = s.indexOf(footer);
      const rawBody = s.slice(contentStart, contentEnd).replace(/\s+/g, "");
      const body = rawBody.match(/.{1,64}/g)?.join("\n") ?? rawBody;
      s = `${header}\n${body}\n${footer}`;
    }
  }
  return s.split("\n").map(l => l.trimStart()).join("\n").trim();
}

function bareHost(raw) {
  try {
    if (/^[a-z]+:\/\//i.test(raw)) return new URL(raw).hostname;
  } catch {}
  return raw.split(":")[0].replace(/\/$/, "");
}

function sshConnect(host, user, port, privateKey) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect({ host, port, username: user, privateKey, readyTimeout: 15000 });
  });
}

function execCommand(conn, cmd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let out = "", err = "", settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ out: out || "(timeout)", err, exit: -1 }); }
    }, timeoutMs);
    conn.exec(cmd, (e, stream) => {
      if (e) { clearTimeout(timer); resolve({ out: "", err: e.message, exit: -1 }); return; }
      stream.on("data", d => out += d);
      stream.stderr.on("data", d => err += d);
      stream.on("close", (code) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve({ out, err, exit: code }); }
      });
    });
  });
}

async function main() {
  const rawKey = process.env.FREESWITCH_SSH_KEY ?? "";
  const domain = process.env.FREESWITCH_DOMAIN ?? "";
  const sshUser = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
  const sshPort = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
  const eslPass = process.env.FREESWITCH_ESL_PASSWORD ?? "";

  if (!rawKey || rawKey.includes("YOUR_KEY_HERE")) {
    console.error("ERROR: FREESWITCH_SSH_KEY is not set or still placeholder");
    process.exit(1);
  }
  if (!domain || domain === "YOUR_VPS_PUBLIC_IP") {
    console.error("ERROR: FREESWITCH_DOMAIN is not set or still placeholder");
    process.exit(1);
  }

  const host = bareHost(domain);
  const privateKey = cleanPrivateKey(rawKey);

  console.log(`\n====== FreeSWITCH Diagnostic Report ======`);
  console.log(`Target: ${sshUser}@${host}:${sshPort}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  let conn;
  try {
    conn = await sshConnect(host, sshUser, sshPort, privateKey);
    console.log("✓ SSH connected successfully\n");
  } catch (e) {
    console.error(`✗ SSH connection failed: ${e.message}`);
    process.exit(1);
  }

  const run = async (label, cmd) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`>>> ${label}`);
    console.log(`CMD: ${cmd}`);
    console.log("=".repeat(60));
    const { out, err, exit } = await execCommand(conn, cmd, 25000);
    if (out.trim()) console.log(out.trim());
    if (err.trim()) console.log("STDERR:", err.trim());
    console.log(`Exit: ${exit}`);
    return out.trim();
  };

  // 1. FreeSWITCH version and status
  await run("FreeSWITCH Version", "fs_cli -x 'version' 2>/dev/null || sudo fs_cli -x 'version' 2>/dev/null || echo 'fs_cli not in PATH'");
  await run("FreeSWITCH Status", "fs_cli -x 'status' 2>/dev/null || sudo fs_cli -x 'status' 2>/dev/null || echo 'fs_cli not in PATH'");
  await run("FreeSWITCH Process", "systemctl status freeswitch --no-pager -l 2>/dev/null || service freeswitch status 2>/dev/null || ps aux | grep freeswitch | grep -v grep");

  // 2. SIP registrations — who is currently registered
  await run("SIP Registrations (sofia status profile)", 
    "fs_cli -x 'sofia status profile internal' 2>/dev/null || sudo fs_cli -x 'sofia status profile internal' 2>/dev/null || echo 'no internal profile'");
  await run("SIP Registrations (sofia xmlstatus)", 
    "fs_cli -x 'sofia xmlstatus reg' 2>/dev/null | head -100 || echo 'no reg'");
  await run("All SIP Profiles status", 
    "fs_cli -x 'sofia status' 2>/dev/null || sudo fs_cli -x 'sofia status' 2>/dev/null");
  await run("Registered SIP users",
    "fs_cli -x 'sofia status profile internal reg' 2>/dev/null | head -60 || echo 'none'");

  // 3. Verto module status
  await run("Verto Module Status", 
    "fs_cli -x 'verto status' 2>/dev/null || sudo fs_cli -x 'verto status' 2>/dev/null || echo 'verto not responding'");
  await run("Verto Sessions", 
    "fs_cli -x 'show channels' 2>/dev/null | head -30 || echo 'none'");

  // 4. Active calls
  await run("Active Calls", 
    "fs_cli -x 'show calls' 2>/dev/null | head -40 || echo 'none'");
  await run("Show Channels Detail", 
    "fs_cli -x 'show channels as delim |' 2>/dev/null | head -30 || echo 'none'");

  // 5. ESL connectivity
  await run("ESL Port Listening", 
    "ss -tlnp | grep 8021 || netstat -tlnp 2>/dev/null | grep 8021 || echo 'port 8021 not found'");
  await run("Verto Port 8081 Listening", 
    "ss -tlnp | grep 8081 || netstat -tlnp 2>/dev/null | grep 8081 || echo 'port 8081 not found'");
  await run("SIP WS Port 5066 Listening", 
    "ss -tlnp | grep 5066 || netstat -tlnp 2>/dev/null | grep 5066 || echo 'port 5066 not found'");
  await run("SIP 5060 Listening", 
    "ss -ulnp | grep 5060 || ss -tlnp | grep 5060 || echo 'port 5060 not found'");

  // 6. Recent FreeSWITCH logs — errors and call events
  await run("Recent FS Logs (last 200 lines)", 
    "tail -200 /var/log/freeswitch/freeswitch.log 2>/dev/null || tail -200 /usr/local/freeswitch/log/freeswitch.log 2>/dev/null || journalctl -u freeswitch --no-pager -n 200 2>/dev/null || echo 'log not found'");

  // 7. Config files — check what's actually deployed
  await run("FreeSWITCH Config Dir", 
    "ls -la /etc/freeswitch/ 2>/dev/null || ls -la /usr/local/freeswitch/conf/ 2>/dev/null");
  await run("xml_curl.conf", 
    "cat /etc/freeswitch/autoload_configs/xml_curl.conf.xml 2>/dev/null || cat /usr/local/freeswitch/conf/autoload_configs/xml_curl.conf.xml 2>/dev/null || echo 'not found'");
  await run("verto.conf", 
    "cat /etc/freeswitch/autoload_configs/verto.conf.xml 2>/dev/null || cat /usr/local/freeswitch/conf/autoload_configs/verto.conf.xml 2>/dev/null || echo 'not found'");
  await run("event_socket.conf", 
    "cat /etc/freeswitch/autoload_configs/event_socket.conf.xml 2>/dev/null || cat /usr/local/freeswitch/conf/autoload_configs/event_socket.conf.xml 2>/dev/null || echo 'not found'");
  await run("dialplan default.xml",
    "cat /etc/freeswitch/dialplan/default.xml 2>/dev/null || cat /usr/local/freeswitch/conf/dialplan/default.xml 2>/dev/null || echo 'not found'");
  await run("internal.xml SIP profile",
    "cat /etc/freeswitch/sip_profiles/internal.xml 2>/dev/null || cat /usr/local/freeswitch/conf/sip_profiles/internal.xml 2>/dev/null || echo 'not found'");

  // 8. Dialplan test — what happens when a call is made
  await run("Dialplan show (XML dump)",
    "fs_cli -x 'xml_locate dialplan' 2>/dev/null | head -80 || echo 'not available'");

  // 9. Codec check 
  await run("Loaded Modules",
    "fs_cli -x 'module_exists mod_verto' 2>/dev/null; fs_cli -x 'module_exists mod_sofia' 2>/dev/null; fs_cli -x 'module_exists mod_xml_curl' 2>/dev/null || echo 'done'");
  await run("Show Codecs",
    "fs_cli -x 'show codec' 2>/dev/null | head -30 || echo 'not available'");

  // 10. Network/firewall — ports that need to be open
  await run("Firewall rules (iptables)",
    "sudo iptables -L INPUT -n --line-numbers 2>/dev/null | head -40 || echo 'no iptables access'");
  await run("RTP Port Range",
    "ss -u | grep -E ':(16[0-9]{3}|[2-5][0-9]{4})' | head -20 || echo 'no active RTP'");

  // 11. API server reachability from FS server
  const appUrl = process.env.APP_URL ?? "";
  if (appUrl) {
    await run(`API Reachability (directory endpoint)`,
      `curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${appUrl}/api/freeswitch/directory" 2>/dev/null || echo 'curl failed'`);
  }

  // 12. ESL direct test
  await run("ESL direct nc test",
    `timeout 3 bash -c 'echo "" | nc -w 2 127.0.0.1 8021' 2>/dev/null | head -5 || echo 'ESL not reachable via nc'`);

  conn.end();
  console.log("\n====== End of Diagnostic Report ======\n");
}

main().catch(e => { console.error(e); process.exit(1); });
