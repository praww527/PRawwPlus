#!/usr/bin/env bash
# deploy/update.sh
# Pull latest code, reinstall, rebuild, and restart the API service.
# Saves a release snapshot before each build so deploy/rollback.sh can
# restore a previous working version if the new build breaks production.
#
# Platform: Oracle Ubuntu 22.04 LTS — ARM64 (Ampere A1) or AMD64
#
# Usage (run directly on the VPS as the ubuntu user):
#   ssh ubuntu@YOUR_DOMAIN
#   cd /home/ubuntu/PRawwPlus
#   bash deploy/update.sh
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/PRawwPlus}"
UBUNTU_USER="${SUDO_USER:-ubuntu}"
RELEASES_DIR="${DEPLOY_DIR}/.releases"
MAX_RELEASES=5

echo "===== [1/8] Pull latest code ====="
git -C "$DEPLOY_DIR" pull

echo "===== [2/8] Fix ownership (node_modules) ====="
# Some previous sudo/root pnpm runs can leave files owned by root.
# Re-own the entire project directory so the ubuntu user can write freely.
sudo chown -R "${UBUNTU_USER}:${UBUNTU_USER}" "$DEPLOY_DIR" 2>/dev/null || true

echo "===== [3/8] Snapshot current build (for rollback) ====="
mkdir -p "$RELEASES_DIR"

API_DIST="${DEPLOY_DIR}/artifacts/api-server/dist"
FE_DIST="${DEPLOY_DIR}/artifacts/prawwplus/dist"
SNAPSHOT_TS="$(date '+%Y%m%d_%H%M%S')"
SNAPSHOT_DIR="${RELEASES_DIR}/${SNAPSHOT_TS}"

if [ -d "$API_DIST" ] || [ -d "$FE_DIST" ]; then
  mkdir -p "$SNAPSHOT_DIR"

  [ -d "$API_DIST" ] && cp -r "$API_DIST"  "$SNAPSHOT_DIR/api-dist"
  [ -d "$FE_DIST"  ] && cp -r "$FE_DIST"   "$SNAPSHOT_DIR/frontend-dist"

  git -C "$DEPLOY_DIR" rev-parse HEAD        > "$SNAPSHOT_DIR/git-sha"   2>/dev/null || echo "unknown" > "$SNAPSHOT_DIR/git-sha"
  git -C "$DEPLOY_DIR" log -1 --oneline      > "$SNAPSHOT_DIR/git-log"   2>/dev/null || echo "unknown" > "$SNAPSHOT_DIR/git-log"
  echo "$SNAPSHOT_TS"                        > "$SNAPSHOT_DIR/deployed-at"

  echo "  Snapshot saved → ${SNAPSHOT_DIR}"
  echo "  Git: $(cat "$SNAPSHOT_DIR/git-log")"
else
  echo "  No existing build found — skipping snapshot (first deploy)"
fi

# Prune old snapshots — keep only the most recent MAX_RELEASES
SNAPSHOT_COUNT=$(ls -1 "$RELEASES_DIR" | wc -l)
if [ "$SNAPSHOT_COUNT" -gt "$MAX_RELEASES" ]; then
  EXCESS=$(( SNAPSHOT_COUNT - MAX_RELEASES ))
  echo "  Pruning $EXCESS old snapshot(s) (keeping last ${MAX_RELEASES})…"
  ls -1 "$RELEASES_DIR" | sort | head -n "$EXCESS" | while read -r OLD; do
    rm -rf "${RELEASES_DIR:?}/${OLD}"
    echo "  Removed old snapshot: $OLD"
  done
fi

echo "===== [4/8] Remove stale old services and config ====="
# Stop and remove any leftover call-manager / old PRawwPlus services
for SVC in call-manager call-manager-api call-manager-mobile call_manager callmanager; do
    if systemctl list-units --full -all 2>/dev/null | grep -q "${SVC}.service"; then
        echo "  Removing old service: ${SVC}"
        sudo systemctl stop    "${SVC}" 2>/dev/null || true
        sudo systemctl disable "${SVC}" 2>/dev/null || true
        sudo rm -f "/etc/systemd/system/${SVC}.service" \
                   "/lib/systemd/system/${SVC}.service"
    fi
done
# Remove old nginx sites that are no longer used
for SITE in call-manager call_manager callmanager; do
    sudo rm -f "/etc/nginx/sites-enabled/${SITE}" \
               "/etc/nginx/sites-available/${SITE}" 2>/dev/null || true
done
sudo systemctl daemon-reload

echo "===== [5/8] Install / update dependencies ====="
cd "$DEPLOY_DIR"
pnpm install --frozen-lockfile 2>/dev/null \
  || pnpm install --no-frozen-lockfile

echo "===== [6/8] Build shared library packages ====="
pnpm --filter @workspace/db \
     --filter @workspace/api-zod \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

echo "===== [7/8] Build frontend (Vite) + backend (esbuild) ====="
pnpm --filter @workspace/prawwplus run build
pnpm --filter @workspace/api-server run build

echo "===== [8/8] Restart systemd service ====="
mkdir -p logs
# Re-copy the service file in case it changed
sudo cp deploy/prawwplus-api.service /etc/systemd/system/prawwplus-api.service
sudo systemctl daemon-reload
sudo systemctl enable prawwplus-api
sudo systemctl restart prawwplus-api

echo ""
echo "===== [+] Auto-push FreeSWITCH config ====="
# Wait for the API server to finish initialising (ESL auth takes ~3 s)
sleep 12
# Use the standalone push script — reads env vars from .env via dotenv, connects
# to FreeSWITCH via SSH, and writes all XML config files + issues a reload.
# Failures here are non-fatal: the admin can re-trigger from the admin panel.
if command -v pnpm >/dev/null 2>&1; then
  set -a; [ -f "$DEPLOY_DIR/.env" ] && source "$DEPLOY_DIR/.env"; set +a
  cd "$DEPLOY_DIR"
  pnpm tsx artifacts/api-server/fs_push_script.ts 2>&1 \
    && echo "  FreeSWITCH config pushed successfully" \
    || echo "  FreeSWITCH config push failed — trigger it from Admin → FreeSWITCH → Push Config"
else
  echo "  pnpm not found — skipping auto FS push. Trigger it from Admin → FreeSWITCH → Push Config"
fi

echo ""
echo "===== Update complete ====="
echo "  Status:  sudo systemctl status prawwplus-api"
echo "  Logs:    sudo journalctl -u prawwplus-api -n 200 --no-pager"
echo "  Follow:  sudo journalctl -u prawwplus-api -f"
echo ""
echo "  Verify an unverified user (if needed):"
echo "    pnpm tsx scripts/verify-user.ts --list"
echo "    pnpm tsx scripts/verify-user.ts user@example.com"
echo ""
echo "  After deploy: trigger a FULL FreeSWITCH config push from"
echo "    https://rtc.praww.co.za → Admin → FreeSWITCH → Push Config"
echo "  This reloads mod_verto and the SIP profile with updated settings."
echo ""
echo "  Bootstrap first admin (only needed on a fresh DB — self-locks after first admin):"
echo "    curl -s -X POST https://rtc.praww.co.za/api/admin/setup \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"email\":\"admin@praww.co.za\",\"password\":\"YourStr0ngP@ss\",\"name\":\"Admin\"}'"
echo ""
echo "  Roll back if something looks wrong:"
echo "    bash $DEPLOY_DIR/deploy/rollback.sh"
echo ""
echo "  Run diagnostics to verify the full stack is healthy:"
echo "    bash $DEPLOY_DIR/deploy/diagnose.sh"
