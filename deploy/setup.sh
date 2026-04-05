#!/usr/bin/env bash
# deploy/setup.sh
# One-time Oracle VPS initialisation script.
# Platform: Ubuntu 22.04 LTS — ARM64 (Ampere A1) or AMD64
#
# Run as a user with sudo access (e.g. "ubuntu").
# Usage: bash deploy/setup.sh
set -euo pipefail

DEPLOY_DIR="/home/ubuntu/PRawwPlus"
DOMAIN="rtc.praww.co.za"
NODE_VERSION="22"
PNPM_VERSION="10.26.1"

ARCH="$(uname -m)"
echo "===== Detected architecture: ${ARCH} ====="

echo "===== [1/8] System update ====="
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx ufw

echo "===== [2/8] Firewall (SSH + HTTP + HTTPS + RTP) ====="
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
# FreeSWITCH RTP media ports — required for audio, must be UDP
sudo ufw allow 16384:32768/udp comment "FreeSWITCH RTP media"
sudo ufw --force enable

echo "===== [3/8] Node.js ${NODE_VERSION} via NodeSource ====="
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "===== [4/8] corepack + pnpm ====="
sudo corepack enable
sudo corepack prepare pnpm@${PNPM_VERSION} --activate

echo "===== [5/8] systemd service ====="
sudo mkdir -p /etc/systemd/system

echo "===== [6/8] Clone repo ====="
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "Repo already exists — pulling latest"
  git -C "$DEPLOY_DIR" pull
else
  echo "Cloning repo"
  git clone https://github.com/praww527/PRawwPlus.git "$DEPLOY_DIR"
fi

echo "===== [7/8] Create .env and install + build ====="
cd "$DEPLOY_DIR"

if [ ! -f .env ]; then
  echo ""
  echo "WARNING: .env not found."
  echo "         You MUST create $DEPLOY_DIR/.env with all required secrets."
  echo "         See .env.example for the full list."
  echo ""
  echo "         Minimum required for login to work:"
  echo "           MONGODB_URI=mongodb+srv://..."
  echo "           APP_URL=https://${DOMAIN}"
  echo "           NODE_ENV=production"
  echo "           PORT=3000"
  echo "           TRUST_PROXY=1"
  echo ""
fi

# Remove lockfile so pnpm resolves packages for this machine's architecture.
# The workspace allows linux-arm64-gnu and linux-x64-gnu native binaries.
rm -f pnpm-lock.yaml
CI=true pnpm install --no-frozen-lockfile

# Build shared library packages first
pnpm --filter @workspace/db \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

# Build frontend (Vite)
pnpm --filter @workspace/prawwplus run build

# Build backend (esbuild)
pnpm --filter @workspace/api-server run build

mkdir -p logs

echo "===== [8/8] Start app with systemd + configure Nginx ====="

sudo cp deploy/prawwplus-api.service /etc/systemd/system/prawwplus-api.service
sudo systemctl daemon-reload
sudo systemctl enable prawwplus-api
sudo systemctl restart prawwplus-api

# Nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/prawwplus
sudo sed -i "s/YOUR_DOMAIN/${DOMAIN}/g" /etc/nginx/sites-available/prawwplus
sudo ln -sf /etc/nginx/sites-available/prawwplus /etc/nginx/sites-enabled/prawwplus
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "===== Setup complete ====="
echo "Next steps:"
echo "  1. Ensure .env is populated: nano ${DEPLOY_DIR}/.env"
echo "  2. Restart service after .env changes:"
echo "       sudo systemctl restart prawwplus-api"
echo "  3. Get SSL certificate:  sudo certbot --nginx -d ${DOMAIN}"
echo "  4. Reload nginx after certbot: sudo systemctl reload nginx"
echo ""
echo "  If users already signed up without SMTP, verify them manually:"
echo "       cd ${DEPLOY_DIR}"
echo "       pnpm tsx scripts/verify-user.ts <email@example.com>"
