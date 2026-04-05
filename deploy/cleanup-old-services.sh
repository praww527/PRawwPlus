#!/usr/bin/env bash
# deploy/cleanup-old-services.sh
#
# Removes old "call-manager" and "call-manager-mobile" systemd services
# and any stale nginx configs that conflict with PRaww+.
#
# Run this ONCE on the Oracle VPS before deploying PRaww+ for the first time.
# Safe to run multiple times — exits cleanly if services are already gone.
#
# Usage (on the VPS):
#   bash deploy/cleanup-old-services.sh

set -euo pipefail

echo "====== PRaww+ — Cleanup old services ======"

# ── 1. Stop and disable call-manager ─────────────────────────────────────────
for SVC in call-manager call-manager-api call-manager-mobile call_manager callmanager; do
    if systemctl list-units --full -all 2>/dev/null | grep -q "${SVC}.service"; then
        echo "[1] Stopping & disabling ${SVC}..."
        sudo systemctl stop    "${SVC}" 2>/dev/null || true
        sudo systemctl disable "${SVC}" 2>/dev/null || true
        echo "    Done: ${SVC} disabled"
    else
        echo "[1] ${SVC} — not found, skipping"
    fi

    # Remove unit file if it exists
    for UNIT_DIR in /etc/systemd/system /lib/systemd/system; do
        if [ -f "${UNIT_DIR}/${SVC}.service" ]; then
            echo "    Removing ${UNIT_DIR}/${SVC}.service"
            sudo rm -f "${UNIT_DIR}/${SVC}.service"
        fi
    done
done

sudo systemctl daemon-reload

echo ""
echo "[2] Removing stale nginx site configs for call-manager..."
for SITE in call-manager call-manager-api call-manager-mobile callmanager; do
    if [ -f "/etc/nginx/sites-enabled/${SITE}" ]; then
        echo "    Removing /etc/nginx/sites-enabled/${SITE}"
        sudo rm -f "/etc/nginx/sites-enabled/${SITE}"
    fi
    if [ -f "/etc/nginx/sites-available/${SITE}" ]; then
        echo "    Removing /etc/nginx/sites-available/${SITE}"
        sudo rm -f "/etc/nginx/sites-available/${SITE}"
    fi
done

echo ""
echo "[3] Testing nginx config..."
sudo nginx -t && sudo systemctl reload nginx && echo "    Nginx reloaded OK"

echo ""
echo "[4] Checking port 3000 is now free..."
if ss -tlnp | grep ':3000 ' >/dev/null 2>&1; then
    echo "    WARNING: Something is still listening on port 3000:"
    ss -tlnp | grep ':3000 ' || true
    echo "    Find the PID and kill it before starting prawwplus-api."
else
    echo "    Port 3000 is free — safe to start prawwplus-api."
fi

echo ""
echo "====== Cleanup complete ======"
echo ""
echo "Next steps:"
echo "  1. Install/enable the PRaww+ nginx site:"
echo "     sudo ln -sf /etc/nginx/sites-available/prawwplus /etc/nginx/sites-enabled/prawwplus"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "  2. Install the PRaww+ systemd service:"
echo "     sudo cp deploy/prawwplus-api.service /etc/systemd/system/"
echo "     sudo systemctl daemon-reload"
echo "     sudo systemctl enable --now prawwplus-api"
echo ""
echo "  3. Follow the full guide: DEPLOY.md"
