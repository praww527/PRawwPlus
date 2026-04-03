#!/usr/bin/env bash
# deploy/update.sh
# Pull latest code, rebuild, and reload PM2 — zero-downtime redeploy.
# Run on the Oracle VPS as the ubuntu user from inside the repo directory.
# Usage: bash deploy/update.sh
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/PRawwPlus}"

echo "===== [1/5] Pull latest code ====="
git -C "$DEPLOY_DIR" pull

echo "===== [2/5] Install / update dependencies ====="
cd "$DEPLOY_DIR"
pnpm install --no-frozen-lockfile

echo "===== [3/5] Build library packages ====="
pnpm --filter @workspace/db \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

echo "===== [4/5] Build app packages ====="
pnpm --filter @workspace/prawwplus run build
pnpm --filter @workspace/api-server run build

echo "===== [5/5] Reload PM2 (zero-downtime) ====="
pm2 reload ecosystem.config.cjs --update-env
pm2 save

echo ""
echo "===== Update complete ====="
echo "Check logs: pm2 logs prawwplus --lines 50"
echo "Monitor:    pm2 monit"
