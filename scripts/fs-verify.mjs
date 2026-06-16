/**
 * FreeSWITCH Post-Fix Verification Script
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

  // 2. prawwplus_mobile SIP profile running with WS on 5066
  const sipStatus = await run(conn, "prawwplus_mobile SIP profile running",
    "fs_cli -x 'sofia status profile prawwplus_mobile' 2>/dev/null | grep -E '(RUNNING|WS-BIND|Context|Ext-RTP)'");
  checks.push({ ...sipStatus, pass: sipStatus.result.includes("RUNNING") && sipStatus.result.includes("5066") });

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
    "sudo iptables -L INPUT -n | grep '8021' | grep -v '127.0.0.1'");
  checks.push({ ...ipt, pass: ipt.result === "(no output)" || ipt.result === "" || ipt.exit !== 0 });

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

  // 10. API directory endpoint reachable from FS server
  const appUrl = process.env.APP_URL ?? "";
  const api = await run(conn, "API directory endpoint reachable",
    `curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${appUrl}/api/freeswitch/directory" 2>/dev/null`);
  checks.push({ ...api, pass: ["200","401","403"].some(c => api.result.includes(c)) });

  // 11. Current SIP registrations
  const regs = await run(conn, "Current SIP registrations",
    "fs_cli -x 'sofia status profile prawwplus_mobile reg' 2>/dev/null | head -20");
  checks.push({ ...regs, pass: true }); // informational

  // 12. Check internal.xml ws-binding (potential conflict)
  const wsConflict = await run(conn, "internal.xml ws-binding (conflict check)",
    "grep -i 'ws-binding' /etc/freeswitch/sip_profiles/internal.xml 2>/dev/null || echo 'none'");
  checks.push({ ...wsConflict, pass: true }); // informational

  // 13. Recent ERROR/WARN logs
  const errors = await run(conn, "Recent FreeSWITCH ERRORs (last 2 min)",
    "tail -100 /var/log/freeswitch/freeswitch.log 2>/dev/null | grep -E '\\[ERR|\\[CRIT' | tail -10 || echo 'none'");
  checks.push({ ...errors, pass: true }); // informational

  conn.end();

  // Print results
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║            PRaww+ FreeSWITCH Verification Report             ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  let passed = 0, failed = 0;
  for (const c of checks) {
    if (c.pass !== undefined) {
      const icon = c.pass ? "✅" : "❌";
      const status = c.pass ? "PASS" : "FAIL";
      if (c.pass) passed++; else failed++;
      console.log(`${icon} [${status}] ${c.label}`);
      if (!c.pass || c.label.includes("registrations") || c.label.includes("ERRORs") || c.label.includes("conflict")) {
        console.log(`       ${c.result.split("\n").slice(0,3).join(" | ")}`);
      }
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`─────────────────────────────────────\n`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
