#!/usr/bin/env bash
# deploy/setup.sh — one-time Oracle VPS initialisation (Ubuntu AMD64)
#
# Usage:
#   ssh ubuntu@YOUR_VPS_IP
#   git clone https://github.com/praww527/PRawwPlus.git ~/PRawwPlus
#   cd ~/PRawwPlus
#   cp .env.example .env && nano .env   # fill in all secrets first
#   bash deploy/setup.sh
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/PRawwPlus}"
DOMAIN="${DOMAIN:-your-domain.com}"
NODE_VERSION="22"
PNPM_VERSION="10.26.1"
APP_PORT="3000"

echo "===== [1/9] System packages ====="
sudo apt-get update -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx ufw

echo "===== [2/9] Firewall (SSH + HTTP + HTTPS) ====="
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

echo "===== [3/9] Node.js ${NODE_VERSION} LTS ====="
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "===== [4/9] corepack + pnpm ${PNPM_VERSION} ====="
sudo corepack enable
sudo corepack prepare pnpm@${PNPM_VERSION} --activate

echo "===== [5/9] PM2 ====="
sudo npm install -g pm2
# Register PM2 to start on boot
env PATH="$PATH:/usr/bin" pm2 startup systemd -u ubuntu --hp /home/ubuntu | \
  grep "sudo" | bash || true

echo "===== [6/9] Install dependencies ====="
cd "${DEPLOY_DIR}"
pnpm install --frozen-lockfile

echo "===== [7/9] Build all packages ====="
pnpm --filter @workspace/db \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

pnpm --filter @workspace/call-manager run build
pnpm --filter @workspace/api-server   run build

mkdir -p logs

echo "===== [8/9] Start app with PM2 ====="
# Export env vars from .env into the PM2 environment
set -o allexport
# shellcheck disable=SC1091
[ -f "${DEPLOY_DIR}/.env" ] && source "${DEPLOY_DIR}/.env"
set +o allexport

pm2 start ecosystem.config.cjs --env production
pm2 save

echo "===== [9/9] Nginx config ====="
sudo cp "${DEPLOY_DIR}/deploy/nginx.conf" /etc/nginx/sites-available/prawwplus
sudo sed -i "s/YOUR_DOMAIN/${DOMAIN}/g"   /etc/nginx/sites-available/prawwplus
sudo ln -sf /etc/nginx/sites-available/prawwplus /etc/nginx/sites-enabled/prawwplus
sudo rm -f  /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

echo ""
echo "========================================================"
echo " Setup complete!  App running on port ${APP_PORT}"
echo " Run: sudo certbot --nginx -d ${DOMAIN}"
echo " to obtain a free Let's Encrypt SSL certificate."
echo "========================================================"
