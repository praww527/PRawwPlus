#!/usr/bin/env bash
# deploy/diagnose.sh
# PRaww+ VPS health check — run on the Oracle VPS to diagnose common issues.
# Usage: bash deploy/diagnose.sh
#
# Does NOT modify anything — read-only diagnostic only.

set -uo pipefail

DEPLOY_DIR="/home/ubuntu/PRawwPlus"
DOMAIN="rtc.praww.co.za"
API_PORT=3000

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GRN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YLW}!${NC} $*"; }
hr()   { echo "──────────────────────────────────────────────────────────────"; }

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           PRaww+ VPS Diagnostic — $(date '+%Y-%m-%d %H:%M')          ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── 1. Env file ───────────────────────────────────────────────────────────────
hr
echo "1. Environment file"

if [ -f "$DEPLOY_DIR/.env" ]; then
  pass ".env exists"

  # Read a variable directly from the file — avoids bash misinterpreting
  # special characters like & ? + in MongoDB URIs when using `source`.
  read_env_var() {
    local key="$1"
    local val
    val=$(grep -E "^[[:space:]]*${key}=" "$DEPLOY_DIR/.env" | head -1 | cut -d= -f2-)
    val="${val#\"}" ; val="${val%\"}"
    val="${val#\'}"  ; val="${val%\'}"
    echo "$val"
  }

  check_var() {
    local var="$1"
    local val
    val=$(read_env_var "$var")
    if [ -z "$val" ] || [[ "$val" == *"CHANGE_ME"* ]] || [[ "$val" == *"YOUR_"* ]] || [[ "$val" == *"<"* ]]; then
      fail "$var is NOT set or still has placeholder value"
    else
      pass "$var is set"
    fi
  }

  check_var PORT
  check_var NODE_ENV
  check_var APP_URL
  check_var TRUST_PROXY
  check_var MONGODB_URI
  check_var FREESWITCH_DOMAIN
  check_var FREESWITCH_ESL_HOST
  check_var FREESWITCH_ESL_PASSWORD

  ENV_PORT=$(read_env_var PORT)
  if [ "$ENV_PORT" != "3000" ]; then
    fail "PORT=${ENV_PORT:-unset} — nginx expects 3000. Fix: PORT=3000 in .env"
  else
    pass "PORT=3000 matches nginx upstream"
  fi
else
  fail ".env not found at $DEPLOY_DIR/.env"
  echo "     Create it: cp $DEPLOY_DIR/.env.example $DEPLOY_DIR/.env && nano $DEPLOY_DIR/.env"
fi

# ── 2. Services ───────────────────────────────────────────────────────────────
hr
echo "2. Systemd services"

check_service() {
  local svc="$1"
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    pass "$svc is running"
  else
    fail "$svc is NOT running"
    echo "     Fix: sudo systemctl start $svc && sudo journalctl -u $svc -n 30 --no-pager"
  fi
}

check_service prawwplus-api
check_service nginx
check_service freeswitch 2>/dev/null || warn "freeswitch service not found (FreeSWITCH may not be installed)"

# ── 3. Port connectivity ──────────────────────────────────────────────────────
hr
echo "3. Internal port connectivity"

check_port() {
  local port="$1"; local label="$2"
  if ss -tlnp 2>/dev/null | grep -q ":${port} " || nc -z 127.0.0.1 "$port" 2>/dev/null; then
    pass "Port $port ($label) is listening"
  else
    fail "Port $port ($label) is NOT listening"
  fi
}

check_port 3000  "Node.js API"
check_port 8021  "FreeSWITCH ESL"
check_port 8081  "FreeSWITCH Verto WS"
check_port 5066  "FreeSWITCH SIP WS"
check_port 80    "nginx HTTP"
check_port 443   "nginx HTTPS"

# ── 4. API health check ───────────────────────────────────────────────────────
hr
echo "4. API health check"

API_RESP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://127.0.0.1:${API_PORT}/api/healthz" 2>/dev/null; echo "")
API_RESP="${API_RESP//[^0-9]/}"   # strip any accidental whitespace/newlines
API_RESP="${API_RESP:-000}"

if [ "$API_RESP" = "200" ]; then
  pass "API /api/healthz → 200 OK"
elif [ "$API_RESP" = "000" ]; then
  fail "API /api/healthz → no response (Node.js not running or wrong port)"
  echo "     Check: sudo journalctl -u prawwplus-api -n 50 --no-pager"
else
  warn "API /api/healthz → HTTP $API_RESP (unexpected)"
fi

HTTPS_RESP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  "https://${DOMAIN}/api/healthz" 2>/dev/null; echo "")
HTTPS_RESP="${HTTPS_RESP//[^0-9]/}"
HTTPS_RESP="${HTTPS_RESP:-000}"

if [ "$HTTPS_RESP" = "200" ]; then
  pass "HTTPS https://${DOMAIN}/api/healthz → 200 OK"
elif [ "$HTTPS_RESP" = "000" ]; then
  fail "HTTPS check failed — nginx or SSL certificate may be broken"
  echo "     Check: sudo nginx -t && sudo certbot renew --dry-run"
else
  warn "HTTPS /api/healthz → HTTP $HTTPS_RESP"
fi

# ── 5. FreeSWITCH ────────────────────────────────────────────────────────────
hr
echo "5. FreeSWITCH status"

if command -v fs_cli &>/dev/null; then
  FS_STATUS=$(fs_cli -x "status" 2>/dev/null | head -5 || echo "")
  if echo "$FS_STATUS" | grep -q "UP"; then
    pass "FreeSWITCH is UP"
    echo "     $(echo "$FS_STATUS" | head -1)"
  else
    fail "FreeSWITCH did not respond to 'status' command"
    echo "     Check: sudo journalctl -u freeswitch -n 30 --no-pager"
    echo "     Or:    sudo systemctl restart freeswitch"
  fi
else
  warn "fs_cli not found — FreeSWITCH may not be installed"
  echo "     Install: sudo bash $DEPLOY_DIR/deploy/freeswitch.sh"
fi

# ── 6. SSL certificate ────────────────────────────────────────────────────────
hr
echo "6. SSL certificate"

# Certbot sometimes appends -0001 or -0002 to the directory name
CERT_FILE=""
for candidate in \
    "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" \
    "/etc/letsencrypt/live/${DOMAIN}-0001/fullchain.pem" \
    "/etc/letsencrypt/live/${DOMAIN}-0002/fullchain.pem"; do
  if [ -f "$candidate" ]; then
    CERT_FILE="$candidate"
    break
  fi
done

# Also check what nginx is actually using (most reliable)
NGINX_CERT=$(sudo nginx -T 2>/dev/null | grep -oP 'ssl_certificate\s+\K[^;]+' | head -1 | tr -d ' ')

if [ -n "$NGINX_CERT" ] && [ -f "$NGINX_CERT" ]; then
  CERT_FILE="$NGINX_CERT"
fi

if [ -n "$CERT_FILE" ]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2)
  EXPIRY_TS=$(date -d "$EXPIRY" +%s 2>/dev/null || echo "0")
  NOW_TS=$(date +%s)
  DAYS_LEFT=$(( (EXPIRY_TS - NOW_TS) / 86400 ))

  if [ "$DAYS_LEFT" -gt 14 ]; then
    pass "SSL cert expires in $DAYS_LEFT days ($EXPIRY)"
  elif [ "$DAYS_LEFT" -gt 0 ]; then
    warn "SSL cert expires SOON — $DAYS_LEFT days ($EXPIRY)"
    echo "     Fix: sudo certbot renew"
  else
    fail "SSL certificate is EXPIRED or cannot be read"
    echo "     Fix: sudo certbot renew --force-renewal"
  fi
else
  fail "SSL cert not found (checked /etc/letsencrypt/live/${DOMAIN}*)"
  echo "     Issue: sudo certbot --nginx -d ${DOMAIN}"
fi

# ── 7. nginx config ───────────────────────────────────────────────────────────
hr
echo "7. nginx config"

if sudo nginx -t 2>/dev/null; then
  pass "nginx config is valid"
else
  fail "nginx config has errors — run: sudo nginx -t"
fi

if [ -L "/etc/nginx/sites-enabled/prawwplus" ]; then
  pass "prawwplus nginx site is enabled"
else
  fail "prawwplus nginx site is NOT enabled"
  echo "     Fix: sudo ln -sf /etc/nginx/sites-available/prawwplus /etc/nginx/sites-enabled/prawwplus"
  echo "          sudo nginx -t && sudo systemctl reload nginx"
fi

# ── 8. Disk / memory ─────────────────────────────────────────────────────────
hr
echo "8. Resources"

DISK_USE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USE" -lt 80 ]; then
  pass "Disk usage: ${DISK_USE}%"
elif [ "$DISK_USE" -lt 90 ]; then
  warn "Disk usage: ${DISK_USE}% (getting full)"
else
  fail "Disk usage: ${DISK_USE}% — CRITICAL"
fi

MEM_FREE_MB=$(free -m | awk '/^Mem:/{print $4}')
if [ "$MEM_FREE_MB" -gt 200 ]; then
  pass "Free memory: ${MEM_FREE_MB} MB"
else
  warn "Free memory: ${MEM_FREE_MB} MB (low)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
hr
echo ""
echo "Diagnostic complete."
echo ""
echo "Quick-fix commands:"
echo "  View API logs:       sudo journalctl -u prawwplus-api -f"
echo "  Restart API:         sudo systemctl restart prawwplus-api"
echo "  Deploy latest code:  bash $DEPLOY_DIR/deploy/update.sh"
echo "  Promote to admin:    pnpm --filter @workspace/scripts run make-admin admin@email.com"
echo "  Reload nginx:        sudo systemctl reload nginx"
echo ""
