#!/usr/bin/env bash
# deploy/rollback.sh
# Restore a previous release snapshot and restart the API service.
# Snapshots are created automatically by deploy/update.sh before each build.
#
# Platform: Oracle Ubuntu 22.04 LTS — ARM64 (Ampere A1) or AMD64
#
# Usage:
#   bash deploy/rollback.sh              # interactive — lists snapshots, asks which to restore
#   bash deploy/rollback.sh --latest     # non-interactive — restore the most recent snapshot
#   bash deploy/rollback.sh 20250524_143000  # restore a specific snapshot by timestamp
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/PRawwPlus}"
RELEASES_DIR="${DEPLOY_DIR}/.releases"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
BLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GRN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YLW}!${NC} $*"; }
hr()   { echo "──────────────────────────────────────────────────────────────"; }

echo ""
echo -e "${BLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLD}║              PRaww+ Rollback — $(date '+%Y-%m-%d %H:%M')             ║${NC}"
echo -e "${BLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [ ! -d "$RELEASES_DIR" ]; then
  fail "No releases directory found at ${RELEASES_DIR}"
  echo "     Run bash deploy/update.sh at least once to create a snapshot."
  exit 1
fi

SNAPSHOTS=()
while IFS= read -r -d '' DIR; do
  SNAPSHOTS+=("$(basename "$DIR")")
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

if [ "${#SNAPSHOTS[@]}" -eq 0 ]; then
  fail "No snapshots found in ${RELEASES_DIR}"
  echo "     Run bash deploy/update.sh at least once to create a snapshot."
  exit 1
fi

# ── Select snapshot ────────────────────────────────────────────────────────────
TARGET=""

if [ "${1:-}" = "--latest" ]; then
  TARGET="${SNAPSHOTS[-1]}"
  echo "  Using latest snapshot: ${TARGET}"
elif [ -n "${1:-}" ]; then
  # Specific timestamp passed as argument
  if [ -d "${RELEASES_DIR}/${1}" ]; then
    TARGET="$1"
    echo "  Using specified snapshot: ${TARGET}"
  else
    fail "Snapshot not found: ${1}"
    echo "     Available snapshots:"
    for S in "${SNAPSHOTS[@]}"; do
      echo "       $S"
    done
    exit 1
  fi
else
  # Interactive selection
  hr
  echo "Available snapshots (newest last):"
  echo ""
  IDX=1
  for S in "${SNAPSHOTS[@]}"; do
    SHA=""
    LOG=""
    DAT=""
    [ -f "${RELEASES_DIR}/${S}/git-sha" ]     && SHA="$(cat "${RELEASES_DIR}/${S}/git-sha" | cut -c1-8)"
    [ -f "${RELEASES_DIR}/${S}/git-log" ]     && LOG="$(cat "${RELEASES_DIR}/${S}/git-log")"
    [ -f "${RELEASES_DIR}/${S}/deployed-at" ] && DAT="$(cat "${RELEASES_DIR}/${S}/deployed-at")"

    MARKER=""
    [ "$IDX" -eq "${#SNAPSHOTS[@]}" ] && MARKER=" ${YLW}← most recent${NC}"
    echo -e "  [${IDX}]  ${BLD}${S}${NC}  git:${SHA:-unknown}  ${LOG:-no commit info}${MARKER}"
    IDX=$(( IDX + 1 ))
  done

  echo ""
  echo -e "  [0]  ${RED}Cancel${NC}"
  echo ""
  read -r -p "  Enter number to restore (default=1 for oldest / most stable): " CHOICE
  CHOICE="${CHOICE:-1}"

  if [ "$CHOICE" = "0" ]; then
    echo "  Rollback cancelled."
    exit 0
  fi

  if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt "${#SNAPSHOTS[@]}" ]; then
    fail "Invalid selection: ${CHOICE}"
    exit 1
  fi

  TARGET="${SNAPSHOTS[$(( CHOICE - 1 ))]}"
fi

SNAPSHOT_PATH="${RELEASES_DIR}/${TARGET}"

hr
echo ""
echo -e "  ${BLD}Restoring snapshot:${NC} ${TARGET}"
[ -f "${SNAPSHOT_PATH}/git-log" ] && echo "  Commit: $(cat "${SNAPSHOT_PATH}/git-log")"
[ -f "${SNAPSHOT_PATH}/git-sha" ] && echo "  SHA:    $(cat "${SNAPSHOT_PATH}/git-sha")"
echo ""

# ── Confirm ────────────────────────────────────────────────────────────────────
if [ "${1:-}" != "--latest" ] && [ -z "${AUTO_CONFIRM:-}" ]; then
  read -r -p "  Restore this snapshot and restart the service? [y/N] " CONFIRM
  CONFIRM="${CONFIRM:-n}"
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "  Rollback cancelled."
    exit 0
  fi
fi

# ── Save current build as emergency snapshot before overwriting ───────────────
hr
echo "===== [1/3] Snapshot current (broken) build before overwriting ====="
EMERGENCY_TS="rollback_$(date '+%Y%m%d_%H%M%S')"
EMERGENCY_DIR="${RELEASES_DIR}/${EMERGENCY_TS}"
mkdir -p "$EMERGENCY_DIR"

API_DIST="${DEPLOY_DIR}/artifacts/api-server/dist"
FE_DIST="${DEPLOY_DIR}/artifacts/prawwplus/dist"

[ -d "$API_DIST" ] && cp -r "$API_DIST" "$EMERGENCY_DIR/api-dist"
[ -d "$FE_DIST"  ] && cp -r "$FE_DIST"  "$EMERGENCY_DIR/frontend-dist"
git -C "$DEPLOY_DIR" rev-parse HEAD   > "$EMERGENCY_DIR/git-sha"   2>/dev/null || echo "unknown" > "$EMERGENCY_DIR/git-sha"
git -C "$DEPLOY_DIR" log -1 --oneline > "$EMERGENCY_DIR/git-log"   2>/dev/null || echo "unknown" > "$EMERGENCY_DIR/git-log"
echo "$EMERGENCY_TS"                  > "$EMERGENCY_DIR/deployed-at"
echo "  Emergency snapshot saved → ${EMERGENCY_DIR}"

# ── Restore ────────────────────────────────────────────────────────────────────
echo "===== [2/3] Restore build artifacts ====="

if [ -d "${SNAPSHOT_PATH}/api-dist" ]; then
  rm -rf "$API_DIST"
  cp -r "${SNAPSHOT_PATH}/api-dist" "$API_DIST"
  ok "API bundle restored"
else
  warn "No api-dist in snapshot — API bundle not restored"
fi

if [ -d "${SNAPSHOT_PATH}/frontend-dist" ]; then
  rm -rf "$FE_DIST"
  cp -r "${SNAPSHOT_PATH}/frontend-dist" "$FE_DIST"
  ok "Frontend build restored"
else
  warn "No frontend-dist in snapshot — frontend not restored"
fi

# ── Restart service ────────────────────────────────────────────────────────────
echo "===== [3/3] Restart systemd service ====="
sudo systemctl restart prawwplus-api
sleep 2

if systemctl is-active --quiet prawwplus-api 2>/dev/null; then
  ok "prawwplus-api is running"
else
  fail "prawwplus-api failed to start — check logs:"
  echo "     sudo journalctl -u prawwplus-api -n 50 --no-pager"
  exit 1
fi

hr
echo ""
echo -e "${GRN}${BLD}===== Rollback complete =====${NC}"
echo ""
echo "  Restored:   ${TARGET}"
[ -f "${SNAPSHOT_PATH}/git-log" ] && echo "  Commit:     $(cat "${SNAPSHOT_PATH}/git-log")"
echo ""
echo "  The broken build was saved to:"
echo "    ${EMERGENCY_DIR}"
echo "  (so you can diff or investigate without losing it)"
echo ""
echo "  Verify the service is healthy:"
echo "    sudo journalctl -u prawwplus-api -n 50 --no-pager"
echo "    curl -s http://127.0.0.1:8080/api/healthz"
echo "    bash ${DEPLOY_DIR}/deploy/diagnose.sh"
echo ""
echo "  To fix the broken build and re-deploy:"
echo "    bash ${DEPLOY_DIR}/deploy/update.sh"
echo ""
