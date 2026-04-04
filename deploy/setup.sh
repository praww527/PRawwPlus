#!/usr/bin/env bash
# deploy/setup.sh
# One-time Oracle VPS initialisation script.
# Run as a user with sudo access (e.g. "ubuntu").
# Usage: bash deploy/setup.sh
set -euo pipefail

DEPLOY_DIR="/home/ubuntu/PRawwPlus"
DOMAIN="rtc.praww.co.za"
NODE_VERSION="22"
PNPM_VERSION="10.26.1"

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

echo "===== [5/8] PM2 ====="
sudo npm install -g pm2
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | sudo bash

echo "===== [6/8] Clone repo ====="
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "Repo already exists — pulling latest"
  git -C "$DEPLOY_DIR" pull
else
  echo "Cloning repo"
  git clone https://github.com/praww527/PRawwPlus.git "$DEPLOY_DIR"
fi

echo "===== [7/8] Install dependencies + build ====="
cd "$DEPLOY_DIR"

if [ ! -f .env ]; then
  echo "WARNING: .env not found — create $DEPLOY_DIR/.env with your secrets before starting"
  echo "         See .env.example for required variables"
fi

# Remove lockfile so pnpm resolves packages for this machine's architecture (ARM64).
# pnpm-workspace.yaml explicitly allows linux-arm64-gnu packages for rollup,
# esbuild, tailwindcss/oxide, and lightningcss.
rm -f pnpm-lock.yaml
CI=true pnpm install --no-frozen-lockfile

# Build shared library packages first
pnpm --filter @workspace/db \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

# Build frontend (Vite + Rollup — requires ARM64 native binary)
pnpm --filter @workspace/prawwplus run build

# Build backend (esbuild — requires ARM64 native binary)
pnpm --filter @workspace/api-server run build

mkdir -p logs

echo "===== [8/8] Start app with PM2 + configure Nginx ====="
pm2 start ecosystem.config.cjs
pm2 save

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
echo "  2. Get SSL certificate:  sudo certbot --nginx -d ${DOMAIN}"
echo "  3. Reload PM2 after .env changes: pm2 reload ecosystem.config.cjs --update-env"
