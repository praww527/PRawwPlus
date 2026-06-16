/**
 * PRaww+ — Coturn TURN/STUN Server Setup via SSH
 *
 * Installs and configures Coturn on the FreeSWITCH VPS so that WebRTC calls
 * work on all network types: WiFi, 5G, 4G, 3G, and symmetric-NAT corporate networks.
 *
 * Usage:
 *   node scripts/setup-coturn.mjs
 *
 * Required env vars (loaded from .env automatically):
 *   FREESWITCH_SSH_KEY   — SSH private key PEM (multi-line, or \n-escaped)
 *   FREESWITCH_SSH_USER  — SSH username (default: ubuntu)
 *   FREESWITCH_SSH_PORT  — SSH port      (default: 22)
 *   FREESWITCH_DOMAIN    — VPS hostname or IP (e.g. 158.180.29.84)
 *   TURN_HOST            — TURN server hostname  (default: same as FREESWITCH_DOMAIN)
 *   TURN_SECRET          — Shared HMAC secret for Coturn REST API auth
 *
 * After running, copy the printed env vars into your .env and restart the API server.
 */

import { Client as SSHClient } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env ──────────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val   = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const RED    = "\x1b[31m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const NC     = "\x1b[0m";

function info(msg)    { console.log(`${CYAN}[INFO]${NC}  ${msg}`); }
function ok(msg)      { console.log(`${GREEN}[OK]${NC}    ${msg}`); }
function warn(msg)    { console.log(`${YELLOW}[WARN]${NC}  ${msg}`); }
function fail(msg)    { console.error(`${RED}[ERROR]${NC} ${msg}`); }

function cleanPrivateKey(raw) {
  let s = raw.trim();
  if (s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const hm = s.match(/(-----BEGIN [^-]+-----)/);
    const fm = s.match(/(-----END [^-]+-----)/);
    if (hm && fm) {
      const header = hm[1], footer = fm[1];
      const body   = s.slice(s.indexOf(header) + header.length, s.indexOf(footer))
        .replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
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
    conn.connect({ host, port, username: user, privateKey, readyTimeout: 20000 });
  });
}

function exec(conn, cmd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let out = "", err = "", settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ out: out || "(timeout)", err, exit: -1 }); }
    }, timeoutMs);
    conn.exec(cmd, (e, stream) => {
      if (e) { clearTimeout(timer); resolve({ out: "", err: e.message, exit: -1 }); return; }
      stream.on("data",         d => out += d);
      stream.stderr.on("data",  d => err += d);
      stream.on("close", code => {
        if (!settled) { settled = true; clearTimeout(timer); resolve({ out, err, exit: code }); }
      });
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const rawKey  = process.env.FREESWITCH_SSH_KEY ?? "";
  const domain  = bareHost(process.env.FREESWITCH_DOMAIN ?? "");
  const sshUser = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
  const sshPort = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
  const turnHost   = process.env.TURN_HOST?.trim()   || domain;
  const turnSecret = process.env.TURN_SECRET?.trim() || "";

  if (!rawKey || rawKey.includes("YOUR_KEY_HERE")) {
    fail("FREESWITCH_SSH_KEY is not set (or is still a placeholder). Cannot SSH to VPS.");
    fail("Set it in your .env or Replit secrets and try again.");
    process.exit(1);
  }

  if (!domain) {
    fail("FREESWITCH_DOMAIN is not set. Cannot determine VPS address.");
    process.exit(1);
  }

  if (!turnSecret || turnSecret.includes("change_me")) {
    warn("TURN_SECRET is not set or is still a placeholder.");
    warn("Generate one with: openssl rand -hex 32");
    warn("Then set it in your .env as TURN_SECRET=<the value>");
    process.exit(1);
  }

  const privateKey = cleanPrivateKey(rawKey);
  info(`SSH connecting to ${sshUser}@${domain}:${sshPort} …`);

  let conn;
  try {
    conn = await sshConnect(domain, sshUser, sshPort, privateKey);
  } catch (err) {
    fail(`SSH connection failed: ${err.message}`);
    process.exit(1);
  }
  ok("SSH connected");

  // ── Check if coturn is already running ──────────────────────────────────────

  info("Checking existing Coturn installation …");
  const { out: svcOut } = await exec(conn, "systemctl is-active coturn 2>/dev/null || echo not-installed");
  const alreadyRunning = svcOut.trim() === "active";
  if (alreadyRunning) {
    warn("Coturn is already running. Script will reconfigure it (idempotent).");
  }

  // ── Detect public IP ────────────────────────────────────────────────────────

  info("Detecting VPS public IP …");
  const { out: ipOut } = await exec(conn, "curl -sf https://api4.my-ip.io/ip 2>/dev/null || curl -sf https://ipv4.icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}'");
  const publicIp = ipOut.trim().split("\n")[0].trim();
  if (!publicIp) {
    fail("Could not detect VPS public IP. Set PUBLIC_IP env var and retry.");
    conn.end();
    process.exit(1);
  }
  ok(`VPS public IP: ${publicIp}`);

  // ── Upload the coturn-setup.sh script ───────────────────────────────────────

  info("Uploading coturn-setup.sh to VPS …");
  const setupScriptPath = path.join(__dirname, "..", "deploy", "coturn-setup.sh");
  if (!fs.existsSync(setupScriptPath)) {
    fail(`deploy/coturn-setup.sh not found at ${setupScriptPath}`);
    conn.end();
    process.exit(1);
  }
  const scriptContent = fs.readFileSync(setupScriptPath, "utf8");

  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      const stream = sftp.createWriteStream("/tmp/coturn-setup.sh", { mode: 0o755 });
      stream.on("close", resolve);
      stream.on("error", reject);
      stream.end(scriptContent);
    });
  });
  ok("coturn-setup.sh uploaded to /tmp/coturn-setup.sh");

  // ── Run coturn setup ────────────────────────────────────────────────────────

  info("Running coturn setup (this may take 2–3 minutes) …");
  info(`TURN domain: ${turnHost}`);
  info(`Public IP:   ${publicIp}`);
  info(`TURN secret: [hidden — ${turnSecret.length} chars]`);

  const setupCmd = [
    `TURN_DOMAIN='${turnHost}'`,
    `PUBLIC_IP='${publicIp}'`,
    `TURN_SECRET='${turnSecret}'`,
    "RELAY_MIN_PORT=49152",
    "RELAY_MAX_PORT=65535",
    "sudo -E bash /tmp/coturn-setup.sh",
  ].join(" ");

  const { out: setupOut, err: setupErr, exit: setupExit } = await exec(conn, setupCmd, 300_000);

  if (setupOut) console.log("\n" + setupOut);
  if (setupErr && setupErr.trim()) console.error(setupErr);

  if (setupExit !== 0) {
    fail(`coturn-setup.sh exited with code ${setupExit}`);
    conn.end();
    process.exit(1);
  }

  // ── Verify ports ────────────────────────────────────────────────────────────

  info("Verifying TURN ports …");
  const { out: portOut } = await exec(conn, "ss -lntu 2>/dev/null | grep -E ':3478|:5349' || echo 'none'");
  if (portOut.includes("3478")) {
    ok("Port 3478 (TURN/STUN) is listening");
  } else {
    warn("Port 3478 not detected — coturn may still be starting");
  }
  if (portOut.includes("5349")) {
    ok("Port 5349 (TURNS/TLS) is listening");
  } else {
    warn("Port 5349 not detected — TLS cert may be missing");
  }

  // ── Open Oracle/iptables firewall if ufw not present ───────────────────────

  info("Ensuring iptables rules for TURN ports …");
  await exec(conn, `
    sudo iptables -C INPUT -p udp --dport 3478 -j ACCEPT 2>/dev/null || sudo iptables -A INPUT -p udp --dport 3478 -j ACCEPT
    sudo iptables -C INPUT -p tcp --dport 3478 -j ACCEPT 2>/dev/null || sudo iptables -A INPUT -p tcp --dport 3478 -j ACCEPT
    sudo iptables -C INPUT -p tcp --dport 5349 -j ACCEPT 2>/dev/null || sudo iptables -A INPUT -p tcp --dport 5349 -j ACCEPT
    sudo iptables -C INPUT -p udp --dport 5349 -j ACCEPT 2>/dev/null || sudo iptables -A INPUT -p udp --dport 5349 -j ACCEPT
    sudo iptables -C INPUT -p udp --dport 49152:65535 -j ACCEPT 2>/dev/null || sudo iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
    sudo netfilter-persistent save 2>/dev/null || true
  `.trim());
  ok("iptables rules for TURN ensured");

  // ── Check coturn status ─────────────────────────────────────────────────────

  const { out: statusOut } = await exec(conn, "systemctl is-active coturn");
  if (statusOut.trim() === "active") {
    ok("Coturn service is ACTIVE ✓");
  } else {
    warn(`Coturn service status: ${statusOut.trim()}`);
    const { out: journalOut } = await exec(conn, "journalctl -u coturn -n 30 --no-pager 2>/dev/null");
    console.log("\nCoturn logs:\n" + journalOut);
  }

  conn.end();

  // ── Print summary ───────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(70));
  console.log(`${GREEN}  Coturn setup complete!${NC}`);
  console.log("═".repeat(70));
  console.log(`
${CYAN}These env vars are already in your .env:${NC}

  TURN_HOST=${turnHost}
  TURN_SECRET=${turnSecret}
  TURN_PROBE_HOST=127.0.0.1

${CYAN}ICE servers auto-generated by the API (stun + turn udp/tcp + turns tls):${NC}

  → No manual config needed — the API generates HMAC credentials per request.

${CYAN}Verify TURN health:${NC}

  curl https://${turnHost}/api/healthz/turn | jq .

  Or from this Replit dev environment:
  curl http://localhost:8080/api/healthz/turn | jq .

${YELLOW}⚠️  If using Oracle Cloud: also open ports in the VCN Security List:${NC}
  Ingress: 3478 TCP+UDP, 5349 TCP+UDP, 49152–65535 UDP

${GREEN}Next step: restart the API server so it picks up the updated TURN_SECRET.${NC}
`);
}

main().catch((err) => {
  fail(err.message ?? String(err));
  process.exit(1);
});
