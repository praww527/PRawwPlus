#!/usr/bin/env bash
# deploy/patch-pstn-env.sh
#
# Patches PSTN gateway credentials into /home/ubuntu/PRawwPlus/.env on the VPS,
# then restarts the API service so the gateway registers immediately.
#
# Required Replit secrets:
#   FREESWITCH_SSH_KEY          — SSH private key for the VPS
#   PSTN_GATEWAY_NAME
#   PSTN_GATEWAY_USERNAME
#   PSTN_GATEWAY_PASSWORD
#   PSTN_GATEWAY_PROXY
#   PSTN_GATEWAY_REALM
#   PSTN_GATEWAY_FROM_DOMAIN
#   PSTN_GATEWAY_REGISTER       (optional, defaults to true)
#   FREESWITCH_ESL_PASSWORD     (used for sofia rescan)
#
# Usage:
#   bash deploy/patch-pstn-env.sh

set -euo pipefail

VPS_USER="ubuntu"
VPS_HOST="158.180.29.84"
VPS_ENV_FILE="/home/ubuntu/PRawwPlus/.env"
ESL_PASS="${FREESWITCH_ESL_PASSWORD:-}"

# ── Validate required vars ─────────────────────────────────────────────────────
for var in FREESWITCH_SSH_KEY PSTN_GATEWAY_NAME PSTN_GATEWAY_USERNAME PSTN_GATEWAY_PASSWORD PSTN_GATEWAY_PROXY PSTN_GATEWAY_REALM PSTN_GATEWAY_FROM_DOMAIN; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set in Replit secrets"
    exit 1
  fi
done

# ── Prepare SSH key (same normalization as push-and-deploy.sh) ─────────────────
echo "===== [1/3] Setting up SSH key ====="
KEY_FILE="$(mktemp)"
trap 'rm -f "$KEY_FILE"' EXIT

normalize_key() {
  local raw="$1"
  local decoded
  decoded="$(printf '%s' "$raw" | base64 -d 2>/dev/null || true)"
  if printf '%s' "$decoded" | grep -q "BEGIN"; then
    raw="$decoded"
  fi
  local line_count
  line_count="$(printf '%s' "$raw" | wc -l)"
  if [ "$line_count" -gt 2 ]; then
    printf '%s\n' "$raw"
  else
    local header body footer
    header="$(printf '%s' "$raw" | sed 's/\(-----BEGIN [^-]*-----\).*/\1/')"
    footer="$(printf '%s' "$raw" | sed 's/.*\(-----END [^-]*-----\)/\1/')"
    body="$(printf '%s' "$raw" \
      | sed 's/-----BEGIN [^-]*----- //; s/ -----END [^-]*-----//' \
      | tr -d ' \r\n')"
    printf '%s\n%s\n%s\n' "$header" "$(printf '%s' "$body" | fold -w 70)" "$footer"
  fi
}
normalize_key "${FREESWITCH_SSH_KEY}" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

if ! ssh-keygen -y -f "$KEY_FILE" > /dev/null 2>&1; then
  echo "ERROR: FREESWITCH_SSH_KEY cannot be parsed as a valid SSH private key."
  exit 1
fi
echo "✓ SSH key validated"

# ── Build base64-encoded JSON payload using Node.js ────────────────────────────
echo "===== [2/3] Encoding PSTN payload ====="
PSTN_JSON=$(node -e "
const vars = {
  PSTN_GATEWAY_NAME:        process.env.PSTN_GATEWAY_NAME        || '',
  PSTN_GATEWAY_USERNAME:    process.env.PSTN_GATEWAY_USERNAME    || '',
  PSTN_GATEWAY_PASSWORD:    process.env.PSTN_GATEWAY_PASSWORD    || '',
  PSTN_GATEWAY_PROXY:       process.env.PSTN_GATEWAY_PROXY       || '',
  PSTN_GATEWAY_REALM:       process.env.PSTN_GATEWAY_REALM       || '',
  PSTN_GATEWAY_FROM_DOMAIN: process.env.PSTN_GATEWAY_FROM_DOMAIN || '',
  PSTN_GATEWAY_REGISTER:    process.env.PSTN_GATEWAY_REGISTER    || 'true',
};
process.stdout.write(Buffer.from(JSON.stringify(vars)).toString('base64'));
")
echo "✓ Payload encoded (${#PSTN_JSON} bytes base64)"

# ── SSH to VPS and patch .env using Node.js on the remote ─────────────────────
echo "===== [3/3] Patching .env on ${VPS_HOST} ====="

# Write the remote patcher script to a temp file, then upload and execute it
PATCHER_FILE="$(mktemp --suffix=.mjs)"
trap 'rm -f "$KEY_FILE" "$PATCHER_FILE"' EXIT

cat > "$PATCHER_FILE" << 'NODEOF'
import { readFileSync, writeFileSync, existsSync } from 'fs';
const [,, payloadB64, envFile] = process.argv;
const newVars = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
if (!existsSync(envFile)) {
  console.error(`ERROR: ${envFile} not found`);
  process.exit(1);
}
const lines = readFileSync(envFile, 'utf8').split('\n');
const keyIndex = {};
lines.forEach((line, i) => {
  const s = line.trim();
  if (s && !s.startsWith('#') && s.includes('=')) {
    const k = s.split('=')[0].trim();
    if (!(k in keyIndex)) keyIndex[k] = i;
  }
});
for (const [key, value] of Object.entries(newVars)) {
  if (!value) continue;
  const newLine = `${key}=${value}`;
  if (key in keyIndex) {
    const old = lines[keyIndex[key]];
    lines[keyIndex[key]] = newLine;
    console.log(`  Updated  : ${key}  (was: ${old.trim()})`);
  } else {
    lines.push(newLine);
    console.log(`  Appended : ${key}=${value}`);
  }
}
writeFileSync(envFile, lines.join('\n'), 'utf8');
console.log(`\n✓ ${envFile} patched (${Object.keys(newVars).length} vars)`);
NODEOF

# Upload patcher and run it
REMOTE_PATCHER="/tmp/patch-pstn-env-$$.mjs"
scp -i "$KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=30 \
    "$PATCHER_FILE" "${VPS_USER}@${VPS_HOST}:${REMOTE_PATCHER}"

ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=60 \
    "${VPS_USER}@${VPS_HOST}" \
    "node '${REMOTE_PATCHER}' '${PSTN_JSON}' '${VPS_ENV_FILE}' && rm -f '${REMOTE_PATCHER}'"

echo ""
echo "===== Restarting services ====="
ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=60 \
    "${VPS_USER}@${VPS_HOST}" \
    "
      sudo systemctl restart prawwplus-api && echo '✓ prawwplus-api restarted'
      sleep 4
      if command -v fs_cli &>/dev/null; then
        fs_cli -p '${ESL_PASS}' -x 'sofia rescan reloadxml' 2>/dev/null \
          && echo '✓ FreeSWITCH sofia rescan triggered' \
          || echo '  (fs_cli rescan skipped — will reconnect via ESL on next API start)'
      else
        echo '  fs_cli not found on PATH — gateway will register on next ESL reconnect'
      fi
    "

echo ""
echo "✓ PSTN credentials patched and services reloaded."
echo "  → Admin Dashboard → PSTN Trunk / Gateway card shows live registration state"
