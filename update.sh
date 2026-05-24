#!/usr/bin/env bash
# PRaww+ — full update script
# Usage (Oracle VPS):  bash update.sh [branch]
# Usage (Replit):      bash update.sh --local     (skip git pull, just rebuild)
#
# Environment variables:
#   SERVICE_NAME   systemd unit name  (default: prawwplus)
#   APP_DIR        repo root          (default: directory of this script)

set -euo pipefail

BRANCH="${1:-master}"
LOCAL_ONLY=false
if [[ "${1:-}" == "--local" ]]; then LOCAL_ONLY=true; fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${SERVICE_NAME:-prawwplus}"

log() { echo "[update] $*"; }
err() { echo "[update] ERROR: $*" >&2; exit 1; }

# ── 1. Pull latest code ───────────────────────────────────────────────────────
if [[ "$LOCAL_ONLY" == false ]]; then
  log "Fetching origin/$BRANCH ..."
  git -C "$APP_DIR" fetch origin
  log "Resetting to origin/$BRANCH ..."
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
  log "Code is now at: $(git -C "$APP_DIR" log --oneline -1)"
fi

# ── 2. Install / update dependencies ─────────────────────────────────────────
log "Installing dependencies (pnpm)..."
cd "$APP_DIR"
pnpm install --frozen-lockfile

# ── 3. Build shared libraries ─────────────────────────────────────────────────
log "Building shared libraries..."
pnpm --filter './lib/**' run build

# ── 4. Build React frontend ───────────────────────────────────────────────────
log "Building frontend (Vite)..."
pnpm --filter @workspace/prawwplus run build

# ── 5. Restart process manager ───────────────────────────────────────────────
if [[ "$LOCAL_ONLY" == true ]]; then
  log "Local mode — skipping process-manager restart (use the Replit workflow)."
elif command -v systemctl &>/dev/null && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  log "Restarting systemd service '$SERVICE_NAME'..."
  sudo systemctl restart "$SERVICE_NAME"
  sleep 2
  systemctl is-active --quiet "$SERVICE_NAME" && log "Service is running." \
    || err "Service failed to start — check: journalctl -u $SERVICE_NAME -n 50"
elif command -v pm2 &>/dev/null; then
  log "Restarting via pm2 ($SERVICE_NAME)..."
  if pm2 list | grep -q "$SERVICE_NAME"; then
    pm2 restart "$SERVICE_NAME"
  else
    pm2 start bash --name "$SERVICE_NAME" -- -c \
      "NODE_ENV=production PORT=5000 pnpm --filter @workspace/api-server run start"
  fi
  pm2 save
  log "pm2 reports: $(pm2 list | grep "$SERVICE_NAME" | awk '{print $10}')"
else
  log "WARNING: No systemd service or pm2 found."
  log "Start the server manually with:"
  log "  NODE_ENV=production PORT=5000 pnpm --filter @workspace/api-server run start"
fi

log "=== PRaww+ update complete ==="
git -C "$APP_DIR" log --oneline -1
