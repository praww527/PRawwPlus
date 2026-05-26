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
# Key may be stored as raw PEM or as base64-encoded PEM.
# Try base64 decode first; if it yields a valid PEM header, use it.
# Otherwise write the secret directly as-is (already PEM).
DECODED="$(echo "${FREESWITCH_SSH_KEY}" | base64 -d 2>/dev/null || true)"
if echo "$DECODED" | grep -q "BEGIN"; then
  printf '%s\n' "$DECODED" > "$KEY_FILE"
else
  printf '%s\n' "${FREESWITCH_SSH_KEY}" > "$KEY_FILE"
fi
chmod 600 "$KEY_FILE"

cleanup() { rm -f "$KEY_FILE"; }
trap cleanup EXIT

# ── 3. SSH to VPS and run deploy script ───────────────────────────────────────
echo "===== [3/3] Deploying to ${VPS_HOST} ====="
ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=30 \
    "${VPS_USER}@${VPS_HOST}" \
    "cd ${VPS_DIR} && bash deploy/update.sh"

echo ""
echo "✓ Deploy complete — https://rtc.praww.co.za"
