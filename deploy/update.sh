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
UBUNTU_USER="${SUDO_USER:-ubuntu}"

echo "===== [1/7] Pull latest code ====="
git -C "$DEPLOY_DIR" pull

echo "===== [2/7] Fix ownership (node_modules) ====="
# Some previous sudo/root pnpm runs can leave files owned by root.
# Re-own the entire project directory so the ubuntu user can write freely.
sudo chown -R "${UBUNTU_USER}:${UBUNTU_USER}" "$DEPLOY_DIR" 2>/dev/null || true

echo "===== [3/7] Remove stale old services and config ====="
# Stop and remove any leftover call-manager / old PRawwPlus services
for SVC in call-manager call-manager-api call-manager-mobile call_manager callmanager; do
    if systemctl list-units --full -all 2>/dev/null | grep -q "${SVC}.service"; then
        echo "  Removing old service: ${SVC}"
        sudo systemctl stop    "${SVC}" 2>/dev/null || true
        sudo systemctl disable "${SVC}" 2>/dev/null || true
        sudo rm -f "/etc/systemd/system/${SVC}.service" \
                   "/lib/systemd/system/${SVC}.service"
    fi
done
# Remove old nginx sites that are no longer used
for SITE in call-manager call_manager callmanager; do
    sudo rm -f "/etc/nginx/sites-enabled/${SITE}" \
               "/etc/nginx/sites-available/${SITE}" 2>/dev/null || true
done
sudo systemctl daemon-reload

echo "===== [4/7] Install / update dependencies ====="
cd "$DEPLOY_DIR"
pnpm install --frozen-lockfile 2>/dev/null \
  || pnpm install --no-frozen-lockfile

echo "===== [5/7] Build shared library packages ====="
pnpm --filter @workspace/db \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

echo "===== [6/7] Build frontend (Vite) + backend (esbuild) ====="
pnpm --filter @workspace/prawwplus run build
pnpm --filter @workspace/api-server run build

echo "===== [7/7] Restart systemd service ====="
mkdir -p logs
# Re-copy the service file in case it changed
sudo cp deploy/prawwplus-api.service /etc/systemd/system/prawwplus-api.service
sudo systemctl daemon-reload
sudo systemctl enable prawwplus-api
sudo systemctl restart prawwplus-api

echo ""
echo "===== Update complete ====="
echo "  Status:  sudo systemctl status prawwplus-api"
echo "  Logs:    sudo journalctl -u prawwplus-api -n 200 --no-pager"
echo "  Follow:  sudo journalctl -u prawwplus-api -f"
echo ""
echo "  Verify an unverified user (if needed):"
echo "    pnpm tsx scripts/verify-user.ts --list"
echo "    pnpm tsx scripts/verify-user.ts user@example.com"
echo ""
echo "  After deploy: trigger a FULL FreeSWITCH config push from"
echo "    https://rtc.praww.co.za → Admin → FreeSWITCH → Push Config"
echo "  This reloads mod_verto and the SIP profile with updated settings."
