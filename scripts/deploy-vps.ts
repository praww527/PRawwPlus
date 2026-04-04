#!/usr/bin/env tsx
/**
 * scripts/deploy-vps.ts
 * Full Oracle VPS deployment via SSH + SFTP.
 *
 * Strategy (avoids ARM64 cross-compilation issues):
 *   1. Build frontend + backend LOCALLY (already done via pnpm build)
 *   2. Upload built artifacts + config to VPS via SFTP
 *   3. On VPS: install runtime deps with npm (auto-resolves ARM64 natives)
 *   4. Configure nginx, start/reload PM2
 *
 * Usage: pnpm --filter @workspace/scripts run deploy-vps
 * Pre-req: run `pnpm --filter @workspace/prawwplus run build` and
 *              `pnpm --filter @workspace/api-server run build` first.
 */

import { Client as SSH, type ClientChannel, type SFTPWrapper } from "ssh2";
import { readFile, readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";

// ── Config ─────────────────────────────────────────────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────────
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
    conn.connect({ host: VPS_HOST, port: SSH_PORT, username: SSH_USER, privateKey: cleanKey(RAW_KEY), readyTimeout: 20_000 });
  });
}

function exec(conn: SSH, cmd: string, label: string, showOutput = true): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { pty: false }, (err, stream: ClientChannel) => {
      if (err) { reject(new Error(`${label}: ${err.message}`)); return; }
      let out = ""; let errOut = "";
      stream.on("data", (d: Buffer) => { out += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
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

async function sftpUploadDir(sftp: SFTPWrapper, localDir: string, remoteDir: string): Promise<number> {
  await sftpMkdir(sftp, remoteDir);
  const entries = await readdir(localDir);
  let count = 0;
  for (const entry of entries) {
    const lp = path.join(localDir, entry);
    const rp = `${remoteDir}/${entry}`;
    const s = await stat(lp);
    if (s.isDirectory()) {
      count += await sftpUploadDir(sftp, lp, rp);
    } else {
      await sftpUploadFile(sftp, lp, rp);
      count++;
    }
  }
  return count;
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

// ── Main ────────────────────────────────────────────────────────────────────
async function deploy() {
  console.log(`\n🚀  Deploying PRaww+ → ${VPS_HOST} (${DOMAIN})\n`);

  // Verify local builds exist
  const frontendDist = path.join(ROOT, "artifacts/prawwplus/dist/public");
  const backendBundle = path.join(ROOT, "artifacts/api-server/dist/index.cjs");
  try {
    await stat(frontendDist);
    await stat(backendBundle);
  } catch {
    console.error("❌  Build artifacts missing — run:\n" +
      "    pnpm --filter @workspace/prawwplus run build\n" +
      "    pnpm --filter @workspace/api-server run build");
    process.exit(1);
  }

  const conn = await connect();
  console.log("✅  SSH connected\n");

  try {
    const sftp = await getSftp(conn);

    // ── Step 1: System packages ─────────────────────────────────────────
    console.log("📦  [1/8] Verifying system packages...");
    await exec(conn,
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq nginx ufw certbot python3-certbot-nginx 2>&1 | tail -3",
      "apt-get"
    );
    console.log("✅  System packages ready\n");

    // ── Step 2: Node.js + npm ───────────────────────────────────────────
    console.log("📦  [2/8] Verifying Node.js...");
    const nodeVer = await exec(conn, "node --version", "node-version");
    console.log(`✅  Node.js ${nodeVer}\n`);

    // ── Step 3: PM2 ─────────────────────────────────────────────────────
    console.log("📦  [3/8] Verifying PM2...");
    await exec(conn, "pm2 --version 2>/dev/null || sudo npm install -g pm2", "pm2");
    await exec(conn,
      "sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null | tail -1 | sudo bash || true",
      "pm2-startup", false
    );
    console.log("✅  PM2 ready\n");

    // ── Step 4: Create directory structure ─────────────────────────────
    console.log("📂  [4/8] Creating deploy directories...");
    for (const d of [
      DEPLOY_DIR,
      `${DEPLOY_DIR}/artifacts`,
      `${DEPLOY_DIR}/artifacts/prawwplus`,
      `${DEPLOY_DIR}/artifacts/prawwplus/dist`,
      `${DEPLOY_DIR}/artifacts/api-server`,
      `${DEPLOY_DIR}/artifacts/api-server/dist`,
      `${DEPLOY_DIR}/deploy`,
      `${DEPLOY_DIR}/logs`,
    ]) {
      await sftpMkdir(sftp, d);
    }
    console.log("✅  Directories ready\n");

    // ── Step 5: Upload built artifacts via SFTP ─────────────────────────
    console.log("📤  [5/8] Uploading built artifacts...");

    // Frontend dist (Vite build output)
    const frontendCount = await sftpUploadDir(
      sftp,
      path.join(ROOT, "artifacts/prawwplus/dist/public"),
      `${DEPLOY_DIR}/artifacts/prawwplus/dist/public`
    );
    console.log(`    ✓ Frontend: ${frontendCount} files uploaded`);

    // Backend bundle (esbuild CJS)
    await sftpUploadFile(
      sftp,
      path.join(ROOT, "artifacts/api-server/dist/index.cjs"),
      `${DEPLOY_DIR}/artifacts/api-server/dist/index.cjs`
    );
    console.log("    ✓ Backend bundle uploaded");

    // api-server package.json — strip workspace:* and catalog: deps (already bundled into CJS)
    const rawPkg = JSON.parse(await readFile(path.join(ROOT, "artifacts/api-server/package.json"), "utf-8"));
    const cleanDeps: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawPkg.dependencies ?? {})) {
      const ver = v as string;
      if (!ver.startsWith("workspace:") && !ver.startsWith("catalog:")) cleanDeps[k] = ver;
    }
    const prodPkg = JSON.stringify({ name: rawPkg.name, version: rawPkg.version, dependencies: cleanDeps }, null, 2);
    await sftpWriteContent(sftp, `${DEPLOY_DIR}/artifacts/api-server/package.json`, prodPkg);

    // ecosystem.config.cjs
    await sftpUploadFile(
      sftp,
      path.join(ROOT, "ecosystem.config.cjs"),
      `${DEPLOY_DIR}/ecosystem.config.cjs`
    );

    // nginx config
    await sftpUploadFile(
      sftp,
      path.join(ROOT, "deploy/nginx.conf"),
      `${DEPLOY_DIR}/deploy/nginx.conf`
    );
    console.log("✅  All artifacts uploaded\n");

    // ── Step 6: Write .env ──────────────────────────────────────────────
    console.log("🔐  [6/8] Writing .env...");
    await sftpWriteContent(sftp, `${DEPLOY_DIR}/.env`, buildDotEnv(), 0o600);
    console.log("✅  .env written\n");

    // ── Step 7: Install production runtime deps ─────────────────────────
    // Uses npm (not pnpm) in the api-server dir — npm auto-resolves ARM64 natives
    console.log("📦  [7/8] Installing production runtime deps (npm)...");
    const npmInstallCmd =
      `cd "${DEPLOY_DIR}/artifacts/api-server" && ` +
      `npm install --production --legacy-peer-deps --loglevel=error 2>&1`;
    await exec(conn, npmInstallCmd, "npm-install");
    console.log("✅  Runtime deps installed\n");

    // ── Step 8: Configure nginx + PM2 ─────────────────────────────────
    console.log("🌐  [8/8] Configuring nginx and starting PM2...");

    // Create webroot dir for certbot ACME challenge
    await exec(conn, "sudo mkdir -p /var/www/certbot", "mkdir-certbot", false);

    // Nginx
    await exec(conn,
      `sudo cp "${DEPLOY_DIR}/deploy/nginx.conf" /etc/nginx/sites-available/prawwplus && ` +
      `sudo ln -sf /etc/nginx/sites-available/prawwplus /etc/nginx/sites-enabled/prawwplus && ` +
      `sudo rm -f /etc/nginx/sites-enabled/default && ` +
      `sudo nginx -t 2>&1 && sudo systemctl reload nginx`,
      "nginx"
    );

    // Load .env into the PM2 process (ecosystem reads it via dotenv)
    await exec(conn,
      `cd "${DEPLOY_DIR}" && ` +
      `(pm2 reload ecosystem.config.cjs --update-env 2>/dev/null || ` +
       `pm2 start ecosystem.config.cjs --env production) && ` +
      `pm2 save`,
      "pm2-start"
    );

    // UFW firewall
    await exec(conn,
      "sudo ufw allow 22/tcp 2>/dev/null; sudo ufw allow 80/tcp; " +
      "sudo ufw allow 443/tcp; sudo ufw allow 16384:32768/udp; " +
      "sudo ufw --force enable 2>&1 | tail -3",
      "ufw"
    );

    const pm2Status = await exec(conn, "pm2 list --no-color 2>&1", "pm2-list");
    console.log(`\n${pm2Status}\n`);

    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║  ✅  PRaww+ deployed to Oracle VPS                       ║");
    console.log(`║  🌍  URL:  https://${DOMAIN.padEnd(36)}║`);
    console.log("║  ⚠️   SSL:  sudo certbot --nginx -d " + DOMAIN + " ║");
    console.log("║  📋  Logs: pm2 logs prawwplus                            ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

  } finally {
    conn.end();
  }
}

deploy().catch(err => {
  console.error("\n❌  Deployment failed:", err.message);
  process.exit(1);
});
