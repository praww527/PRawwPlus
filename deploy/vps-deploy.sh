#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PRawwPlus — VPS Deployment Script
# Deploys / updates the application on 158.180.29.84 via SSH.
#
# Prerequisites (all available as Replit secrets):
#   FREESWITCH_SSH_KEY  — ED25519 key authorised for ubuntu@158.180.29.84
#   GITHUB_TOKEN        — Personal access token with repo:read
#
# Usage (from Replit Shell after running push.sh):
#   bash deploy/vps-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

VPS_HOST="158.180.29.84"
VPS_USER="${FREESWITCH_SSH_USER:-ubuntu}"
APP_DIR="/opt/prawwplus"
REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/praww527/PRawwPlus.git"
CLEAN_URL="https://github.com/praww527/PRawwPlus.git"

# ─── Validate ────────────────────────────────────────────────────────────────
[ -z "$FREESWITCH_SSH_KEY" ] && { echo "ERROR: FREESWITCH_SSH_KEY not set" >&2; exit 1; }
[ -z "$GITHUB_TOKEN" ]       && { echo "ERROR: GITHUB_TOKEN not set" >&2; exit 1; }

# ─── Extract + clean SSH key ─────────────────────────────────────────────────
# Key may be stored with spaces instead of newlines; this normalises it.
KEY_FILE=$(mktemp /tmp/prawwplus-deploy-XXXXXX)
chmod 600 "$KEY_FILE"
trap "rm -f '$KEY_FILE'" EXIT

node -e "
  let s = process.env.FREESWITCH_SSH_KEY || '';
  s = s.replace(/\\\\n/g, '\n');
  if (!s.includes('\n') && s.includes('-----BEGIN')) {
    const hm = s.match(/(-----BEGIN [^-]+-----)/);
    const fm = s.match(/(-----END [^-]+-----)/);
    if (hm && fm) {
      const h = hm[1], f = fm[1];
      const body = s.slice(s.indexOf(h)+h.length, s.indexOf(f)).replace(/\s+/g,'');
      const folded = (body.match(/.{1,64}/g)||[]).join('\n');
      process.stdout.write(h+'\n'+folded+'\n'+f+'\n');
      process.exit(0);
    }
  }
  process.stdout.write(s+'\n');
" > "$KEY_FILE"

SSH_OPTS="-i $KEY_FILE -o StrictHostKeyChecking=no -o ConnectTimeout=20 -o BatchMode=yes"
SSH="${VPS_USER}@${VPS_HOST}"

# ─── Test connection ─────────────────────────────────────────────────────────
echo "=== Testing SSH connection to ${VPS_USER}@${VPS_HOST} ==="
ssh $SSH_OPTS "$SSH" "echo 'SSH OK — $(hostname)'"

# ─── Install system deps (Node 20, pnpm, PM2) if missing ────────────────────
echo ""
echo "=== Checking system dependencies ==="
ssh $SSH_OPTS "$SSH" 'bash -s' << 'EOF'
set -e
# Node.js 20
if ! node --version 2>/dev/null | grep -q "^v2[0-9]"; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
# pnpm
if ! command -v pnpm &>/dev/null; then
  sudo npm install -g pnpm@latest
fi
# PM2
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
fi
echo "  node $(node --version)  pnpm $(pnpm --version)  pm2 $(pm2 --version)"
EOF

# ─── Clone or update the repo ────────────────────────────────────────────────
echo ""
echo "=== Deploying application code ==="
ssh $SSH_OPTS "$SSH" "REPO_URL='$REPO_URL' CLEAN_URL='$CLEAN_URL' APP_DIR='$APP_DIR' bash -s" << 'EOF'
set -e
if [ -d "$APP_DIR/.git" ]; then
  echo "Updating existing checkout..."
  cd "$APP_DIR"
  git remote set-url origin "$REPO_URL"
  git fetch --quiet origin master
  git reset --hard origin/master
else
  echo "Cloning repository..."
  sudo mkdir -p "$APP_DIR"
  sudo chown "$(whoami):$(whoami)" "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
git remote set-url origin "$CLEAN_URL"
echo "  HEAD: $(git log --oneline -1)"

echo "Installing dependencies..."
cd "$APP_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "Building frontend..."
pnpm --filter @workspace/prawwplus run build

echo "Build complete."
EOF

# ─── Write base .env (non-secrets only — add secrets manually) ───────────────
echo ""
echo "=== Writing base .env to VPS ==="
ssh $SSH_OPTS "$SSH" "APP_DIR='$APP_DIR' bash -s" << 'EOF'
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << 'ENVEOF'
PORT=8080
NODE_ENV=production
APP_URL=https://rtc.praww.co.za
FREESWITCH_SSH_USER=ubuntu
ENVEOF
  echo "  Created $ENV_FILE"
  echo "  ⚠  Add secrets (MONGODB_URI, SESSION_SECRET, FREESWITCH_SSH_KEY, etc.) to $ENV_FILE"
else
  echo "  $ENV_FILE already exists — not overwriting (add new vars manually)"
fi
EOF

# ─── Start / restart API server via PM2 ─────────────────────────────────────
echo ""
echo "=== Starting API server with PM2 ==="
ssh $SSH_OPTS "$SSH" "APP_DIR='$APP_DIR' bash -s" << 'EOF'
set -e
cd "$APP_DIR"

# Write PM2 ecosystem file
cat > ecosystem.config.cjs << 'PM2EOF'
module.exports = {
  apps: [{
    name: 'prawwplus-api',
    script: 'node_modules/.bin/tsx',
    args: 'artifacts/api-server/src/index.ts',
    cwd: '/opt/prawwplus',
    env_file: '/opt/prawwplus/.env',
    max_memory_restart: '512M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/prawwplus/error.log',
    out_file: '/var/log/prawwplus/out.log',
    merge_logs: true,
  }]
};
PM2EOF

sudo mkdir -p /var/log/prawwplus

if pm2 describe prawwplus-api &>/dev/null; then
  echo "  Reloading existing process..."
  pm2 reload prawwplus-api --update-env
else
  echo "  Starting new process..."
  pm2 start ecosystem.config.cjs
fi

pm2 save
# Enable PM2 on reboot
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true

echo "  PM2 status:"
pm2 show prawwplus-api 2>/dev/null | grep -E "status|cpu|memory|restarts" || pm2 list
EOF

# ─── Set up Nginx ────────────────────────────────────────────────────────────
echo ""
echo "=== Configuring Nginx ==="
ssh $SSH_OPTS "$SSH" "APP_DIR='$APP_DIR' bash -s" << 'EOF'
sudo apt-get install -y nginx 2>/dev/null | tail -1

# Write Nginx config
sudo tee /etc/nginx/sites-available/prawwplus > /dev/null << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name rtc.praww.co.za;

    # Serve React SPA (built static files)
    root /opt/prawwplus/artifacts/prawwplus/dist;
    index index.html;

    # WebSocket + API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/prawwplus /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo nginx -t && sudo systemctl reload nginx
echo "  Nginx configured and reloaded."
echo ""
echo "  To enable HTTPS (run once after DNS points to this server):"
echo "    sudo apt-get install -y certbot python3-certbot-nginx"
echo "    sudo certbot --nginx -d rtc.praww.co.za"
EOF

# ─── Apply FreeSWITCH bug fixes if FS is installed ───────────────────────────
echo ""
echo "=== Checking FreeSWITCH ==="
ssh $SSH_OPTS "$SSH" 'bash -s' << 'EOF'
if command -v fs_cli &>/dev/null; then
  echo "  FreeSWITCH found — applying ws-binding fixes..."
  FS_CONF="${FREESWITCH_CONF_DIR:-/etc/freeswitch}"
  for PROFILE in "$FS_CONF/sip_profiles/internal.xml" "$FS_CONF/sip_profiles/prawwplus_mobile.xml"; do
    [ -f "$PROFILE" ] && sed -i \
      's|<param name="ws-binding" value="[^"]*"/>|<param name="ws-binding" value="0.0.0.0:5066"/>|g' \
      "$PROFILE" && echo "  Patched: $PROFILE"
  done
  fs_cli -x "reload mod_sofia" 2>/dev/null && echo "  mod_sofia reloaded" || echo "  (reload skipped — FS not running)"
else
  echo "  FreeSWITCH not installed — skipping."
  echo "  After installing FreeSWITCH, use the admin dashboard Push Config button."
fi
EOF

echo ""
echo "══════════════════════════════════════════════════════════"
echo " Deployment complete!  https://rtc.praww.co.za"
echo "══════════════════════════════════════════════════════════"
echo ""
echo " Next steps:"
echo "  1. Add secrets to /opt/prawwplus/.env on the VPS:"
echo "       ssh ubuntu@158.180.29.84 'nano /opt/prawwplus/.env'"
echo "       # Add: MONGODB_URI, SESSION_SECRET, FREESWITCH_SSH_KEY,"
echo "       #      FREESWITCH_ESL_PASSWORD, FREESWITCH_DOMAIN,"
echo "       #      SMTP_USER, SMTP_PASS, etc."
echo "       pm2 restart prawwplus-api"
echo ""
echo "  2. Enable HTTPS (first time only):"
echo "       sudo certbot --nginx -d rtc.praww.co.za"
echo ""
echo "  3. Future updates — just run from Replit Shell:"
echo "       bash push.sh && bash deploy/vps-deploy.sh"
