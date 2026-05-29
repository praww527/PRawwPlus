#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# FreeSWITCH Bug Fix Script
# Run on the VPS as root:  sudo bash deploy/fix-freeswitch-bugs.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "=== Bug 3: Fix internal.xml ws-binding to 0.0.0.0:5066 ==="
INTERNAL=/etc/freeswitch/sip_profiles/internal.xml
if [ -f "$INTERNAL" ]; then
  sed -i 's|<param name="ws-binding" value="[^"]*"/>|<param name="ws-binding" value="0.0.0.0:5066"/>|g' "$INTERNAL"
  echo "internal.xml patched:"
  grep "ws-binding" "$INTERNAL" || echo "(no ws-binding line found)"
else
  echo "ERROR: $INTERNAL not found"
fi

echo ""
echo "=== Bug 2: Fix prawwplus_mobile.xml ws-binding to 0.0.0.0:5066 ==="
MOBILE=/etc/freeswitch/sip_profiles/prawwplus_mobile.xml
if [ -f "$MOBILE" ]; then
  sed -i 's|<param name="ws-binding" value="[^"]*"/>|<param name="ws-binding" value="0.0.0.0:5066"/>|g' "$MOBILE"
  echo "prawwplus_mobile.xml patched:"
  grep "ws-binding\|bind-port" "$MOBILE" || echo "(no matching lines)"
else
  echo "prawwplus_mobile.xml not found — skipping"
fi

echo ""
echo "=== Reloading mod_sofia ==="
fs_cli -x "reload mod_sofia" && echo "mod_sofia reloaded OK" || echo "WARNING: fs_cli failed — reload manually"

echo ""
echo "=== Verifying SIP profiles ==="
fs_cli -x "sofia status" 2>/dev/null | grep -E "(RUNNING|profile|port)" || echo "Cannot verify — check manually"

echo ""
echo "=== Done! ==="
