/**
 * PM2 ecosystem config — Oracle VPS (Ubuntu AMD64)
 *
 * Start :  pm2 start ecosystem.config.cjs
 * Reload:  pm2 reload ecosystem.config.cjs --update-env
 * Logs  :  pm2 logs prawwplus
 * Status:  pm2 status
 */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "prawwplus",
      script: path.join(__dirname, "artifacts/api-server/dist/index.cjs"),
      cwd: __dirname,

      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",

      // Matches the SIGTERM handler in index.ts (15 s force-exit)
      kill_timeout: 20000,
      wait_ready: false,

      // Node 22 native --env-file: loads .env before app code runs.
      // This means secrets survive server reboots and PM2 resurrections.
      node_args: `--env-file=${path.join(__dirname, ".env")}`,

      env_production: {
        NODE_ENV: "production",
        PORT: "3000",
        TRUST_PROXY: "1",
      },

      error_file: path.join(__dirname, "logs/pm2-error.log"),
      out_file:   path.join(__dirname, "logs/pm2-out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
