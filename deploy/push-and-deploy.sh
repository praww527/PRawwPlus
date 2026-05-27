#!/usr/bin/env bash
# push-and-deploy.sh
# Push the latest commit to GitHub and trigger VPS deploy over SSH.
# Run this from the project root on the Replit shell after each release.
#
# Prerequisites:
#   GITHUB_TOKEN  — set as a Replit secret
#   FREESWITCH_SSH_KEY — set as a Replit secret (base64-encoded private key)
#
# Usage:
#   bash deploy/push-and-deploy.sh

set -euo pipefail

GITHUB_REPO="praww527/PRawwPlus"
VPS_USER="ubuntu"
# Use the real VPS public IP directly — NOT the CDN/proxy edge (216.24.57.1).
# SSH must reach the actual server; the proxy layer does not forward port 22.
VPS_HOST="158.180.29.84"
VPS_DIR="/home/ubuntu/PRawwPlus"
BRANCH="master"

# ── 1. Push to GitHub ────────────────────────────────────────────────────────
echo "===== [1/3] Pushing to GitHub ====="
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_TOKEN is not set"
  exit 1
fi

git push "https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" "${BRANCH}"
echo "✓ Pushed to github.com/${GITHUB_REPO}"

# ── 2. Prepare SSH key ────────────────────────────────────────────────────────
echo "===== [2/3] Setting up SSH key ====="
if [ -z "${FREESWITCH_SSH_KEY:-}" ]; then
  echo "ERROR: FREESWITCH_SSH_KEY secret is not set"
  exit 1
fi

KEY_FILE="$(mktemp)"
# Normalise the key — handles three storage formats:
#   1. Proper PEM (real newlines)          → use as-is
#   2. Single-line PEM (spaces not \n)     → reformat with fold
#   3. Base64-encoded PEM                  → decode first, then reformat
normalize_key() {
  local raw="$1"
  # Try base64 decode first
  local decoded
  decoded="$(printf '%s' "$raw" | base64 -d 2>/dev/null || true)"
  if printf '%s' "$decoded" | grep -q "BEGIN"; then
    raw="$decoded"
  fi
  # If the key is all on one line (header/body/footer separated by spaces),
  # split it back into proper PEM lines.
  # A properly formatted key has many lines (header + body + footer).
  # A single-line key pasted from a secret manager has 0 embedded newlines.
  local line_count
  line_count="$(printf '%s' "$raw" | wc -l)"
  if [ "$line_count" -gt 2 ]; then
    # Already has real newlines — use as-is
    printf '%s\n' "$raw"
  else
    # Single-line: "-----BEGIN X----- <base64> -----END X-----"
    # 1. Insert newline after opening header
    # 2. Insert newline before closing footer
    # 3. fold body at 70 chars
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

# Validate the key can be parsed before attempting SSH
if ! ssh-keygen -y -f "$KEY_FILE" > /dev/null 2>&1; then
  echo "ERROR: FREESWITCH_SSH_KEY cannot be parsed as a valid SSH private key."
  echo "       Please paste the full key (-----BEGIN ... through -----END ...)."
  exit 1
fi

cleanup() { rm -f "$KEY_FILE"; }
trap cleanup EXIT

# ── 3. SSH to VPS and run deploy script ───────────────────────────────────────
echo "===== [3/3] Deploying to ${VPS_HOST} ====="
ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=30 \
    "${VPS_USER}@${VPS_HOST}" \
    "cd ${VPS_DIR} && git stash 2>/dev/null || true && bash deploy/update.sh"

echo ""
echo "✓ Deploy complete — https://rtc.praww.co.za"
