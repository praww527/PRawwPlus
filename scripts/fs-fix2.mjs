/**
 * FreeSWITCH Fix Round 2
 *  1. Remove ws-binding:5066 from internal.xml (conflicts with prawwplus_mobile)
 *  2. Remove ALL public iptables rules for port 8021
 *  3. Restart internal sofia profile and verify
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

function execCommand(conn, cmd, timeoutMs = 30000) {
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
  console.log(`\n▶ ${label}`);
  const { out, err, exit } = await execCommand(conn, cmd);
  if (out.trim()) console.log("  " + out.trim().split("\n").join("\n  "));
  if (err.trim() && !err.includes("No chain/target") && !err.includes("Bad rule")) console.log("  STDERR:", err.trim());
  console.log(`  Exit: ${exit}`);
  return { out: out.trim(), err: err.trim(), exit };
}

async function main() {
  const host = bareHost(process.env.FREESWITCH_DOMAIN ?? "");
  const sshUser = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
  const sshPort = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
  const privateKey = cleanPrivateKey(process.env.FREESWITCH_SSH_KEY ?? "");

  console.log(`\n╔══ PRaww+ Fix Round 2 ═══╗`);
  console.log(`Target: ${sshUser}@${host}:${sshPort}`);

  const conn = await sshConnect(host, sshUser, sshPort, privateKey);
  console.log("✓ SSH connected\n");

  // ── FIX A: Remove ws-binding:5066 from internal.xml ────────────────────────
  // The internal profile was binding ws on 5066 AND routing to "default" context.
  // That means SIP WS registrations could land on the wrong profile.
  // We need only prawwplus_mobile to handle port 5066.
  console.log("═══ FIX A: Remove ws-binding:5066 conflict from internal.xml ═══");

  // Backup first
  await run(conn, "Backup internal.xml", 
    "cp /etc/freeswitch/sip_profiles/internal.xml /etc/freeswitch/sip_profiles/internal.xml.bak_$(date +%Y%m%d_%H%M%S)");

  // Show current ws-binding lines in internal.xml
  await run(conn, "Current ws-binding in internal.xml",
    "grep -n 'ws-binding\\|wss-binding' /etc/freeswitch/sip_profiles/internal.xml");

  // Remove the ws-binding and wss-binding lines from internal.xml
  // (comment them out so they can be restored if needed)
  await run(conn, "Comment out ws-binding in internal.xml",
    `sed -i 's|<param name="ws-binding".*/>|<!-- DISABLED by PRaww+: ws-binding moved to prawwplus_mobile profile -->|g' /etc/freeswitch/sip_profiles/internal.xml && sed -i 's|<param name="wss-binding".*/>|<!-- DISABLED by PRaww+: wss-binding moved to prawwplus_mobile profile -->|g' /etc/freeswitch/sip_profiles/internal.xml`);

  // Verify the change
  await run(conn, "Verify internal.xml ws-binding removed",
    "grep -n 'ws-binding\\|wss-binding\\|DISABLED' /etc/freeswitch/sip_profiles/internal.xml | head -10 || echo 'No ws-binding lines found'");

  // ── FIX B: Remove ALL public iptables rules for port 8021 ──────────────────
  console.log("\n═══ FIX B: Remove ALL public iptables rules for port 8021 ═══");

  // Remove in a loop (iptables rule numbers shift after each deletion, so delete by spec)
  await run(conn, "Remove all public 8021 rules (run multiple times to clear duplicates)",
    `for i in 1 2 3 4 5; do sudo iptables -D INPUT -p tcp --dport 8021 -j ACCEPT 2>/dev/null && echo "Removed rule $i" || break; done`);

  // Also remove any 0.0.0.0/0 rules that might be under a different format
  await run(conn, "Remove via -s 0.0.0.0/0 format",
    `sudo iptables -D INPUT -s 0.0.0.0/0 -p tcp --dport 8021 -j ACCEPT 2>/dev/null && echo 'removed 0.0.0.0 rule' || echo 'none'`);

  // Verify localhost rule is still in place
  await run(conn, "Ensure localhost ESL rule exists",
    "sudo iptables -C INPUT -s 127.0.0.1 -p tcp --dport 8021 -j ACCEPT 2>/dev/null && echo 'loopback rule OK' || (sudo iptables -I INPUT 2 -s 127.0.0.1 -p tcp --dport 8021 -j ACCEPT && echo 'Added loopback rule')");

  // Save iptables
  await run(conn, "Save iptables rules persistently",
    "sudo netfilter-persistent save 2>/dev/null || (sudo sh -c 'iptables-save > /etc/iptables/rules.v4' && echo 'Saved to /etc/iptables/rules.v4') || echo 'save attempted'");

  // ── RELOAD: Restart internal profile to release port 5066 ─────────────────
  console.log("\n═══ RELOAD: Restart internal SIP profile ═══");
  await run(conn, "Restart internal sofia profile",
    "fs_cli -x 'sofia profile internal restart' 2>/dev/null", 20000);

  await new Promise(r => setTimeout(r, 2000));

  await run(conn, "Restart prawwplus_mobile profile (ensure it holds 5066)",
    "fs_cli -x 'sofia profile prawwplus_mobile restart' 2>/dev/null", 20000);

  await new Promise(r => setTimeout(r, 2000));

  // ── FINAL VERIFICATION ─────────────────────────────────────────────────────
  console.log("\n═══ FINAL VERIFICATION ═══");

  await run(conn, "Port 5066 listeners",
    "ss -tlnp | grep ':5066'");

  await run(conn, "Port 8081 listeners",
    "ss -tlnp | grep ':8081'");

  await run(conn, "Port 8021 listeners (should be 127.0.0.1 only)",
    "ss -tlnp | grep ':8021'");

  await run(conn, "iptables INPUT rules for port 8021",
    "sudo iptables -L INPUT -n | grep '8021'");

  await run(conn, "sofia profiles status",
    "fs_cli -x 'sofia status' 2>/dev/null");

  await run(conn, "prawwplus_mobile WS binding",
    "fs_cli -x 'sofia status profile prawwplus_mobile' 2>/dev/null | grep -E '(RUNNING|WS-BIND|Context|Ext-RTP|SIP-IP)'");

  await run(conn, "internal.xml ws-binding check",
    "grep -i 'ws-binding' /etc/freeswitch/sip_profiles/internal.xml || echo 'No ws-binding in internal.xml - GOOD'");

  await run(conn, "Dialplan contexts loaded",
    "fs_cli -x 'xml_locate dialplan' 2>/dev/null | grep '<context'");

  // Quick test: Try a SIP REGISTER via nc to see what happens on port 5066
  await run(conn, "Port 5066 WS accept test (TCP handshake)",
    `timeout 2 bash -c 'echo -e "GET / HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: test==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n" | nc -w 2 127.0.0.1 5066' 2>/dev/null | head -5 || echo 'WS upgrade test done'`);

  // Check recent logs for errors
  await run(conn, "Recent FS logs (last 20 lines)",
    "tail -20 /var/log/freeswitch/freeswitch.log 2>/dev/null | grep -E '(ERR|WARN|INFO.*prawwplus|sofia|verto)' | tail -15");

  conn.end();
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   Fix round 2 complete               ║");
  console.log("╚══════════════════════════════════════╝\n");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
