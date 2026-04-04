/**
 * PM2 ecosystem config — Oracle VPS deployment (ARM64 Ampere A1 or AMD64)
 *
 * Start:   pm2 start ecosystem.config.cjs
 * Reload:  pm2 reload ecosystem.config.cjs --update-env
 * Logs:    pm2 logs prawwplus
 * Monitor: pm2 monit
 *
 * Secrets are loaded from /home/ubuntu/PRawwPlus/.env via --env-file below.
 * Never commit .env to git.
 */

const path = require("path");
const fs   = require("fs");

// Load .env file into env object so PM2 passes every variable to the process.
// This is the equivalent of "dotenv" but done at the PM2 level.
function loadDotEnv(envFile) {
  const env = {};
  if (!fs.existsSync(envFile)) return env;

  const lines = fs.readFileSync(envFile, "utf-8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();

    // Strip surrounding quotes (single or double)
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    // Replace literal \n with actual newlines (for SSH keys, Firebase private keys, etc.)
    val = val.replace(/\\n/g, "\n");

    env[key] = val;
  }
  return env;
}

const DEPLOY_DIR = "/home/ubuntu/PRawwPlus";
const dotEnv = loadDotEnv(path.join(DEPLOY_DIR, ".env"));

module.exports = {
  apps: [
    {
      name: "prawwplus",
      script: "./artifacts/api-server/dist/index.cjs",
      cwd: DEPLOY_DIR,

      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",

      // Graceful shutdown — matches the SIGTERM handler in index.ts
      kill_timeout: 20000,
      wait_ready: false,

      env: {
        NODE_ENV: "production",
        PORT: "3000",
        TRUST_PROXY: "1",
        ...dotEnv,
      },

      error_file: "./logs/prawwplus-error.log",
      out_file: "./logs/prawwplus-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
