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
APP_DIR="/home/ubuntu/PRawwPlus"
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

# ─── Write .env with all secrets from CI/Replit environment ─────────────────
echo ""
echo "=== Writing .env to VPS ==="

# Build the secrets payload as JSON in Node (handles newlines / special chars)
SECRETS_JSON=$(node -e "
const out = {};
const plain = [
  'MONGODB_URI','SESSION_SECRET','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY',
  'FREESWITCH_ESL_PASSWORD','FREESWITCH_WEBHOOK_SECRET',
  'FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL',
  'SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_FROM',
  'PAYFAST_MERCHANT_ID','PAYFAST_MERCHANT_KEY','PAYFAST_PASSPHRASE',
  'TURN_SECRET','ADMIN_API_KEY'
];
const jsonEncoded = ['FIREBASE_PRIVATE_KEY','FREESWITCH_SSH_KEY'];
for (const k of [...plain, ...jsonEncoded]) {
  let v = (process.env[k] || '').trim();
  if ((v.startsWith('\"') && v.endsWith('\"')) || (v.startsWith(\"'\") && v.endsWith(\"'\"))) v = v.slice(1,-1).trim();
  if (v) out[k] = { value: v, json: jsonEncoded.includes(k) };
}
process.stdout.write(JSON.stringify(out));
")

# Write the secrets payload to a temp file for scp
SECRETS_FILE=$(mktemp /tmp/prawwplus-secrets-XXXXXX.json)
echo "$SECRETS_JSON" > "$SECRETS_FILE"
scp $SSH_OPTS "$SECRETS_FILE" "$SSH:/tmp/prawwplus_secrets.json" && rm -f "$SECRETS_FILE"

ssh $SSH_OPTS "$SSH" "APP_DIR='$APP_DIR' bash -s" << 'EOF'
set -e
ENV_FILE="$APP_DIR/.env"

# Create skeleton if missing
if [ ! -f "$ENV_FILE" ]; then
cat > "$ENV_FILE" << 'ENVEOF'
# PRaww+ production environment
PORT=8080
NODE_ENV=production
TRUST_PROXY=1
APP_URL=https://rtc.praww.co.za
LOG_LEVEL=info
FREESWITCH_DOMAIN=158.180.29.84
FREESWITCH_ESL_HOST=127.0.0.1
FREESWITCH_ESL_PORT=8021
FREESWITCH_WS_URL=ws://127.0.0.1:8081/
FREESWITCH_SIP_WS_URL=ws://127.0.0.1:5066/
FREESWITCH_SIP_WS_PORT=5066
FREESWITCH_SSH_USER=ubuntu
FREESWITCH_SSH_PORT=22
FREESWITCH_CONF_DIR=/usr/local/freeswitch/conf
FREESWITCH_STORAGE_DIR=/usr/local/freeswitch/storage
FREESWITCH_EXT_IP=158.180.29.84
FREESWITCH_INTERNAL_WS_URL=ws://127.0.0.1:8081/
TURN_HOST=turn.praww.co.za
TURN_PROBE_HOST=127.0.0.1
MONGODB_USE_TRANSACTIONS=false
LOW_BALANCE_THRESHOLD_COINS=10
MAX_BILLSEC_PER_CALL=3600
MAX_COINS_SPEND_PER_DAY=500
MAX_CONCURRENT_CALLS_PER_USER=2
RECONCILIATION_INTERVAL_MS=60000
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=""
SMTP_PORT=587
SMTP_FROM=PRaww+ <noreply@praww.co.za>
ENVEOF
  echo "  Created $ENV_FILE"
fi

# Always fix known path issue
sed -i 's|^FREESWITCH_CONF_DIR=.*|FREESWITCH_CONF_DIR=/usr/local/freeswitch/conf|' "$ENV_FILE"

# Upsert all secrets from the JSON payload
python3 << 'PYEOF'
import json, re

with open('/tmp/prawwplus_secrets.json') as f:
    secrets = json.load(f)

with open('/home/ubuntu/PRawwPlus/.env') as f:
    content = f.read()

for key, meta in secrets.items():
    val = meta['value']
    use_json = meta['json']
    stored = key + '=' + (json.dumps(val) if use_json else val)
    pattern = r'^' + re.escape(key) + r'=.*'
    if re.search(pattern, content, re.MULTILINE):
        content = re.sub(pattern, stored, content, flags=re.MULTILINE)
    else:
        content += '\n' + stored
with open('/home/ubuntu/PRawwPlus/.env', 'w') as f:
    f.write(content)
print('  Secrets upserted:', list(secrets.keys()))
PYEOF
EOF

# ─── Build shared libs + API server ─────────────────────────────────────────
echo ""
echo "=== Building shared libraries and API server ==="
ssh $SSH_OPTS "$SSH" "APP_DIR='$APP_DIR' bash -s" << 'EOF'
set -e
cd "$APP_DIR"
echo "  Building shared libs..."
pnpm --filter @workspace/db \
     --filter @workspace/api-zod \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build
echo "  Building API server..."
pnpm --filter @workspace/api-server run build
echo "  Build complete — dist/index.cjs exists: $(test -f artifacts/api-server/dist/index.cjs && echo YES || echo NO)"
EOF

# ─── Start / restart API server via systemd ──────────────────────────────────
echo ""
echo "=== Starting API server with systemd ==="
ssh $SSH_OPTS "$SSH" "APP_DIR='$APP_DIR' bash -s" << 'EOF'
set -e
# Install the service file (always keep it in sync with the repo)
sudo cp "$APP_DIR/deploy/prawwplus-api.service" /etc/systemd/system/prawwplus-api.service
sudo systemctl daemon-reload
sudo systemctl enable prawwplus-api

if systemctl is-active --quiet prawwplus-api; then
  echo "  Restarting existing service..."
  sudo systemctl restart prawwplus-api
else
  echo "  Starting service for first time..."
  sudo systemctl start prawwplus-api
fi

# Wait up to 30s for service to become active
for i in $(seq 1 6); do
  sleep 5
  if systemctl is-active --quiet prawwplus-api; then
    echo "  ✓ Service active after $((i*5))s"
    break
  fi
  if [ "$i" -eq 6 ]; then
    echo "  ✗ Service failed to start — recent logs:"
    journalctl -u prawwplus-api -n 40 --no-pager
    exit 1
  fi
  echo "  ... $((i*5))s"
done

echo "  systemd status:"
systemctl status prawwplus-api --no-pager --lines=5
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
    root /home/ubuntu/PRawwPlus/artifacts/prawwplus/dist/public;
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
echo "  1. Add secrets to /home/ubuntu/PRawwPlus/.env on the VPS:"
echo "       ssh ubuntu@158.180.29.84 'nano /home/ubuntu/PRawwPlus/.env'"
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
