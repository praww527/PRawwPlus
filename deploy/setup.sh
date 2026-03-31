#!/usr/bin/env bash
# deploy/setup.sh
# One-time Oracle VPS initialisation script.
# Run as a user with sudo access (e.g. "ubuntu").
# Usage: bash deploy/setup.sh
set -euo pipefail

DEPLOY_DIR="/home/ubuntu/PRawwPlus"   # ← change if needed
DOMAIN="your-domain.com"              # ← change to your domain / VPS IP
NODE_VERSION="22"
PNPM_VERSION="10.26.1"

echo "===== [1/8] System update ====="
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx ufw

echo "===== [2/8] Firewall (SSH + HTTP + HTTPS) ====="
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
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

echo "===== [6/8] Clone / update repo ====="
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "Repo already exists — pulling latest"
  git -C "$DEPLOY_DIR" pull
else
  echo "Cloning repo"
  git clone https://github.com/YOUR_ORG/YOUR_REPO.git "$DEPLOY_DIR"
fi

echo "===== [7/8] Install dependencies + build ====="
cd "$DEPLOY_DIR"

# Copy your .env file here before running this step:
#   scp .env ubuntu@VPS_IP:$DEPLOY_DIR/.env
if [ ! -f .env ]; then
  echo "WARNING: .env not found — copy it to $DEPLOY_DIR/.env before starting"
fi

pnpm install --frozen-lockfile

pnpm --filter @workspace/db \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

pnpm --filter @workspace/call-manager run build
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
echo "Next: run  sudo certbot --nginx -d ${DOMAIN}  to get SSL certificate"
echo "Then: set all env vars in ${DEPLOY_DIR}/.env (see .env.example)"
