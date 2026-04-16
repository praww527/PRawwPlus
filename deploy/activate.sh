#!/usr/bin/env bash
# deploy/activate.sh
# Fix all issues found by diagnose.sh in one pass.
# Run as the ubuntu user (with sudo access).
# Usage: bash deploy/activate.sh

set -uo pipefail

DEPLOY_DIR="/home/ubuntu/PRawwPlus"
DOMAIN="rtc.praww.co.za"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GRN}✓${NC} $*"; }
info() { echo -e "${YLW}→${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }
hr()   { echo "──────────────────────────────────────────────────────────────"; }

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              PRaww+ Activate — $(date '+%Y-%m-%d %H:%M')           ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── Step 1: .env ──────────────────────────────────────────────────────────────
hr
echo "Step 1: Environment file"

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  ok "Created $DEPLOY_DIR/.env from .env.example"
  echo ""
  err "ACTION REQUIRED — open .env and fill in your real values:"
  echo "   nano $DEPLOY_DIR/.env"
  echo ""
  echo "   Minimum required:"
  echo "     PORT=3000"
  echo "     NODE_ENV=production"
  echo "     APP_URL=https://${DOMAIN}"
  echo "     TRUST_PROXY=1"
  echo "     MONGODB_URI=mongodb+srv://..."
  echo "     FREESWITCH_DOMAIN=<your VPS public IP>"
  echo "     FREESWITCH_ESL_PASSWORD=<strong password>"
  echo ""
  echo "   After saving, re-run this script:"
  echo "     bash $DEPLOY_DIR/deploy/activate.sh"
  echo ""
  exit 0
else
  ok ".env already exists"

  # Read MONGODB_URI directly from the file (avoids bash misinterpreting & ? + in the URI)
  MONGODB_VAL=$(grep -E '^[[:space:]]*MONGODB_URI=' "$DEPLOY_DIR/.env" | head -1 | cut -d= -f2-)
  # Strip surrounding quotes if present
  MONGODB_VAL="${MONGODB_VAL#\"}" ; MONGODB_VAL="${MONGODB_VAL%\"}"
  MONGODB_VAL="${MONGODB_VAL#\'}"  ; MONGODB_VAL="${MONGODB_VAL%\'}"

  if [ -z "$MONGODB_VAL" ] || [[ "$MONGODB_VAL" == *"USER:PASS"* ]] || [[ "$MONGODB_VAL" == *"<"* ]]; then
    err "MONGODB_URI is not set or still has a placeholder — edit .env first"
    echo "   nano $DEPLOY_DIR/.env"
    exit 1
  fi
  ok "MONGODB_URI is set"
fi

# ── Step 2: nginx site symlink ────────────────────────────────────────────────
hr
echo "Step 2: nginx site"

sudo cp "$DEPLOY_DIR/deploy/nginx.conf" /etc/nginx/sites-available/prawwplus

if [ ! -L "/etc/nginx/sites-enabled/prawwplus" ]; then
  sudo ln -sf /etc/nginx/sites-available/prawwplus /etc/nginx/sites-enabled/prawwplus
  ok "Enabled nginx site: prawwplus"
else
  ok "nginx site already enabled"
fi

# Remove the default nginx site if it's still there (it conflicts on port 80)
if [ -L "/etc/nginx/sites-enabled/default" ]; then
  sudo rm -f /etc/nginx/sites-enabled/default
  ok "Removed default nginx site (was conflicting)"
fi

if sudo nginx -t 2>/dev/null; then
  sudo systemctl reload nginx
  ok "nginx reloaded"
else
  err "nginx config has errors — fix before continuing"
  sudo nginx -t
  exit 1
fi

# ── Step 3: SSL certificate ───────────────────────────────────────────────────
hr
echo "Step 3: SSL certificate"

CERT_FILE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [ -f "$CERT_FILE" ]; then
  ok "SSL certificate already exists"
else
  info "Running certbot — this requires port 80 to be reachable from the internet"
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --email "admin@praww.co.za" --redirect 2>&1 \
    && ok "SSL certificate issued for ${DOMAIN}" \
    || {
      err "certbot failed — check that DNS for ${DOMAIN} points to this VPS"
      echo "   Retry manually: sudo certbot --nginx -d ${DOMAIN}"
    }
fi

# ── Step 4: systemd service ───────────────────────────────────────────────────
hr
echo "Step 4: API systemd service"

sudo cp "$DEPLOY_DIR/deploy/prawwplus-api.service" /etc/systemd/system/prawwplus-api.service
sudo systemctl daemon-reload
sudo systemctl enable prawwplus-api

if systemctl is-active --quiet prawwplus-api 2>/dev/null; then
  sudo systemctl restart prawwplus-api
  ok "prawwplus-api restarted"
else
  sudo systemctl start prawwplus-api
  ok "prawwplus-api started"
fi

sleep 3

if systemctl is-active --quiet prawwplus-api; then
  ok "prawwplus-api is running"
else
  err "prawwplus-api failed to start — check logs:"
  echo "   sudo journalctl -u prawwplus-api -n 40 --no-pager"
  sudo journalctl -u prawwplus-api -n 20 --no-pager || true
  exit 1
fi

# ── Step 5: FreeSWITCH fs_cli check ──────────────────────────────────────────
hr
echo "Step 5: FreeSWITCH"

if command -v fs_cli &>/dev/null; then
  FS_OUT=$(fs_cli -x "status" 2>/dev/null | head -3 || echo "")
  if echo "$FS_OUT" | grep -q "UP"; then
    ok "FreeSWITCH is UP"
    echo "   $FS_OUT"
  else
    info "FreeSWITCH did not respond — trying restart"
    sudo systemctl restart freeswitch
    sleep 8
    FS_OUT2=$(fs_cli -x "status" 2>/dev/null | head -3 || echo "")
    if echo "$FS_OUT2" | grep -q "UP"; then
      ok "FreeSWITCH is UP (after restart)"
    else
      err "FreeSWITCH still not responding"
      echo "   sudo journalctl -u freeswitch -n 30 --no-pager"
    fi
  fi
else
  info "fs_cli not found — skipping (FreeSWITCH may not be installed)"
  echo "   Install: sudo bash $DEPLOY_DIR/deploy/freeswitch.sh"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
hr
echo ""
ok "Activation complete"
echo ""
echo "Next steps:"
echo "  1. Check health:      bash $DEPLOY_DIR/deploy/diagnose.sh"
echo "  2. View API logs:     sudo journalctl -u prawwplus-api -f"
echo "  3. Promote admin:     cd $DEPLOY_DIR && pnpm --filter @workspace/scripts run make-admin admin@praww.co.za"
echo ""
