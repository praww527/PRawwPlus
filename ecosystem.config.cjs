/**
 * PM2 ecosystem config — Oracle VPS deployment
 * Start:   pm2 start ecosystem.config.cjs
 * Reload:  pm2 reload ecosystem.config.cjs --update-env
 * Logs:    pm2 logs prawwplus
 * Monitor: pm2 monit
 */
module.exports = {
  apps: [
    {
      name: "prawwplus",
      script: "./artifacts/api-server/dist/index.cjs",
      cwd: "/home/ubuntu/PRawwPlus",

      instances: 1,
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
      },

      // All secrets come from the real .env on the server — do NOT commit .env
      env_production: {
        NODE_ENV: "production",
        PORT: "3000",
        TRUST_PROXY: "1",
      },

      error_file: "./logs/prawwplus-error.log",
      out_file: "./logs/prawwplus-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
