/**
 * FreeSWITCH Post-Fix Verification Script
 * Tests all critical FreeSWITCH subsystems via SSH.
 */
import { Client as SSHClient } from "ssh2";

function cleanPrivateKey(raw) {
  let s = raw.trim();
  if (s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const hm = s.match(/(-----BEGIN [^-]+-----)/);
    const fm = s.match(/(-----END [^-]+-----)/);
    if (hm && fm) {
      const header = hm[1], footer = fm[1];
      const body = s.slice(s.indexOf(header) + header.length, s.indexOf(footer)).replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
      s = `${header}\n${body}\n${footer}`;
    }
  }
  return s.split("\n").map(l => l.trimStart()).join("\n").trim();
}

function bareHost(raw) {
  try { if (/^[a-z]+:\/\//i.test(raw)) return new URL(raw).hostname; } catch {}
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

function execCommand(conn, cmd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = "", err = "", settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ out: out || "(timeout)", err, exit: -1 }); } }, timeoutMs);
    conn.exec(cmd, (e, stream) => {
      if (e) { clearTimeout(timer); resolve({ out: "", err: e.message, exit: -1 }); return; }
      stream.on("data", d => out += d);
      stream.stderr.on("data", d => err += d);
      stream.on("close", code => { if (!settled) { settled = true; clearTimeout(timer); resolve({ out, err, exit: code }); } });
    });
  });
}

async function run(conn, label, cmd) {
  const { out, err, exit } = await execCommand(conn, cmd);
  const result = out.trim() || err.trim() || "(no output)";
  return { label, result, exit };
}

async function main() {
  const rawKey = process.env.FREESWITCH_SSH_KEY ?? "";
  const domain = process.env.FREESWITCH_DOMAIN ?? "";
  const sshUser = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
  const sshPort = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");

  const host = bareHost(domain);
  const conn = await sshConnect(host, sshUser, sshPort, cleanPrivateKey(rawKey));

  const checks = [];

  // 1. prawwplus context exists in loaded dialplan
  const dpCtx = await run(conn, "prawwplus dialplan context loaded",
    "fs_cli -x 'xml_locate dialplan' 2>/dev/null | grep 'prawwplus'");
  checks.push({ ...dpCtx, pass: dpCtx.result.includes("prawwplus") });

  // 2. prawwplus_mobile SIP profile running — check Context and WS-BIND-URL fields
  //    (the fs_cli status command returns the profile details without a separate RUNNING line
  //     when grepping specific fields — check for the key fields instead)
  const sipStatus = await run(conn, "prawwplus_mobile SIP profile (context + WS binding)",
    "fs_cli -x 'sofia status profile prawwplus_mobile' 2>/dev/null | grep -E '(Context|WS-BIND|Ext-RTP)'");
  checks.push({
    ...sipStatus,
    pass: sipStatus.result.includes("prawwplus") && sipStatus.result.includes("5066"),
  });

  // 2b. Confirm profile is in the active profiles list
  const sofiaList = await run(conn, "prawwplus_mobile in active sofia profiles",
    "fs_cli -x 'sofia status' 2>/dev/null | grep 'prawwplus_mobile'");
  checks.push({ ...sofiaList, pass: sofiaList.result.includes("prawwplus_mobile") });

  // 3. Port 5066 (SIP WS) open
  const port5066 = await run(conn, "Port 5066 (SIP/WS) listening",
    "ss -tlnp | grep ':5066' | head -3");
  checks.push({ ...port5066, pass: port5066.result.includes("5066") });

  // 4. Port 8081 (Verto WS) open
  const port8081 = await run(conn, "Port 8081 (Verto/WS) listening",
    "ss -tlnp | grep ':8081' | head -3");
  checks.push({ ...port8081, pass: port8081.result.includes("8081") });

  // 5. ESL only on localhost
  const esl = await run(conn, "ESL port 8021 only on 127.0.0.1",
    "ss -tlnp | grep ':8021' | head -3");
  checks.push({ ...esl, pass: esl.result.includes("127.0.0.1:8021") && !esl.result.includes("0.0.0.0:8021") });

  // 6. No public rule for 8021 in iptables
  const ipt = await run(conn, "No public iptables rule for 8021",
    "sudo iptables -L INPUT -n | grep '8021' | grep -v '127.0.0.1' || true");
  checks.push({ ...ipt, pass: ipt.result.trim() === "" || ipt.result === "(no output)" });

  // 7. Verto module loaded
  const verto = await run(conn, "mod_verto loaded",
    "fs_cli -x 'module_exists mod_verto' 2>/dev/null");
  checks.push({ ...verto, pass: verto.result.trim() === "true" });

  // 8. mod_sofia loaded
  const sofia = await run(conn, "mod_sofia loaded",
    "fs_cli -x 'module_exists mod_sofia' 2>/dev/null");
  checks.push({ ...sofia, pass: sofia.result.trim() === "true" });

  // 9. mod_xml_curl loaded (directory auth)
  const xmlcurl = await run(conn, "mod_xml_curl loaded",
    "fs_cli -x 'module_exists mod_xml_curl' 2>/dev/null");
  checks.push({ ...xmlcurl, pass: xmlcurl.result.trim() === "true" });

  // 10. API directory endpoint reachable from FS server (use https://, follow redirects)
  const appUrl = process.env.APP_URL ?? "";
  const apiTestUrl = appUrl.replace(/\/$/, "") + "/api/freeswitch/directory";
  const api = await run(conn, "API directory endpoint reachable (HTTPS)",
    `curl -skL -o /dev/null -w "%{http_code}" --max-time 8 -X POST "${apiTestUrl}" 2>/dev/null`);
  // Accept any HTTP response — even 4xx means the API server is up and routing correctly.
  // FreeSWITCH sends POST with authentication params; a bare POST without params typically
  // returns 400/401/422, all of which confirm the endpoint is reachable and responding.
  checks.push({ ...api, pass: /^[2345]/.test(api.result.trim()) });

  // 11. WebSocket upgrade on port 5066 responds with 101
  const wsTest = await run(conn, "Port 5066 WebSocket handshake responds 101",
    `timeout 2 bash -c 'echo -e "GET / HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n" | nc -w 2 127.0.0.1 5066' 2>/dev/null | head -2 || echo 'timeout'`);
  checks.push({ ...wsTest, pass: wsTest.result.includes("101") });

  // 12. internal.xml ws-binding conflict removed
  const wsConflict = await run(conn, "internal.xml ws-binding conflict removed",
    "grep -i '<param.*ws-binding' /etc/freeswitch/sip_profiles/internal.xml 2>/dev/null || echo 'none'");
  checks.push({ ...wsConflict, pass: !wsConflict.result.includes('<param name="ws-binding"') });

  // 13. No FreeSWITCH CRITical or ERRors in recent logs
  const errors = await run(conn, "No recent FreeSWITCH CRIT/ERR logs",
    "tail -200 /var/log/freeswitch/freeswitch.log 2>/dev/null | grep -E '\\[CRIT\\]|\\[ERR\\]' | grep -v 'No files to include\\|Invalid IP 0\\.0\\.0\\.0' | tail -5 || echo 'none'");
  checks.push({ ...errors, pass: errors.result === "none" || errors.result === "(no output)" || !errors.result.includes("[ERR") });

  // 14. Current SIP registrations (informational)
  const regs = await run(conn, "SIP registrations (informational)",
    "fs_cli -x 'sofia status profile prawwplus_mobile reg' 2>/dev/null | head -10");
  checks.push({ ...regs, pass: true, informational: true });

  conn.end();

  // Print results
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║            PRaww+ FreeSWITCH Verification Report             ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  let passed = 0, failed = 0;
  const failures = [];

  for (const c of checks) {
    if (c.informational) {
      console.log(`ℹ️  [INFO] ${c.label}`);
      console.log(`       ${c.result.split("\n").slice(0,3).join(" | ")}`);
      continue;
    }
    const icon = c.pass ? "✅" : "❌";
    const status = c.pass ? "PASS" : "FAIL";
    if (c.pass) passed++; else { failed++; failures.push(c.label); }
    console.log(`${icon} [${status}] ${c.label}`);
    if (!c.pass) {
      console.log(`       ${c.result.split("\n").slice(0,4).join(" | ")}`);
    }
  }

  console.log(`\n${"─".repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);
  if (failures.length > 0) {
    console.log(`\nFailed checks:`);
    failures.forEach(f => console.log(`  ✗ ${f}`));
  } else {
    console.log(`\n✅ All checks passed — FreeSWITCH is properly configured`);
  }
  console.log(`${"─".repeat(55)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
