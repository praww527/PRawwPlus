#!/usr/bin/env bash
# deploy/update.sh
# Pull latest code, reinstall, rebuild, and restart the API service.
# Platform: Oracle Ubuntu 22.04 LTS — ARM64 (Ampere A1) or AMD64
#
# Usage (run directly on the VPS as the ubuntu user):
#   ssh ubuntu@YOUR_DOMAIN
#   cd /home/ubuntu/PRawwPlus
#   bash deploy/update.sh
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/PRawwPlus}"

echo "===== [1/6] Pull latest code ====="
git -C "$DEPLOY_DIR" pull

echo "===== [2/6] Install / update dependencies ====="
cd "$DEPLOY_DIR"
# Remove lockfile so pnpm re-resolves for this machine's architecture.
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

echo "===== [6/6] Restart systemd service ====="
mkdir -p logs
sudo systemctl restart prawwplus-api

echo ""
echo "Update complete"
echo "  Logs:    sudo journalctl -u prawwplus-api -n 200 --no-pager"
echo "  Follow:  sudo journalctl -u prawwplus-api -f"
echo ""
echo "  To verify an unverified user (if needed):"
echo "    pnpm tsx scripts/verify-user.ts --list"
echo "    pnpm tsx scripts/verify-user.ts user@example.com"
