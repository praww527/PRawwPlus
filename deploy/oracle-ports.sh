#!/usr/bin/env bash
# deploy/oracle-ports.sh
# Configure the OS-level firewall (UFW) on Oracle Ubuntu VPS for PRaww+.
# Run as root or with sudo.
# Usage: sudo bash deploy/oracle-ports.sh
#
# ─────────────────────────────────────────────────────────────────────────────
# IMPORTANT — Oracle Cloud has TWO firewall layers you must configure:
#
#  1. OS firewall (UFW) — this script handles it.
#  2. Oracle Cloud Console → Networking → VCN → Security Lists (or NSG).
#     You MUST also open these ports in the cloud console or traffic will be
#     blocked before it even reaches the VM.
#
# Oracle Cloud Console rules to add (Ingress rules):
#   Protocol  Source CIDR    Port(s)         Purpose
#   TCP       0.0.0.0/0      22              SSH
#   TCP       0.0.0.0/0      80              HTTP (nginx → HTTPS redirect)
#   TCP       0.0.0.0/0      443             HTTPS (nginx TLS)
#   UDP       0.0.0.0/0      16384-32768     RTP media (FreeSWITCH audio)
#
# Ports 3000 (Node), 5066 (SIP/WS), 8021 (ESL), 8081 (Verto WS) are
# INTERNAL ONLY — nginx proxies them — do NOT expose them in Oracle Console.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "===== Configuring UFW firewall for PRaww+ ====="

# Default policy
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH (keep this first to avoid locking yourself out)
sudo ufw allow 22/tcp comment "SSH"

# Web traffic (nginx handles TLS, proxies to Node on port 3000)
sudo ufw allow 80/tcp  comment "HTTP → HTTPS redirect"
sudo ufw allow 443/tcp comment "HTTPS (nginx TLS)"

# RTP media — FreeSWITCH audio streams
# Must be UDP; range matches FreeSWITCH's rtp-port-range setting
sudo ufw allow 16384:32768/udp comment "FreeSWITCH RTP media"

# ── Internal-only ports (bound to 127.0.0.1 or VPS LAN only) ─────────────────
# These are proxied by nginx and MUST NOT be reachable from the internet.
# They are listed here for documentation only — UFW rules are NOT added.
#
#   Port 3000  — Node.js API (nginx → upstream prawwplus_api)
#   Port 5066  — FreeSWITCH SIP/WS (nginx → /api/sip/ws proxy)
#   Port 5068  — FreeSWITCH SIP/TCP (not exposed externally)
#   Port 8021  — FreeSWITCH ESL (server → FreeSWITCH, localhost only)
#   Port 8081  — FreeSWITCH Verto WS (nginx → /api/verto/ws proxy)

echo "===== Enabling UFW ====="
sudo ufw --force enable
sudo ufw status verbose

echo ""
echo "===== UFW configuration done ====="
echo ""
echo "REMINDER: Also add Ingress rules in Oracle Cloud Console:"
echo "  Networking → Virtual Cloud Networks → <your VCN>"
echo "  → Security Lists → Default Security List"
echo "  Add Ingress Rules:"
echo "    TCP  0.0.0.0/0  22          (SSH)"
echo "    TCP  0.0.0.0/0  80          (HTTP)"
echo "    TCP  0.0.0.0/0  443         (HTTPS)"
echo "    UDP  0.0.0.0/0  16384-32768 (RTP media)"
