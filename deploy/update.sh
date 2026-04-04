#!/usr/bin/env bash
# deploy/update.sh
# Pull latest code, reinstall, rebuild, and reload PM2.
# Run directly on the Oracle VPS as the ubuntu user.
#
# Usage:
#   ssh ubuntu@rtc.praww.co.za
#   cd /home/ubuntu/PRawwPlus
#   bash deploy/update.sh
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/PRawwPlus}"

echo "===== [1/6] Pull latest code ====="
git -C "$DEPLOY_DIR" pull

echo "===== [2/6] Install / update dependencies ====="
cd "$DEPLOY_DIR"
# Clear lockfile so pnpm re-resolves for this machine's architecture (ARM64).
# pnpm-workspace.yaml allows linux-arm64-gnu packages — safe to reinstall.
rm -f pnpm-lock.yaml
CI=true pnpm install --no-frozen-lockfile

echo "===== [3/6] Build shared library packages ====="
pnpm --filter @workspace/db \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

echo "===== [4/6] Build frontend (Vite) ====="
pnpm --filter @workspace/prawwplus run build

echo "===== [5/6] Build backend (esbuild) ====="
pnpm --filter @workspace/api-server run build

echo "===== [6/6] Reload PM2 (zero-downtime) ====="
mkdir -p logs
pm2 reload ecosystem.config.cjs --update-env
pm2 save

echo ""
echo "✅  Update complete"
echo "    Logs:    pm2 logs prawwplus --lines 50"
echo "    Monitor: pm2 monit"
