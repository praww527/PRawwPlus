#!/usr/bin/env bash
# deploy/freeswitch.sh
# Build and install FreeSWITCH 1.10 from source on Oracle Ubuntu 22.04 ARM64.
#
# FreeSWITCH is 100% open-source (Apache License). Its canonical source code
# lives at github.com/signalwire/freeswitch (SignalWire acquired the project
# in 2018 but kept it open-source). No account, token, subscription, or
# SignalWire service of any kind is required to build or run FreeSWITCH.
#
# Usage:   sudo bash deploy/freeswitch.sh
# Platform: Oracle Cloud Ubuntu 22.04 LTS — ARM64 (Ampere A1) or AMD64
#
# Build time: 20-40 minutes depending on VPS size.
# Installs to: /usr/local/freeswitch
# Config dir:  /etc/freeswitch  (symlinked → /usr/local/freeswitch/conf)
# Logs:        /var/log/freeswitch
# Storage:     /usr/local/freeswitch/storage
set -euo pipefail

FS_VERSION="${FS_VERSION:-v1.10.12}"
FS_SRC="/usr/src/freeswitch"
FS_PREFIX="/usr/local/freeswitch"

ARCH="$(uname -m)"
echo "===== Detected architecture: ${ARCH} ====="

echo "===== [1/8] Install build dependencies ====="
apt-get update -y
apt-get install -y \
  build-essential cmake automake autoconf libtool pkg-config \
  git wget curl lsb-release ca-certificates \
  \
  libssl-dev zlib1g-dev libdb-dev unixodbc-dev \
  libncurses5-dev libexpat1-dev libedit-dev \
  libsqlite3-dev libpcre3-dev libcurl4-openssl-dev \
  libldns-dev liblua5.2-dev libjpeg-dev libtiff5-dev \
  \
  libopus-dev libopus0 \
  libsndfile1-dev libspeex-dev libspeexdsp-dev \
  libvorbis-dev libgsm1-dev \
  \
  libsofia-sip-ua-dev libspandsp-dev \
  \
  flite libflite1 \
  \
  yasm nasm \
  libavformat-dev libswscale-dev \
  python3-dev swig \
  uuid-dev

echo "===== [2/8] Create freeswitch system user ====="
if ! id freeswitch &>/dev/null; then
  adduser --system --group --no-create-home --home "$FS_PREFIX" \
    --shell /bin/false freeswitch
fi

echo "===== [3/8] Clone FreeSWITCH ${FS_VERSION} source ====="
if [ -d "$FS_SRC/.git" ]; then
  echo "Source already exists — fetching updates"
  git -C "$FS_SRC" fetch --tags
  git -C "$FS_SRC" checkout "$FS_VERSION"
else
  git clone https://github.com/signalwire/freeswitch.git "$FS_SRC" --depth 1 \
    --branch "$FS_VERSION"
fi
cd "$FS_SRC"

echo "===== [4/8] Enable required modules ====="
cp modules.conf modules.conf.bak 2>/dev/null || true
cat > /tmp/fs_modules_enable.sh << 'MODSCRIPT'
#!/usr/bin/env bash
CONF="$1"
enable_mod() {
  local mod="$1"
  sed -i "s|^[[:space:]]*#[[:space:]]*\(.*${mod}\)|\1|" "$CONF"
}
enable_mod "codecs/mod_opus"
enable_mod "codecs/mod_sndfile"
enable_mod "codecs/mod_speex"
enable_mod "codecs/mod_vorbis"
enable_mod "codecs/mod_h26x"
enable_mod "endpoints/mod_sofia"
enable_mod "endpoints/mod_verto"
enable_mod "endpoints/mod_loopback"
enable_mod "event_handlers/mod_event_socket"
enable_mod "event_handlers/mod_json_cdr"
enable_mod "applications/mod_commands"
enable_mod "applications/mod_dptools"
enable_mod "applications/mod_voicemail"
enable_mod "applications/mod_flite"
enable_mod "applications/mod_say_en"
enable_mod "applications/mod_curl"
enable_mod "xml_int/mod_xml_curl"
enable_mod "xml_int/mod_xml_rpc"
enable_mod "loggers/mod_logfile"
enable_mod "loggers/mod_console"
enable_mod "formats/mod_sndfile"
MODSCRIPT
bash /tmp/fs_modules_enable.sh modules.conf

echo "===== [5/8] Bootstrap and configure ====="
./bootstrap.sh -j
./configure \
  --prefix="$FS_PREFIX" \
  --with-openssl

echo "===== [6/8] Build (this takes 20-40 minutes) ====="
make -j"$(nproc)"

echo "===== [7/8] Install FreeSWITCH ====="
make install
make cd-sounds-install
make cd-moh-install

chown -R freeswitch:freeswitch "$FS_PREFIX"
mkdir -p /var/log/freeswitch
chown freeswitch:freeswitch /var/log/freeswitch

ln -sf "$FS_PREFIX/bin/freeswitch" /usr/local/bin/freeswitch
ln -sf "$FS_PREFIX/bin/fs_cli"     /usr/local/bin/fs_cli

if [ ! -L /etc/freeswitch ] && [ ! -d /etc/freeswitch ]; then
  ln -sf "$FS_PREFIX/conf" /etc/freeswitch
  echo "Created symlink /etc/freeswitch → $FS_PREFIX/conf"
fi

cat > /etc/systemd/system/freeswitch.service << UNIT
[Unit]
Description=FreeSWITCH Voice Platform
After=network.target syslog.target
Wants=network.target

[Service]
Type=forking
PIDFile=${FS_PREFIX}/run/freeswitch.pid
EnvironmentFile=-/etc/default/freeswitch

ExecStart=${FS_PREFIX}/bin/freeswitch \\
  -ncwait \\
  -nonat \\
  -log /var/log/freeswitch \\
  -run ${FS_PREFIX}/run \\
  -db  ${FS_PREFIX}/db \\
  -mod ${FS_PREFIX}/mod

ExecStop=/bin/kill -TERM \$MAINPID
ExecReload=/bin/kill -HUP \$MAINPID

Restart=always
RestartSec=5
LimitNOFILE=999999
LimitSTACK=240
User=freeswitch
Group=freeswitch
WorkingDirectory=${FS_PREFIX}
TimeoutStartSec=45

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable freeswitch
systemctl start freeswitch

echo ""
echo "Waiting for FreeSWITCH to start..."
sleep 8
systemctl status freeswitch --no-pager || true

echo "===== [8/8] Verify installation ====="
echo ""
echo "FreeSWITCH status:"
fs_cli -x "status" 2>/dev/null || echo "  (FreeSWITCH may still be starting — wait 10s and retry: fs_cli -x status)"

echo ""
echo "Opus codec check (required for WebRTC audio):"
fs_cli -x "show codec" 2>/dev/null | grep -i opus \
  || echo "  mod_opus not yet loaded — run: fs_cli -x 'load mod_opus'"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  FreeSWITCH build complete (${ARCH})                        ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Install prefix:  ${FS_PREFIX}                   ║"
echo "║  Config dir:      /etc/freeswitch  (→ ${FS_PREFIX}/conf) ║"
echo "║  Log dir:         /var/log/freeswitch                       ║"
echo "║  Storage dir:     ${FS_PREFIX}/storage              ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Set in .env:                                               ║"
echo "║    FREESWITCH_DOMAIN=<your VPS public IP>                   ║"
echo "║    FREESWITCH_ESL_HOST=127.0.0.1                            ║"
echo "║    FREESWITCH_ESL_PORT=8021                                 ║"
echo "║    FREESWITCH_ESL_PASSWORD=<strong password>                ║"
echo "║    FREESWITCH_CONF_DIR=/etc/freeswitch                      ║"
echo "║    FREESWITCH_STORAGE_DIR=${FS_PREFIX}/storage      ║"
echo "║                                                              ║"
echo "║  Open Oracle firewall: UDP 16384-32768 (RTP audio)          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
