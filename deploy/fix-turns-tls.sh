#!/usr/bin/env bash
# =============================================================================
# PRaww+ — Fix TURNS/TLS on port 5349
# =============================================================================
# Run this on the Oracle VPS when `turns:turn.praww.co.za:5349?transport=tcp`
# is UNREACHABLE but port 3478 (TURN) works fine.
#
#   sudo bash /home/ubuntu/PRawwPlus/deploy/fix-turns-tls.sh
#
# What this script does (in order):
#   1.  Checks coturn listening ports (ss -lntup)
#   2.  Verifies /etc/turnserver.conf TLS directives
#   3.  Verifies Let's Encrypt cert files exist and are readable
#   4.  Fixes TLS cert permissions so coturn (turnserver user) can read them
#   5.  Ensures tls-listening-port=5349, cert= and pkey= are present + correct
#   6.  Verifies UFW rules for 5349/tcp
#   7.  Prints manual Oracle Cloud VCN Security List instructions
#   8.  Restarts coturn + verifies it is running
#   9.  Tests the TLS listener with openssl s_client
#   10. Prints health-check URL to confirm end-to-end
# =============================================================================

set -uo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'
CYN='\033[0;36m'; BLD='\033[1m'; NC='\033[0m'

pass()  { echo -e "  ${GRN}[OK]${NC}    $*"; }
fail()  { echo -e "  ${RED}[FAIL]${NC}  $*" >&2; FAILURES=$((FAILURES+1)); }
warn()  { echo -e "  ${YLW}[WARN]${NC}  $*"; }
info()  { echo -e "  ${CYN}[INFO]${NC}  $*"; }
step()  { echo -e "\n${BLD}── $* ──${NC}"; }
fixed() { echo -e "  ${GRN}[FIXED]${NC} $*"; }

FAILURES=0
CONF="/etc/turnserver.conf"
TURN_HOST="turn.praww.co.za"
CERT_PATH="/etc/letsencrypt/live/${TURN_HOST}/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/${TURN_HOST}/privkey.pem"
LIVE_DIR="/etc/letsencrypt/live/${TURN_HOST}"

[[ $EUID -ne 0 ]] && { echo -e "${RED}Run as root: sudo bash $0${NC}"; exit 1; }

echo ""
echo -e "${BLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLD}║      PRaww+ — TURNS/TLS Port 5349 Fix  $(date '+%Y-%m-%d %H:%M')     ║${NC}"
echo -e "${BLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Coturn listening ports ─────────────────────────────────────────────────
step "1. Coturn listening ports"

echo ""
echo "  Output of: ss -lntup | grep -E '3478|5349|turn'"
echo "  ─────────────────────────────────────────────────────"
ss -lntup 2>/dev/null | grep -E '3478|5349|turn' || echo "  (no matches)"
echo "  ─────────────────────────────────────────────────────"
echo ""

PORT_3478=$(ss -lntup 2>/dev/null | grep -c ':3478 ' || true)
PORT_5349=$(ss -lntup 2>/dev/null | grep -c ':5349 ' || true)

if [[ "$PORT_3478" -gt 0 ]]; then
  pass "Port 3478 is listening (TURN UDP/TCP) ✓"
else
  fail "Port 3478 is NOT listening — coturn may not be running"
fi

if [[ "$PORT_5349" -gt 0 ]]; then
  pass "Port 5349 is listening (TURNS/TLS) ✓"
  echo ""
  warn "Port 5349 IS listening locally — the problem is likely the Oracle VCN"
  warn "Security List blocking inbound TCP 5349 at the cloud level."
  warn "Skip to step 7 (Oracle Cloud rules) below."
else
  fail "Port 5349 is NOT listening — TLS is not starting. Continuing diagnosis..."
fi

# ── 2. Verify turnserver.conf TLS config ──────────────────────────────────────
step "2. Verify /etc/turnserver.conf TLS directives"

if [[ ! -f "$CONF" ]]; then
  fail "$CONF does not exist"
  info "Fix: sudo bash /home/ubuntu/PRawwPlus/deploy/fix-coturn.sh"
  exit 1
fi

echo ""
echo "  Relevant lines from $CONF:"
echo "  ─────────────────────────────────────────────────────"
grep -E '^(tls-listening-port|cert|pkey|no-tls|listening-port|listening-ip|external-ip|use-auth-secret|static-auth-secret|lt-cred-mech)' \
  "$CONF" 2>/dev/null | sed 's/^/  /' || echo "  (none found)"
echo "  ─────────────────────────────────────────────────────"
echo ""

# Check each required TLS directive
TLS_PORT=$(grep -E '^tls-listening-port=' "$CONF" 2>/dev/null | cut -d= -f2 | tr -d ' ' || true)
CONF_CERT=$(grep -E '^cert=' "$CONF" 2>/dev/null | cut -d= -f2 | tr -d ' ' || true)
CONF_KEY=$(grep -E '^pkey=' "$CONF" 2>/dev/null | cut -d= -f2 | tr -d ' ' || true)

CONF_CHANGED=false

if [[ "$TLS_PORT" == "5349" ]]; then
  pass "tls-listening-port=5349 is set"
else
  fail "tls-listening-port=5349 is MISSING or wrong (found: '${TLS_PORT:-empty}')"
  if grep -q '^tls-listening-port=' "$CONF" 2>/dev/null; then
    sed -i 's|^tls-listening-port=.*|tls-listening-port=5349|' "$CONF"
  else
    echo "tls-listening-port=5349" >> "$CONF"
  fi
  fixed "Added tls-listening-port=5349 to $CONF"
  CONF_CHANGED=true
fi

if [[ -n "$CONF_CERT" ]]; then
  pass "cert=$CONF_CERT is set in config"
else
  fail "cert= is MISSING from $CONF"
  info "Will add cert path pointing to Let's Encrypt cert"
  echo "cert=$CERT_PATH" >> "$CONF"
  CONF_CERT="$CERT_PATH"
  fixed "Added cert=$CERT_PATH to $CONF"
  CONF_CHANGED=true
fi

if [[ -n "$CONF_KEY" ]]; then
  pass "pkey=$CONF_KEY is set in config"
else
  fail "pkey= is MISSING from $CONF"
  echo "pkey=$KEY_PATH" >> "$CONF"
  CONF_KEY="$KEY_PATH"
  fixed "Added pkey=$KEY_PATH to $CONF"
  CONF_CHANGED=true
fi

# Check for lt-cred-mech conflict
if grep -q '^lt-cred-mech' "$CONF" 2>/dev/null; then
  fail "lt-cred-mech is present — conflicts with use-auth-secret"
  sed -i '/^lt-cred-mech/d' "$CONF"
  fixed "Removed lt-cred-mech from $CONF"
  CONF_CHANGED=true
else
  pass "No lt-cred-mech conflict"
fi

# Check no-tls accidentally disabling TLS
if grep -q '^no-tls' "$CONF" 2>/dev/null; then
  fail "no-tls is set in $CONF — this disables TURNS/5349 entirely"
  sed -i '/^no-tls$/d' "$CONF"
  fixed "Removed no-tls from $CONF"
  CONF_CHANGED=true
else
  pass "no-tls is not set (good)"
fi

# ── 3. Verify Let's Encrypt cert files ───────────────────────────────────────
step "3. Verify Let's Encrypt certificate files"

echo ""
echo "  sudo ls -lah $LIVE_DIR"
echo "  ─────────────────────────────────────────────────────"
ls -lah "$LIVE_DIR" 2>/dev/null | sed 's/^/  /' || echo "  ${RED}Directory not found!${NC}"
echo "  ─────────────────────────────────────────────────────"
echo ""

CERT_OK=true

if [[ -f "$CERT_PATH" ]]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" 2>/dev/null | cut -d= -f2 || echo "")
  if [[ -n "$EXPIRY" ]]; then
    EXPIRY_TS=$(date -d "$EXPIRY" +%s 2>/dev/null || echo "0")
    DAYS=$(( (EXPIRY_TS - $(date +%s)) / 86400 ))
    if [[ "$DAYS" -gt 14 ]]; then
      pass "fullchain.pem exists and is valid ($DAYS days until expiry)"
    elif [[ "$DAYS" -gt 0 ]]; then
      warn "fullchain.pem expires SOON — $DAYS days ($EXPIRY)"
      warn "Run: sudo certbot renew && sudo systemctl restart coturn"
    else
      fail "fullchain.pem is EXPIRED ($EXPIRY) — renew it:"
      info "  sudo certbot renew --force-renewal && sudo systemctl restart coturn"
      CERT_OK=false
    fi
  else
    warn "Could not read cert expiry from $CERT_PATH"
  fi
else
  fail "fullchain.pem NOT found at $CERT_PATH"
  CERT_OK=false

  # Try alternate suffixed paths that certbot sometimes creates
  ALT_CERT=""
  for suffix in "-0001" "-0002" "-0003"; do
    if [[ -f "/etc/letsencrypt/live/${TURN_HOST}${suffix}/fullchain.pem" ]]; then
      ALT_CERT="/etc/letsencrypt/live/${TURN_HOST}${suffix}/fullchain.pem"
      ALT_KEY="/etc/letsencrypt/live/${TURN_HOST}${suffix}/privkey.pem"
      break
    fi
  done

  if [[ -n "$ALT_CERT" ]]; then
    warn "Found cert at alternate path: $ALT_CERT"
    info "Updating $CONF to use the correct path..."
    sed -i "s|^cert=.*|cert=$ALT_CERT|" "$CONF"
    sed -i "s|^pkey=.*|pkey=$ALT_KEY|"  "$CONF"
    CONF_CERT="$ALT_CERT"
    CONF_KEY="$ALT_KEY"
    CERT_PATH="$ALT_CERT"
    KEY_PATH="$ALT_KEY"
    LIVE_DIR=$(dirname "$CERT_PATH")
    fixed "Updated $CONF to use cert at $ALT_CERT"
    CONF_CHANGED=true
    CERT_OK=true
  else
    info "No Let's Encrypt cert found. Requesting one now..."
    if command -v certbot &>/dev/null; then
      systemctl stop coturn 2>/dev/null || true
      if certbot certonly --standalone --non-interactive --agree-tos \
           --register-unsafely-without-email -d "$TURN_HOST"; then
        CERT_OK=true
        fixed "Let's Encrypt cert issued for $TURN_HOST"
        # Update conf
        sed -i "s|^cert=.*|cert=$CERT_PATH|" "$CONF"
        sed -i "s|^pkey=.*|pkey=$KEY_PATH|"  "$CONF"
        CONF_CHANGED=true
      else
        fail "certbot failed — check DNS: dig +short $TURN_HOST A"
        info "Ensure turn.praww.co.za has an A record pointing to this server's public IP"
        info "Then run: sudo certbot certonly --standalone -d $TURN_HOST"
      fi
    else
      info "Installing certbot..."
      apt-get install -y certbot -q
      systemctl stop coturn 2>/dev/null || true
      certbot certonly --standalone --non-interactive --agree-tos \
        --register-unsafely-without-email -d "$TURN_HOST" && CERT_OK=true
      CONF_CHANGED=true
    fi
  fi
fi

if [[ -f "$KEY_PATH" ]]; then
  pass "privkey.pem exists at $KEY_PATH"
else
  fail "privkey.pem NOT found at $KEY_PATH"
  CERT_OK=false
fi

# ── 4. Fix TLS cert permissions for coturn ────────────────────────────────────
step "4. Fix TLS cert permissions (critical for port 5349)"

echo ""
info "coturn runs as the 'turnserver' user. Let's Encrypt certs are root-only"
info "by default. If turnserver cannot read privkey.pem, port 5349 silently"
info "fails to bind — 3478 works but 5349 does not."
echo ""

if [[ "$CERT_OK" == true && -f "$KEY_PATH" ]]; then
  # Fix directory permissions (coturn needs execute on the live/<domain> dir)
  LIVE_DIR_ACTUAL=$(dirname "$KEY_PATH")
  chmod 750 "$LIVE_DIR_ACTUAL" 2>/dev/null && \
    fixed "chmod 750 $LIVE_DIR_ACTUAL (turnserver can traverse)" || \
    warn "Could not chmod $LIVE_DIR_ACTUAL"

  # Grant group read on the private key
  chown root:turnserver "$KEY_PATH" 2>/dev/null && chmod 640 "$KEY_PATH" 2>/dev/null && \
    fixed "privkey.pem → root:turnserver 640 (turnserver can read)" || \
    warn "Could not chown/chmod privkey.pem"

  # Grant group read on the cert chain
  chown root:turnserver "$CERT_PATH" 2>/dev/null && chmod 644 "$CERT_PATH" 2>/dev/null && \
    fixed "fullchain.pem → root:turnserver 644" || \
    warn "Could not chown/chmod fullchain.pem"

  # Add turnserver to ssl-cert group (belt and suspenders)
  if getent group ssl-cert &>/dev/null; then
    usermod -aG ssl-cert turnserver 2>/dev/null && \
      fixed "Added turnserver to ssl-cert group" || true
  fi

  # Install post-renewal hook so permissions survive certbot renewals
  HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"
  mkdir -p "$HOOK_DIR"
  HOOK_FILE="$HOOK_DIR/coturn-perms.sh"
  cat > "$HOOK_FILE" << 'HOOKEOF'
#!/usr/bin/env bash
# certbot post-renewal hook — re-applies coturn cert permissions after renewal
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
chown turnserver:turnserver /run/coturn 2>/dev/null || true
systemctl restart coturn || true
HOOKEOF
  chmod 755 "$HOOK_FILE"
  fixed "Certbot renewal hook installed: $HOOK_FILE (permissions persist after renewal)"

  echo ""
  info "Verifying turnserver can now read the private key..."
  if sudo -u turnserver test -r "$KEY_PATH" 2>/dev/null; then
    pass "turnserver user CAN read privkey.pem ✓"
  else
    warn "turnserver user still cannot read privkey.pem — checking archive dir..."
    ARCHIVE_KEY="${KEY_PATH/live/archive}"
    ARCHIVE_KEY=$(ls -t "/etc/letsencrypt/archive/$(basename "$LIVE_DIR_ACTUAL")"/privkey*.pem 2>/dev/null | head -1 || true)
    if [[ -n "$ARCHIVE_KEY" ]]; then
      chown root:turnserver "$ARCHIVE_KEY" 2>/dev/null
      chmod 640 "$ARCHIVE_KEY" 2>/dev/null
      fixed "Fixed archive key permissions: $ARCHIVE_KEY"
      # Fix all archive keys
      ARCHIVE_DIR="/etc/letsencrypt/archive/$(basename "$LIVE_DIR_ACTUAL")"
      if [[ -d "$ARCHIVE_DIR" ]]; then
        chmod 750 "$ARCHIVE_DIR"
        chown root:turnserver "$ARCHIVE_DIR"/privkey*.pem 2>/dev/null && chmod 640 "$ARCHIVE_DIR"/privkey*.pem 2>/dev/null || true
        chown root:turnserver "$ARCHIVE_DIR"/fullchain*.pem 2>/dev/null && chmod 644 "$ARCHIVE_DIR"/fullchain*.pem 2>/dev/null || true
        fixed "Fixed archive directory permissions: $ARCHIVE_DIR"
      fi
    fi
  fi
else
  warn "Cert files not found — skipping permission fix"
fi

# ── 5. Ensure runtime directories exist ──────────────────────────────────────
step "5. Ensure coturn runtime directories"

mkdir -p /var/log/coturn
chown -R turnserver:turnserver /var/log/coturn 2>/dev/null || true
pass "/var/log/coturn exists"

mkdir -p /run/coturn
chown turnserver:turnserver /run/coturn 2>/dev/null || true
pass "/run/coturn exists"

# ── 6. UFW firewall rules ─────────────────────────────────────────────────────
step "6. UFW firewall rules"

echo ""
if command -v ufw &>/dev/null; then
  echo "  Current UFW rules (relevant ports):"
  echo "  ─────────────────────────────────────────────────────"
  ufw status | grep -E '5349|3478|49152' | sed 's/^/  /' || echo "  (none found)"
  echo "  ─────────────────────────────────────────────────────"
  echo ""

  # Check if 5349/tcp is allowed
  if ufw status | grep -q '5349/tcp.*ALLOW'; then
    pass "UFW: 5349/tcp is allowed"
  else
    warn "UFW: 5349/tcp not found — adding rule..."
    ufw allow 5349/tcp comment "TURNS/TLS" 2>/dev/null
    fixed "UFW: Allowed 5349/tcp"
  fi

  if ufw status | grep -q '5349/udp.*ALLOW'; then
    pass "UFW: 5349/udp is allowed"
  else
    ufw allow 5349/udp comment "TURNS/DTLS" 2>/dev/null
    fixed "UFW: Allowed 5349/udp"
  fi

  if ufw status | grep -q '3478/tcp.*ALLOW'; then
    pass "UFW: 3478/tcp is allowed"
  else
    ufw allow 3478/tcp comment "TURN TCP" 2>/dev/null
    fixed "UFW: Allowed 3478/tcp"
  fi

  if ufw status | grep -q '3478/udp.*ALLOW'; then
    pass "UFW: 3478/udp is allowed"
  else
    ufw allow 3478/udp comment "TURN UDP" 2>/dev/null
    fixed "UFW: Allowed 3478/udp"
  fi

  if ufw status | grep -qE '49152.*ALLOW'; then
    pass "UFW: 49152:65535/udp relay range is allowed"
  else
    ufw allow 49152:65535/udp comment "TURN relay range" 2>/dev/null
    fixed "UFW: Allowed 49152:65535/udp relay range"
  fi
else
  warn "UFW not installed — checking iptables..."
  if iptables -L INPUT -n 2>/dev/null | grep -q 'dpt:5349'; then
    pass "iptables: port 5349 has a rule"
  else
    warn "iptables: port 5349 may not be allowed. Add rule manually:"
    echo "    sudo iptables -A INPUT -p tcp --dport 5349 -j ACCEPT"
    echo "    sudo iptables -A INPUT -p udp --dport 5349 -j ACCEPT"
  fi
fi

# ── 7. Oracle Cloud VCN Security List reminder ───────────────────────────────
step "7. Oracle Cloud VCN Security List (CLOUD FIREWALL — manual step required)"

PUBLIC_IP=$(curl -sf --max-time 5 https://ipv4.icanhazip.com 2>/dev/null \
         || curl -sf --max-time 5 https://api4.my-ip.io/ip 2>/dev/null \
         || echo "unknown")

echo ""
echo -e "  ${RED}╔═════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "  ${RED}║  ORACLE CLOUD HAS A SECOND FIREWALL LAYER — UFW ALONE IS NOT ENOUGH ║${NC}"
echo -e "  ${RED}╚═════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  This server's public IP: ${PUBLIC_IP}"
echo ""
echo "  In the Oracle Cloud Console, verify ALL of these Ingress rules exist:"
echo "  ─────────────────────────────────────────────────────────────────────"
echo "  Networking → Virtual Cloud Networks → <your VCN>"
echo "  → Security Lists → Default Security List → Ingress Rules"
echo ""
echo "    Protocol  Source CIDR    Port(s)         Status to verify"
echo "    ────────  ─────────────  ──────────────  ─────────────────"
echo "    TCP       0.0.0.0/0      3478            (already working ✓)"
echo "    UDP       0.0.0.0/0      3478            (already working ✓)"
echo -e "    ${RED}TCP       0.0.0.0/0      5349            ← ADD THIS if missing${NC}"
echo "    UDP       0.0.0.0/0      5349            (optional DTLS)"
echo "    UDP       0.0.0.0/0      49152-65535     TURN relay range"
echo ""
echo "  Since port 3478 works from the internet but 5349 does not, and"
echo "  coturn IS listening locally — the Oracle VCN Security List is the"
echo "  most likely cause of this failure."
echo ""

# ── 8. Restart coturn ─────────────────────────────────────────────────────────
step "8. Restarting coturn"

[[ "$CONF_CHANGED" == true ]] && info "Config was modified — restart required"

systemctl daemon-reload
systemctl restart coturn
sleep 4

if systemctl is-active --quiet coturn; then
  pass "coturn is running ✓"
else
  fail "coturn failed to start"
  echo ""
  echo "  Last 30 lines from journalctl:"
  echo "  ─────────────────────────────────────────────────────"
  journalctl -u coturn -n 30 --no-pager | sed 's/^/  /'
  echo "  ─────────────────────────────────────────────────────"
  echo ""
  exit 1
fi

echo ""
echo "  Listening ports after restart:"
echo "  ─────────────────────────────────────────────────────"
ss -lntup 2>/dev/null | grep -E '3478|5349|turn' | sed 's/^/  /' || echo "  (no matches)"
echo "  ─────────────────────────────────────────────────────"
echo ""

PORT_5349_AFTER=$(ss -lntup 2>/dev/null | grep -c ':5349 ' || true)
if [[ "$PORT_5349_AFTER" -gt 0 ]]; then
  pass "Port 5349 is NOW listening ✓"
else
  fail "Port 5349 is still NOT listening after restart"
  echo ""
  info "Checking coturn logs for TLS errors..."
  echo "  ─────────────────────────────────────────────────────"
  journalctl -u coturn -n 50 --no-pager 2>/dev/null | grep -iE 'tls|ssl|cert|pem|5349|error|fail' | sed 's/^/  /' || \
    echo "  (no matching log lines)"
  echo "  ─────────────────────────────────────────────────────"
fi

# ── 9. Test TLS listener with openssl s_client ────────────────────────────────
step "9. TLS listener test (openssl s_client)"

echo ""
info "Testing: openssl s_client -connect ${TURN_HOST}:5349 -servername ${TURN_HOST}"
info "(5 second timeout — will show CONNECTED or connection refused)"
echo ""

TLS_OUTPUT=$(timeout 8 bash -c \
  "echo Q | openssl s_client -connect ${TURN_HOST}:5349 -servername ${TURN_HOST} 2>&1" \
  || true)

echo "  ─────────────────────────────────────────────────────"
echo "$TLS_OUTPUT" | grep -E 'CONNECTED|DONE|error|verify|subject|issuer|depth|SSL|Protocol|Cipher|errno' | \
  head -20 | sed 's/^/  /' || echo "  (no output)"
echo "  ─────────────────────────────────────────────────────"
echo ""

if echo "$TLS_OUTPUT" | grep -q "CONNECTED"; then
  pass "TLS connection to ${TURN_HOST}:5349 SUCCEEDED ✓"
  SUBJECT=$(echo "$TLS_OUTPUT" | grep 'subject=' | head -1 | sed 's/^/    /')
  EXPIRY_LINE=$(echo "$TLS_OUTPUT" | grep 'notAfter=' | head -1 | sed 's/^/    /')
  [[ -n "$SUBJECT" ]] && echo "$SUBJECT"
  [[ -n "$EXPIRY_LINE" ]] && echo "$EXPIRY_LINE"
elif echo "$TLS_OUTPUT" | grep -qE 'Connection refused|connect: No route'; then
  fail "Connection REFUSED to ${TURN_HOST}:5349"
  echo ""
  warn "Even after restart, nothing is accepting on 5349."
  warn "Check if the Oracle VCN Security List blocks port 5349 before testing"
  warn "again from outside. Locally, run:"
  echo "    openssl s_client -connect 127.0.0.1:5349 -servername ${TURN_HOST}"
  echo ""
  info "Local loopback test:"
  LOCAL_TLS=$(timeout 8 bash -c \
    "echo Q | openssl s_client -connect 127.0.0.1:5349 -servername ${TURN_HOST} 2>&1" \
    || true)
  if echo "$LOCAL_TLS" | grep -q "CONNECTED"; then
    pass "TLS works on localhost:5349 ✓ — port is blocked by Oracle VCN or a firewall"
    warn "→ Add TCP 5349 to Oracle VCN Security List Ingress Rules (see step 7)"
  else
    fail "TLS does NOT work on localhost:5349 — coturn TLS is not binding"
    echo "$LOCAL_TLS" | grep -E 'error|fail|refuse' | head -10 | sed 's/^/    /'
  fi
elif echo "$TLS_OUTPUT" | grep -q "errno=0"; then
  warn "Connection timed out — likely blocked by Oracle VCN Security List"
  warn "→ Add TCP 5349 to Oracle VCN Security List Ingress Rules (see step 7)"
else
  warn "Could not determine TLS status — check output above"
fi

# ── 10. Coturn service status ──────────────────────────────────────────────────
step "10. Coturn service status"

echo ""
systemctl status coturn --no-pager | head -20 | sed 's/^/  /'
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLD}╔══════════════════════════════════════════════════════════════╗${NC}"
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "${GRN}║  All checks passed. TURNS/TLS should now be working.         ║${NC}"
else
  echo -e "${YLW}║  Script completed with $FAILURES issue(s). Review output above.     ║${NC}"
fi
echo -e "${BLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYN}Verify end-to-end:${NC}"
echo "    curl -sf https://rtc.praww.co.za/api/healthz/turn | python3 -m json.tool"
echo ""
echo -e "  ${CYN}Monitor coturn logs:${NC}"
echo "    journalctl -u coturn -f"
echo "    tail -f /var/log/coturn/turnserver.log"
echo ""
echo -e "  ${CYN}If port 5349 is locally bound but unreachable from outside:${NC}"
echo -e "  ${RED}→ The Oracle VCN Security List is blocking it (cloud-level firewall).${NC}"
echo "    Go to: Oracle Cloud Console → Networking → VCN → Security Lists"
echo "    Add Ingress Rule: Protocol TCP, Source 0.0.0.0/0, Destination Port 5349"
echo ""
