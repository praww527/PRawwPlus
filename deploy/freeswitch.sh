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

echo "===== [3/5] Install FreeSWITCH ====="
# freeswitch-meta-all installs the core + most common modules including:
#   mod_verto, mod_sofia, mod_xml_curl, mod_voicemail,
#   mod_flite (TTS), mod_event_socket, mod_commands, mod_dptools
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  freeswitch-meta-all \
  freeswitch-mod-flite \
  freeswitch-mod-say-en

echo "===== [4/5] Enable and start FreeSWITCH service ====="
sudo systemctl enable freeswitch
sudo systemctl start freeswitch
sleep 3
sudo systemctl status freeswitch --no-pager

echo "===== [5/5] Verify fs_cli works ====="
sudo fs_cli -x "status" || echo "WARNING: fs_cli not ready yet — FreeSWITCH may still be starting"

echo ""
echo "===== FreeSWITCH installation complete ====="
echo ""
echo "Config directory:  /etc/freeswitch"
echo "Log directory:     /var/log/freeswitch"
echo "Storage directory: /usr/local/freeswitch/storage  (voicemail recordings)"
echo ""
echo "Next steps:"
echo "  1. Ensure your .env on the server has:"
echo "     FREESWITCH_DOMAIN=<your VPS public IP>"
echo "     FREESWITCH_ESL_HOST=127.0.0.1"
echo "     FREESWITCH_ESL_PASSWORD=ClueCon"
echo "     FREESWITCH_SSH_USER=root"
echo "     FREESWITCH_SSH_KEY=<contents of /root/.ssh/id_rsa>"
echo "     FREESWITCH_CONF_DIR=/etc/freeswitch"
echo "  2. Start the PRaww+ API server — it will auto-push FreeSWITCH config on startup."
echo "  3. Verify config was pushed: pm2 logs prawwplus | grep FSH"
