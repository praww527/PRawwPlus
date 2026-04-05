#!/usr/bin/env tsx
/**
 * scripts/deploy-vps.ts
 * Full source push + build on Oracle VPS (ARM64 Ampere A1).
 *
 * Flow:
 *   1. Pack source files into a tarball (excludes node_modules / dist / .git)
 *   2. Upload tarball to VPS via SFTP
 *   3. Extract on VPS
 *   4. pnpm install (resolves correct ARM64 native binaries)
 *   5. Build all packages on VPS
 *   6. Install/restart systemd service
 *
 * Usage: pnpm --filter @workspace/scripts run deploy-vps
 */

import { Client as SSH, type ClientChannel, type SFTPWrapper } from "ssh2";
import { readFile }  from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { exec as cpExec }   from "child_process";
import { promisify }        from "util";
import path from "path";
import os   from "os";

const execAsync = promisify(cpExec);

// ── Config ──────────────────────────────────────────────────────────────────
const VPS_HOST = process.env.FREESWITCH_DOMAIN ?? "";
const SSH_USER = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
const SSH_PORT = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22");
const RAW_KEY  = process.env.FREESWITCH_SSH_KEY ?? "";

const APP_URL  = process.env.APP_URL ?? "https://rtc.praww.co.za";
const DOMAIN   = APP_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

const DEPLOY_DIR = "/home/ubuntu/PRawwPlus";
const ROOT = path.resolve(import.meta.dirname, "..");

if (!VPS_HOST) { console.error("FREESWITCH_DOMAIN not set"); process.exit(1); }
if (!RAW_KEY)  { console.error("FREESWITCH_SSH_KEY not set"); process.exit(1); }

// ── Helpers ──────────────────────────────────────────────────────────────────
function cleanKey(raw: string): string {
  let s = raw.trim();
  if (s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const hm = s.match(/(-----BEGIN [^-]+-----)/);
    const fm = s.match(/(-----END [^-]+-----)/);
    if (hm && fm) {
      const body = s.slice(s.indexOf(hm[1]) + hm[1].length, s.indexOf(fm[1])).trim().replace(/\s+/g, "\n");
      s = `${hm[1]}\n${body}\n${fm[1]}`;
    }
  }
  return s.split("\n").map(l => l.trimStart()).join("\n").trim();
}

function connect(): Promise<SSH> {
  return new Promise((resolve, reject) => {
    const conn = new SSH();
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect({ host: VPS_HOST, port: SSH_PORT, username: SSH_USER, privateKey: cleanKey(RAW_KEY), readyTimeout: 30_000 });
  });
}

function exec(conn: SSH, cmd: string, label: string, showOutput = true): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use a long timeout for build steps
    conn.exec(cmd, { pty: false }, (err, stream: ClientChannel) => {
      if (err) { reject(new Error(`${label}: ${err.message}`)); return; }
      let out = ""; let errOut = "";
      stream.on("data",         (d: Buffer) => { out    += d.toString(); });
      stream.stderr.on("data",  (d: Buffer) => { errOut += d.toString(); });
      stream.on("close", (code: number) => {
        const combined = (out + "\n" + errOut).trim();
        if (code !== 0) {
          reject(new Error(`${label} failed (exit ${code}):\n${combined}`));
        } else {
          if (showOutput && combined) console.log(`    ${combined.split("\n").join("\n    ")}`);
          resolve(out.trim());
        }
      });
    });
  });
}

function getSftp(conn: SSH): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => { if (err) reject(err); else resolve(sftp); });
  });
}

function sftpMkdir(sftp: SFTPWrapper, dir: string): Promise<void> {
  return new Promise(resolve => sftp.mkdir(dir, () => resolve()));
}

function sftpUploadFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream(remotePath);
    const rs = createReadStream(localPath);
    ws.on("close", resolve);
    ws.on("error", reject);
    rs.pipe(ws);
  });
}

function sftpWriteContent(sftp: SFTPWrapper, remotePath: string, content: string, mode = 0o644): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream(remotePath, { mode });
    ws.on("close", resolve);
    ws.on("error", reject);
    ws.end(content);
  });
}

// ── .env builder ────────────────────────────────────────────────────────────
function buildDotEnv(): string {
  const e = process.env;
  const fsKey = (e.FREESWITCH_SSH_KEY ?? "").replace(/\n/g, "\\n");
  const fbKey = (e.FIREBASE_PRIVATE_KEY ?? "").replace(/\n/g, "\\n");
  return [
    "# PRaww+ production environment",
    `PORT=3000`,
    `NODE_ENV=production`,
    `TRUST_PROXY=1`,
    `APP_URL=${e.APP_URL ?? ""}`,
    `LOG_LEVEL=info`,
    ``,
    `MONGODB_URI=${e.MONGODB_URI ?? ""}`,
    `MONGODB_USE_TRANSACTIONS=false`,
    ``,
    `FIREBASE_PROJECT_ID=${e.FIREBASE_PROJECT_ID ?? ""}`,
    `FIREBASE_CLIENT_EMAIL=${e.FIREBASE_CLIENT_EMAIL ?? ""}`,
    `FIREBASE_PRIVATE_KEY="${fbKey}"`,
    ``,
    `FREESWITCH_DOMAIN=${e.FREESWITCH_DOMAIN ?? ""}`,
    `FREESWITCH_ESL_HOST=127.0.0.1`,
    `FREESWITCH_ESL_PORT=8021`,
    `FREESWITCH_ESL_PASSWORD=${e.FREESWITCH_ESL_PASSWORD ?? ""}`,
    `FREESWITCH_WS_URL=ws://127.0.0.1:8081/`,
    `FREESWITCH_SIP_WS_URL=ws://127.0.0.1:5066`,
    `FREESWITCH_SIP_WS_PORT=5066`,
    `FREESWITCH_SSH_USER=ubuntu`,
    `FREESWITCH_SSH_PORT=22`,
    `FREESWITCH_SSH_KEY="${fsKey}"`,
    `FREESWITCH_CONF_DIR=/etc/freeswitch`,
    `FREESWITCH_STORAGE_DIR=/usr/local/freeswitch/storage`,
    `FREESWITCH_WEBHOOK_SECRET=${e.FREESWITCH_WEBHOOK_SECRET ?? ""}`,
    ``,
    `PAYFAST_MERCHANT_ID=${e.PAYFAST_MERCHANT_ID ?? ""}`,
    `PAYFAST_MERCHANT_KEY=${e.PAYFAST_MERCHANT_KEY ?? ""}`,
    `PAYFAST_PASSPHRASE=${e.PAYFAST_PASSPHRASE ?? ""}`,
    ``,
    `SMTP_HOST=${e.SMTP_HOST ?? ""}`,
    `SMTP_PORT=${e.SMTP_PORT ?? "587"}`,
    `SMTP_USER=${e.SMTP_USER ?? ""}`,
    `SMTP_PASS=${e.SMTP_PASS ?? ""}`,
    `SMTP_FROM=PRaww+ <noreply@praww.co.za>`,
    ``,
    `LOW_BALANCE_THRESHOLD_COINS=10`,
    `MAX_BILLSEC_PER_CALL=3600`,
    `MAX_COINS_SPEND_PER_DAY=500`,
    `MAX_CONCURRENT_CALLS_PER_USER=2`,
    `RECONCILIATION_INTERVAL_MS=60000`,
  ].join("\n") + "\n";
}

// ── Create source tarball ────────────────────────────────────────────────────
async function createSourceTarball(): Promise<string> {
  const tarPath = path.join(os.tmpdir(), `prawwplus-src-${Date.now()}.tar.gz`);
  const cmd = [
    `tar czf "${tarPath}"`,
    // Include only the source directories needed to build
    `--exclude='*/node_modules'`,
    `--exclude='*/dist'`,
    `--exclude='*/.git'`,
    `--exclude='*/logs'`,
    `--exclude='*/.local'`,
    `--exclude='*/.cache'`,
    `--exclude='*/screenshots'`,
    `--exclude='*.tar.gz'`,
    `-C "${ROOT}"`,
    // Paths to include
    `artifacts`,
    `lib`,
    `deploy`,
    `package.json`,
    `pnpm-workspace.yaml`,
    `tsconfig.json`,
    `deploy/prawwplus-api.service`,
    // Include scripts source (not the whole scripts workspace — just key files)
    `scripts/package.json`,
  ].join(" ");

  console.log("    Creating tarball...");
  const { stderr } = await execAsync(cmd);
  if (stderr) console.log(`    tar warnings: ${stderr}`);
  return tarPath;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function deploy() {
  console.log(`\n🚀  Deploying PRaww+ → ${VPS_HOST} (${DOMAIN})\n`);
  console.log("    Strategy: upload full source → build directly on VPS (ARM64)\n");

  // ── Pack source ─────────────────────────────────────────────────────────
  console.log("📦  [1/7] Packing source files...");
  const tarPath = await createSourceTarball();
  const { size } = await import("fs").then(m => m.promises.stat(tarPath));
  console.log(`✅  Tarball ready: ${(size / 1024 / 1024).toFixed(1)} MB\n`);

  const conn = await connect();
  console.log("✅  SSH connected\n");

  try {
    const sftp = await getSftp(conn);

    // ── Step 2: System packages ────────────────────────────────────────
    console.log("🔧  [2/7] Verifying system packages...");
    await exec(conn,
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq nginx ufw certbot python3-certbot-nginx 2>&1 | tail -3",
      "apt-get"
    );
    const nodeVer = await exec(conn, "node --version 2>&1", "node-version");
    console.log(`✅  Node.js ${nodeVer}\n`);

    // ── Step 3: Upload source tarball ──────────────────────────────────
    console.log("📤  [3/7] Uploading source tarball...");
    const remoteTar = "/tmp/prawwplus-src.tar.gz";
    await sftpUploadFile(sftp, tarPath, remoteTar);
    console.log("    Extracting source on VPS...");
    await exec(conn,
      `mkdir -p "${DEPLOY_DIR}" && ` +
      `tar xzf "${remoteTar}" -C "${DEPLOY_DIR}" && ` +
      `rm -f "${remoteTar}"`,
      "extract"
    );
    console.log("✅  Source extracted\n");

    // ── Step 4: Write .env ─────────────────────────────────────────────
    console.log("🔐  [4/7] Writing .env...");
    await sftpWriteContent(sftp, `${DEPLOY_DIR}/.env`, buildDotEnv(), 0o600);
    console.log("✅  .env written\n");

    // ── Step 5: pnpm install on VPS ────────────────────────────────────
    console.log("📦  [5/7] Installing dependencies on VPS...");
    console.log("    (pnpm resolves linux-arm64-gnu native binaries — takes 1-3 min)\n");
    await exec(conn,
      `cd "${DEPLOY_DIR}" && ` +
      // Remove lockfile so pnpm re-resolves for ARM64; pnpm-workspace.yaml
      // now allows all linux-arm64-gnu packages (rollup, esbuild, tailwindcss, lightningcss)
      `rm -f pnpm-lock.yaml && ` +
      `CI=true pnpm install --no-frozen-lockfile 2>&1`,
      "pnpm-install"
    );
    console.log("\n✅  Dependencies installed\n");

    // ── Step 6: Build on VPS ──────────────────────────────────────────
    console.log("🔨  [6/7] Building on VPS (all packages)...");

    console.log("    Building shared libraries...");
    await exec(conn,
      `cd "${DEPLOY_DIR}" && ` +
      `pnpm --filter @workspace/db ` +
      `     --filter @workspace/auth-web ` +
      `     --filter @workspace/api-client-react ` +
      `     run build 2>&1`,
      "build-libs"
    );

    console.log("    Building frontend (Vite + Rollup ARM64)...");
    await exec(conn,
      `cd "${DEPLOY_DIR}" && pnpm --filter @workspace/prawwplus run build 2>&1`,
      "build-frontend"
    );

    console.log("    Building backend (esbuild ARM64)...");
    await exec(conn,
      `cd "${DEPLOY_DIR}" && pnpm --filter @workspace/api-server run build 2>&1`,
      "build-backend"
    );
    console.log("✅  All packages built\n");

    // ── Step 7: systemd + nginx ───────────────────────────────────────
    console.log("🌐  [7/7] Configuring nginx + systemd...");

    await exec(conn, "sudo mkdir -p /var/www/certbot", "mkdir-certbot", false);

    const nginxConf = `/etc/nginx/sites-available/prawwplus`;
    await exec(conn,
      `sudo cp "${DEPLOY_DIR}/deploy/nginx.conf" ${nginxConf} && ` +
      `sudo ln -sf ${nginxConf} /etc/nginx/sites-enabled/prawwplus && ` +
      `sudo rm -f /etc/nginx/sites-enabled/default && ` +
      `sudo nginx -t 2>&1 && sudo systemctl reload nginx`,
      "nginx"
    );

    await exec(conn,
      `sudo cp "${DEPLOY_DIR}/deploy/prawwplus-api.service" /etc/systemd/system/prawwplus-api.service && ` +
      `sudo systemctl daemon-reload && ` +
      `sudo systemctl enable prawwplus-api && ` +
      `sudo systemctl restart prawwplus-api`,
      "systemd"
    );

    await exec(conn,
      "sudo ufw allow 22/tcp 2>/dev/null; sudo ufw allow 80/tcp; " +
      "sudo ufw allow 443/tcp; sudo ufw allow 16384:32768/udp; " +
      "sudo ufw --force enable 2>&1 | tail -3",
      "ufw"
    );

    const svcStatus = await exec(conn, "sudo systemctl --no-pager --full status prawwplus-api 2>&1 | tail -80", "service-status");
    console.log(`\n${svcStatus}\n`);

    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║  ✅  PRaww+ deployed — built on VPS (ARM64)              ║");
    console.log(`║  🌍  URL:  https://${DOMAIN.padEnd(36)}║`);
    console.log("║  🔒  SSL:  sudo certbot --nginx -d " + DOMAIN + "  ║");
    console.log("║  📋  Logs: sudo journalctl -u prawwplus-api -f           ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");
    console.log("Future updates from the VPS:");
    console.log("  git pull && bash deploy/update.sh\n");

  } finally {
    conn.end();
  }
}

deploy().catch(err => {
  console.error("\n❌  Deployment failed:", err.message);
  process.exit(1);
});
