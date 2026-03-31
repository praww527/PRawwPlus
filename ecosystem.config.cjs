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

      // Secrets are read from the .env file on the server via dotenv or
      // injected by the deploy/setup.sh before pm2 start.
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
