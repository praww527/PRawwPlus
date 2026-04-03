#!/usr/bin/env bash
# deploy/freeswitch.sh
# Install FreeSWITCH 1.10 on Oracle Ubuntu 22.04 (jammy) AMD64.
# Run as root or a user with sudo access.
# Usage: sudo bash deploy/freeswitch.sh YOUR_SIGNALWIRE_TOKEN
#
# Get your free SignalWire token at: https://id.signalwire.com/
# (sign up → Personal Access Token — it's free for FreeSWITCH package access)
set -euo pipefail

SIGNALWIRE_TOKEN="${1:-}"
if [ -z "$SIGNALWIRE_TOKEN" ]; then
  echo "ERROR: Pass your SignalWire token as the first argument."
  echo "  sudo bash deploy/freeswitch.sh YOUR_TOKEN"
  echo "  Get a free token at: https://id.signalwire.com/"
  exit 1
fi

CODENAME="$(lsb_release -cs)"  # jammy, focal, etc.

echo "===== [1/5] Install prerequisites ====="
sudo apt-get update -y
sudo apt-get install -y gnupg2 wget curl lsb-release apt-transport-https ca-certificates

echo "===== [2/5] Add SignalWire FreeSWITCH repository ====="
# GPG key
sudo wget -q -O /usr/share/keyrings/signalwire-freeswitch-repo.gpg \
  "https://freeswitch.signalwire.com/repo/deb/ubuntu-release/${CODENAME}/signalwire-freeswitch-repo.gpg"

# Credentials
echo "machine freeswitch.signalwire.com login signalwire password ${SIGNALWIRE_TOKEN}" \
  | sudo tee /etc/apt/auth.conf > /dev/null
sudo chmod 600 /etc/apt/auth.conf

# Sources list
echo "deb [signed-by=/usr/share/keyrings/signalwire-freeswitch-repo.gpg] \
https://freeswitch.signalwire.com/repo/deb/ubuntu-release/ ${CODENAME} main" \
  | sudo tee /etc/apt/sources.list.d/freeswitch.list > /dev/null

sudo apt-get update -y

echo "===== [3/7] Install FreeSWITCH core + all audio modules ====="
# freeswitch-meta-all installs the core + most modules.
# We also explicitly install the WebRTC audio-critical modules:
#   mod_opus     — Opus codec (REQUIRED for Chrome/Firefox/Safari WebRTC audio)
#   mod_verto    — WebRTC browser support via JSON-RPC over WebSocket
#   mod_sofia    — SIP stack (mobile JsSIP clients)
#   mod_voicemail — Voicemail storage and retrieval
#   mod_flite    — TTS engine (announcements, voicemail prompts)
#   mod_say_en   — English speech synthesis support
#   mod_event_socket — ESL control for API server
#   mod_xml_curl — Dynamic XML directory (users from our API)
#   mod_dptools  — Call control (bridge, answer, hangup)
#   mod_loopback — Internal call routing
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  freeswitch-meta-all \
  freeswitch-mod-opus \
  freeswitch-mod-flite \
  freeswitch-mod-say-en \
  freeswitch-mod-verto \
  freeswitch-mod-sofia \
  freeswitch-mod-voicemail \
  freeswitch-mod-event-socket \
  freeswitch-mod-xml-curl \
  freeswitch-mod-dptools \
  freeswitch-mod-commands \
  freeswitch-mod-loopback

echo "===== [4/7] Enable required modules in modules.conf.xml ====="
FS_MODS_CONF="/etc/freeswitch/autoload_configs/modules.conf.xml"
if [ -f "$FS_MODS_CONF" ]; then
  for MOD in mod_opus mod_verto mod_sofia mod_voicemail mod_flite mod_event_socket mod_xml_curl mod_dptools mod_commands mod_loopback; do
    if ! grep -q "<load module=\"${MOD}\"" "$FS_MODS_CONF"; then
      sudo sed -i "s|</modules>|  <load module=\"${MOD}\"/>\n</modules>|" "$FS_MODS_CONF"
      echo "  Enabled ${MOD} in modules.conf.xml"
    fi
  done
fi

echo "===== [5/7] Check ESL default password ====="
ESL_CONF="/etc/freeswitch/autoload_configs/event_socket.conf.xml"
if grep -q "ClueCon" "$ESL_CONF" 2>/dev/null; then
  echo "WARNING: ESL password is still the default 'ClueCon'."
  echo "  Set a strong FREESWITCH_ESL_PASSWORD in .env — the API server pushes"
  echo "  a new event_socket.conf.xml via SSH on startup."
fi

echo "===== [6/7] Enable and start FreeSWITCH service ====="
sudo systemctl enable freeswitch
sudo systemctl start freeswitch
sleep 5
sudo systemctl status freeswitch --no-pager

echo "===== [7/7] Verify FreeSWITCH + Opus codec ====="
sudo fs_cli -x "status" || echo "WARNING: fs_cli not ready yet — FreeSWITCH may still be starting"
echo ""
echo "Checking Opus codec support (required for WebRTC audio)..."
sudo fs_cli -x "show codec" 2>/dev/null | grep -i opus || echo "  mod_opus not yet loaded — check modules.conf.xml"

echo ""
echo "===== FreeSWITCH installation complete ====="
echo ""
echo "Config directory:  /etc/freeswitch"
echo "Log directory:     /var/log/freeswitch"
echo "Storage directory: /usr/local/freeswitch/storage  (voicemail)"
echo ""
echo "IMPORTANT — Next steps:"
echo "  1. Set in your .env:"
echo "     FREESWITCH_DOMAIN=<your VPS public IP>"
echo "     FREESWITCH_ESL_HOST=127.0.0.1"
echo "     FREESWITCH_ESL_PORT=8021"
echo "     FREESWITCH_ESL_PASSWORD=<strong password — change from default ClueCon>"
echo "     FREESWITCH_SSH_USER=root"
echo "     FREESWITCH_SSH_KEY=<private key contents>"
echo "     FREESWITCH_CONF_DIR=/etc/freeswitch"
echo "     FREESWITCH_STORAGE_DIR=/usr/local/freeswitch/storage"
echo ""
echo "  2. Open Oracle Cloud firewall: UDP 16384-32768 (RTP media — required for audio)"
echo ""
echo "  3. Start PRaww+ API: pm2 start ecosystem.config.cjs"
echo "     The server auto-pushes FreeSWITCH config on startup."
echo ""
echo "  4. Verify: pm2 logs prawwplus | grep FSH"
echo "  5. Test audio: sudo fs_cli -x \"show codec\" | grep opus"
