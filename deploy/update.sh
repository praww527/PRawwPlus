#!/usr/bin/env bash
# deploy/update.sh
# ─────────────────────────────────────────────────────────────────────────────
# HOW TO UPDATE PRaww+ on the Oracle VPS
# ─────────────────────────────────────────────────────────────────────────────
#
# ⚠️  DO NOT run build commands directly on the VPS.
#     The Oracle VPS is ARM64 (Ampere A1). Vite's native Rollup module
#     does not install correctly on ARM64 via pnpm, so frontend builds
#     will fail on the VPS.
#
# ✅  CORRECT update workflow — run ALL of these from REPLIT (not the VPS):
#
#   1. Make your code changes in Replit
#   2. Build locally:
#        pnpm --filter @workspace/prawwplus run build
#        pnpm --filter @workspace/api-server run build
#   3. Deploy to VPS (builds + uploads + restarts PM2):
#        pnpm --filter @workspace/scripts run deploy-vps
#
#   That's it. The deploy-vps script handles everything via SSH/SFTP.
#
# ─────────────────────────────────────────────────────────────────────────────
# Quick-reference commands to run ON THE VPS (for monitoring only):
#
#   pm2 list                      — see app status
#   pm2 logs prawwplus --lines 50 — tail recent logs
#   pm2 monit                     — live dashboard
#   pm2 reload prawwplus          — graceful restart (no redeploy)
#   sudo systemctl status nginx   — nginx status
#   sudo systemctl status freeswitch — FreeSWITCH status
# ─────────────────────────────────────────────────────────────────────────────

echo "⚠️  This script is informational. See comments above."
echo ""
echo "Run updates from Replit:"
echo "  pnpm --filter @workspace/prawwplus run build"
echo "  pnpm --filter @workspace/api-server run build"
echo "  pnpm --filter @workspace/scripts run deploy-vps"
