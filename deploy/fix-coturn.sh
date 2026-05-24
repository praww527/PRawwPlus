#!/usr/bin/env bash
# =============================================================================
# PRaww+ — Fix Coturn configuration issues
# =============================================================================
# Run this on your VPS AFTER adding the DNS A record for turn.praww.co.za.
#
#   sudo bash /home/ubuntu/PRawwPlus/deploy/fix-coturn.sh
#
# What this script does:
#   1. Reads TURN_HOST + TURN_SECRET from your .env
#   2. Removes conflicting lt-cred-mech from turnserver.conf
#   3. Ensures external-ip is set to your public IP
#   4. Adds TURN_PROBE_HOST=127.0.0.1 to .env (bypasses Oracle hairpin NAT)
#   5. Issues a Let's Encrypt TLS cert if DNS has propagated
#   6. Writes a clean turnserver.conf
#   7. Restarts coturn + prawwplus-api
#   8. Runs the health check and prints the result
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}── $* ──${NC}"; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"

ENV_FILE="/home/ubuntu/PRawwPlus/.env"
CONF="/etc/turnserver.conf"

# ── 1. Read values from .env ──────────────────────────────────────────────────
step "Reading .env"

[[ -f "$ENV_FILE" ]] || error ".env not found at $ENV_FILE"

TURN_HOST=$(grep -E '^TURN_HOST=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
TURN_SECRET=$(grep -E '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)

[[ -z "$TURN_HOST"   ]] && error "TURN_HOST is not set in $ENV_FILE"
[[ -z "$TURN_SECRET" ]] && error "TURN_SECRET is not set in $ENV_FILE"

info "TURN_HOST   = $TURN_HOST"
info "TURN_SECRET = [hidden]"

# ── 2. Detect public IP ───────────────────────────────────────────────────────
step "Detecting public IP"

PUBLIC_IP=$(curl -sf --max-time 5 https://ipv4.icanhazip.com 2>/dev/null \
         || curl -sf --max-time 5 https://api4.my-ip.io/ip 2>/dev/null \
         || true)

[[ -z "$PUBLIC_IP" ]] && error "Could not detect public IP. Set PUBLIC_IP env var and re-run."
info "Public IP = $PUBLIC_IP"

# ── 3. Check DNS propagation ──────────────────────────────────────────────────
step "Checking DNS for $TURN_HOST"

DNS_IP=$(dig +short "$TURN_HOST" A 2>/dev/null | tail -1 || true)

if [[ -z "$DNS_IP" ]]; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  DNS NOT FOUND for $TURN_HOST${NC}"
  echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
  echo -e "${RED}║  You MUST add a DNS A record before this script can finish:  ║${NC}"
  echo -e "${RED}║                                                              ║${NC}"
  echo -e "${RED}║    Type:  A                                                  ║${NC}"
  printf  "${RED}║    Name:  %-51s║${NC}\n" "$TURN_HOST"
  printf  "${RED}║    Value: %-51s║${NC}\n" "$PUBLIC_IP"
  echo -e "${RED}║                                                              ║${NC}"
  echo -e "${RED}║  Go to your DNS provider (Cloudflare / Route53 / etc),       ║${NC}"
  echo -e "${RED}║  add the record above, wait ~60 seconds, then re-run:        ║${NC}"
  echo -e "${RED}║                                                              ║${NC}"
  echo -e "${RED}║    sudo bash /home/ubuntu/PRawwPlus/deploy/fix-coturn.sh     ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  exit 1
fi

if [[ "$DNS_IP" != "$PUBLIC_IP" ]]; then
  warn "$TURN_HOST resolves to $DNS_IP but your public IP is $PUBLIC_IP"
  warn "If you just updated DNS, wait for propagation and re-run."
  warn "Continuing anyway (may be a CDN proxy — check your DNS settings)."
else
  success "$TURN_HOST → $DNS_IP (matches public IP)"
fi

# ── 4. Issue / renew TLS cert ─────────────────────────────────────────────────
step "TLS certificate for $TURN_HOST"

CERT_PATH="/etc/letsencrypt/live/$TURN_HOST/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/$TURN_HOST/privkey.pem"
CERT_DIR="/etc/coturn/certs"

if [[ -f "$CERT_PATH" && -f "$KEY_PATH" ]]; then
  success "Let's Encrypt cert already exists"
  TURN_CERT="$CERT_PATH"
  TURN_KEY="$KEY_PATH"
else
  info "Requesting Let's Encrypt cert (stopping coturn temporarily)..."
  systemctl stop coturn || true

  if command -v certbot &>/dev/null; then
    certbot certonly --standalone --non-interactive --agree-tos \
      --register-unsafely-without-email \
      -d "$TURN_HOST" || {
      warn "certbot failed — falling back to self-signed cert"
      mkdir -p "$CERT_DIR"
      openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$CERT_DIR/turn.key" -out "$CERT_DIR/turn.crt" \
        -subj "/CN=$TURN_HOST" 2>/dev/null
      TURN_CERT="$CERT_DIR/turn.crt"
      TURN_KEY="$CERT_DIR/turn.key"
    }
    if [[ -f "$CERT_PATH" ]]; then
      TURN_CERT="$CERT_PATH"
      TURN_KEY="$KEY_PATH"
      success "Let's Encrypt cert issued"
    fi
  else
    warn "certbot not installed — installing..."
    apt-get install -y certbot
    certbot certonly --standalone --non-interactive --agree-tos \
      --register-unsafely-without-email \
      -d "$TURN_HOST"
    TURN_CERT="$CERT_PATH"
    TURN_KEY="$KEY_PATH"
    success "Let's Encrypt cert issued"
  fi
fi

# ── 5. Write clean turnserver.conf ────────────────────────────────────────────
step "Writing $CONF"

RELAY_MIN_PORT=49152
RELAY_MAX_PORT=65535

# Back up the old config
cp "$CONF" "${CONF}.bak.$(date +%s)" 2>/dev/null || true

cat > "$CONF" << EOF
# =============================================================================
# Coturn configuration — generated by PRaww+ fix-coturn.sh
# $(date -u)
# =============================================================================

# Listening interfaces and ports
listening-port=3478
tls-listening-port=5349

# Bind to all interfaces (Oracle Cloud: public IP is NAT'd, private is the NIC)
listening-ip=0.0.0.0

# Public IP for NAT traversal — tells Coturn what IP to put in relay candidates.
# On Oracle Cloud the NIC has a private IP (10.x.x.x); this is the real public one.
external-ip=$PUBLIC_IP

# Realm — typically your TURN domain
realm=$TURN_HOST

# ── Authentication ────────────────────────────────────────────────────────────
# REST API / HMAC time-limited credentials (used by PRaww+ verto.ts)
# DO NOT add lt-cred-mech here — it conflicts with use-auth-secret.
use-auth-secret
static-auth-secret=$TURN_SECRET

# ── TLS / DTLS ────────────────────────────────────────────────────────────────
cert=$TURN_CERT
pkey=$TURN_KEY
no-tlsv1
no-tlsv1_1

# ── Relay port range ──────────────────────────────────────────────────────────
min-port=$RELAY_MIN_PORT
max-port=$RELAY_MAX_PORT

# ── Performance & security ────────────────────────────────────────────────────
fingerprint
no-multicast-peers

# Deny relay to loopback/private ranges (security hardening)
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255

# ── Logging ───────────────────────────────────────────────────────────────────
log-file=/var/log/coturn/turnserver.log
new-log-timestamp
EOF

chmod 640 "$CONF"
success "turnserver.conf written (lt-cred-mech removed, external-ip=$PUBLIC_IP, listening-ip=0.0.0.0)"

# ── 6. Ensure TURN_PROBE_HOST=127.0.0.1 is in .env ───────────────────────────
step "Updating .env"

if grep -q '^TURN_PROBE_HOST=' "$ENV_FILE"; then
  sed -i 's|^TURN_PROBE_HOST=.*|TURN_PROBE_HOST=127.0.0.1|' "$ENV_FILE"
  info "Updated TURN_PROBE_HOST=127.0.0.1 in .env"
else
  echo "TURN_PROBE_HOST=127.0.0.1" >> "$ENV_FILE"
  info "Added TURN_PROBE_HOST=127.0.0.1 to .env"
fi
success ".env updated"

# ── 7. Ensure runtime directories exist ──────────────────────────────────────
mkdir -p /var/log/coturn
chown -R turnserver:turnserver /var/log/coturn 2>/dev/null || true

# pidfile directory — must exist + be owned by turnserver or coturn won't start
mkdir -p /run/coturn
chown turnserver:turnserver /run/coturn 2>/dev/null || true

# ── 7b. Fix TLS cert permissions for coturn ──────────────────────────────────
# Let's Encrypt certs are root-only by default.  coturn (running as
# 'turnserver') cannot read the private key → TURNS on port 5349 silently
# won't start.  Fix: make turnserver own/read the key, install renewal hook.
step "Fixing TLS cert permissions"

if [[ -f "$KEY_PATH" ]]; then
  chown root:turnserver "$KEY_PATH"  && chmod 640 "$KEY_PATH"  && success "privkey.pem: root:turnserver 640"
  chown root:turnserver "$CERT_PATH" && chmod 644 "$CERT_PATH" && success "fullchain.pem: root:turnserver 644"
  LIVE_DIR=$(dirname "$CERT_PATH")
  chmod 750 "$LIVE_DIR" && success "$LIVE_DIR: 750 (coturn can traverse)"

  # Add turnserver to ssl-cert group (belt-and-suspenders)
  if getent group ssl-cert &>/dev/null; then
    usermod -aG ssl-cert turnserver 2>/dev/null && info "turnserver added to ssl-cert group"
  fi

  # Install certbot post-renewal deploy hook so permissions survive renewals.
  HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"
  mkdir -p "$HOOK_DIR"
  HOOK_FILE="$HOOK_DIR/coturn-restart.sh"
  cat > "$HOOK_FILE" << 'HOOK'
#!/usr/bin/env bash
# Certbot post-renewal hook — restores coturn cert permissions + restarts coturn
set -euo pipefail
DOMAIN_DIR="/etc/letsencrypt/live"
for DIR in "$DOMAIN_DIR"/*/; do
  KEY="$DIR/privkey.pem"
  CERT="$DIR/fullchain.pem"
  [ -f "$KEY"  ] && chown root:turnserver "$KEY"  && chmod 640 "$KEY"  || true
  [ -f "$CERT" ] && chown root:turnserver "$CERT" && chmod 644 "$CERT" || true
  chmod 750 "$DIR" || true
done
mkdir -p /run/coturn
chown turnserver:turnserver /run/coturn || true
systemctl restart coturn || true
HOOK
  chmod 755 "$HOOK_FILE"
  success "Certbot renewal hook installed: $HOOK_FILE"
else
  warn "TLS key $KEY_PATH not found — skipping permission fix"
fi

# ── 8. Restart services ───────────────────────────────────────────────────────
step "Restarting services"

systemctl daemon-reload
systemctl restart coturn
sleep 3

if systemctl is-active --quiet coturn; then
  success "coturn is running"
else
  error "coturn failed to start — check: journalctl -u coturn -n 30 --no-pager"
fi

systemctl restart prawwplus-api
sleep 3

if systemctl is-active --quiet prawwplus-api; then
  success "prawwplus-api is running"
else
  error "prawwplus-api failed to start — check: journalctl -u prawwplus-api -n 30 --no-pager"
fi

# ── 9. Verify ports ───────────────────────────────────────────────────────────
step "Verifying listening ports"

echo ""
ss -tlnup | grep -E '3478|5349' || warn "No listeners found on 3478/5349 — check coturn logs"
echo ""

# ── 10. Health check ──────────────────────────────────────────────────────────
step "Running TURN health check"

sleep 2
HEALTH=$(curl -sf --max-time 10 "http://localhost:$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || echo 3000)/api/healthz/turn" 2>/dev/null || true)

if [[ -z "$HEALTH" ]]; then
  warn "Could not reach local health endpoint — trying public URL..."
  APP_URL=$(grep -E '^APP_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
  if [[ -n "$APP_URL" ]]; then
    HEALTH=$(curl -sf --max-time 10 "$APP_URL/api/healthz/turn" 2>/dev/null || true)
  fi
fi

if [[ -n "$HEALTH" ]]; then
  echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
  OK=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok','?'))" 2>/dev/null || echo "?")
  TURN_REACHABLE=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('turnReachable','?'))" 2>/dev/null || echo "?")
  echo ""
  if [[ "$OK" == "True" || "$OK" == "true" ]]; then
    success "TURN health check PASSED (ok=$OK, turnReachable=$TURN_REACHABLE)"
  else
    warn "TURN health check: ok=$OK, turnReachable=$TURN_REACHABLE"
    warn "Check the summary field above for details."
  fi
else
  warn "Could not reach health endpoint yet — check manually in a few seconds:"
  echo "  curl https://rtc.praww.co.za/api/healthz/turn | python3 -m json.tool"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  fix-coturn.sh complete                                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Coturn config : ${CYAN}$CONF${NC}"
echo -e "  TLS cert      : ${CYAN}$TURN_CERT${NC}"
echo -e "  Logs          : ${CYAN}journalctl -u coturn -f${NC}"
echo -e "  Health check  : ${CYAN}curl https://rtc.praww.co.za/api/healthz/turn | python3 -m json.tool${NC}"
echo ""
echo -e "${YELLOW}IMPORTANT — Oracle VCN Security List (cloud console, not just UFW):${NC}"
echo -e "  Navigate to: Oracle Cloud Console → Networking → VCN → Security Lists"
echo -e "  Add ALL of these Ingress rules (both UFW AND the cloud console must allow them):"
echo -e "    Protocol  CIDR         Port(s)       Purpose"
echo -e "    TCP       0.0.0.0/0    3478          TURN/STUN TCP"
echo -e "    UDP       0.0.0.0/0    3478          TURN/STUN UDP"
echo -e "    TCP       0.0.0.0/0    5349          TURNS/TLS TCP  ← required for TURNS"
echo -e "    UDP       0.0.0.0/0    5349          TURNS/DTLS UDP"
echo -e "    UDP       0.0.0.0/0    49152-65535   TURN relay range"
echo -e ""
echo -e "${RED}  If port 5349 is missing from the Oracle VCN rules, TURNS will be${NC}"
echo -e "${RED}  UNREACHABLE even after this script completes.${NC}"
echo ""
