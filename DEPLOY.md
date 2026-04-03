# PRaww+ — Oracle VPS Deployment Guide

Complete step-by-step guide for deploying PRaww+ to an **Oracle Cloud Ubuntu 22.04 AMD64** instance.

---

## Prerequisites

- Oracle Cloud account with a running Ubuntu 22.04 AMD64 VM
- A domain name (or subdomain) pointing to the VM's public IP
- A MongoDB instance (Atlas free tier or self-hosted replica set)
- A Firebase project with a service account private key
- FreeSWITCH built from source (the install script handles this)
- A PayFast merchant account

---

## Step 1 — Oracle Cloud Security List (Ingress Rules)

In the **Oracle Cloud Console** navigate to:
`Networking → Virtual Cloud Networks → <your VCN> → Security Lists → Default Security List`

Add these **Ingress Rules** (do this BEFORE anything else, or you'll lock yourself out):

| Protocol | Source CIDR | Port(s) | Purpose |
|---|---|---|---|
| TCP | 0.0.0.0/0 | 22 | SSH |
| TCP | 0.0.0.0/0 | 80 | HTTP (nginx → HTTPS redirect) |
| TCP | 0.0.0.0/0 | 443 | HTTPS |
| UDP | 0.0.0.0/0 | 16384-32768 | FreeSWITCH RTP media |

> **Do NOT** expose ports 3000, 5066, 8021, or 8081 — these are internal only, proxied by nginx.

---

## Step 2 — SSH into the VM

```bash
ssh ubuntu@YOUR_VPS_IP
```

---

## Step 3 — Build and Install FreeSWITCH

No token or account required — FreeSWITCH is compiled from the official source on GitHub.

> **Build time:** 20-40 minutes depending on VPS size. Run in a `tmux` or `screen` session so a dropped SSH connection doesn't interrupt it.

```bash
# Clone the repo (replace with your actual git repo URL)
git clone https://github.com/YOUR_ORG/prawwplus.git ~/PRawwPlus
cd ~/PRawwPlus

# Start a persistent session first (optional but recommended):
tmux new -s freeswitch

sudo bash deploy/freeswitch.sh
```

This compiles FreeSWITCH 1.10 from source with **all audio modules required for WebRTC**:
- `mod_opus` — **Opus codec** (required for Chrome/Firefox/Safari WebRTC audio — no audio without this)
- `mod_verto` — WebRTC browser support
- `mod_sofia` — SIP stack for mobile (JsSIP)
- `mod_voicemail` — Voicemail
- `mod_flite` — TTS announcements
- `mod_event_socket` — API server control (ESL)
- `mod_xml_curl` — Dynamic user directory

**Install locations:**
| Path | Purpose |
|---|---|
| `/usr/local/freeswitch` | Install prefix (binaries, modules, sounds) |
| `/etc/freeswitch` | Config directory (symlink → `/usr/local/freeswitch/conf`) |
| `/var/log/freeswitch` | Log files |
| `/usr/local/freeswitch/storage` | Voicemail recordings |

**Verify FreeSWITCH is running:**
```bash
sudo systemctl status freeswitch
sudo fs_cli -x "status"
```

---

## Step 4 — Bootstrap the VPS

This installs Node.js 22, pnpm, PM2, nginx, and certbot:

```bash
# Edit the script to set your domain and deploy directory first:
nano deploy/setup.sh
# Change: DEPLOY_DIR="/home/ubuntu/PRawwPlus"
# Change: DOMAIN="your-domain.com"

bash deploy/setup.sh
```

---

## Step 5 — Configure Environment Variables

```bash
cd ~/PRawwPlus
cp .env.example .env
nano .env
```

Fill in every value. Critical ones:

```bash
# Your server
PORT=3000
NODE_ENV=production
TRUST_PROXY=1
APP_URL=https://your-domain.com

# MongoDB — Atlas URI (recommended) or self-hosted
MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/prawwplus?retryWrites=true&w=majority

# Firebase — from Firebase Console → Project Settings → Service Accounts → Generate key
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----\n"

# FreeSWITCH
# FREESWITCH_DOMAIN = your VPS PUBLIC IP (used for RTP NAT in verto/sofia configs)
# If this is wrong, calls will connect but have NO AUDIO.
FREESWITCH_DOMAIN=140.245.xx.xx          # ← your VPS public IP
FREESWITCH_ESL_HOST=127.0.0.1            # always localhost (ESL on same VPS)
FREESWITCH_ESL_PORT=8021
FREESWITCH_ESL_PASSWORD=strong_password_here   # CHANGE from default ClueCon!
FREESWITCH_WS_URL=ws://127.0.0.1:8081/  # internal Verto WS (never public IP)
FREESWITCH_SIP_WS_URL=ws://127.0.0.1:5066     # internal SIP WS (never public IP)
FREESWITCH_SIP_WS_PORT=5066
FREESWITCH_SSH_USER=ubuntu
FREESWITCH_SSH_PORT=22
# Generate SSH key on the VPS: ssh-keygen -t ed25519 -f ~/.ssh/freeswitch_key -N ""
# Add public key:               cat ~/.ssh/freeswitch_key.pub >> ~/.ssh/authorized_keys
# Get private key contents:     cat ~/.ssh/freeswitch_key
# Paste the private key below (replace \n with actual newlines in .env):
FREESWITCH_SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\nYOUR_KEY\n-----END OPENSSH PRIVATE KEY-----\n"
FREESWITCH_CONF_DIR=/etc/freeswitch
FREESWITCH_STORAGE_DIR=/usr/local/freeswitch/storage
FREESWITCH_WEBHOOK_SECRET=change_me_to_a_random_64char_secret

# PayFast
PAYFAST_MERCHANT_ID=your_merchant_id
PAYFAST_MERCHANT_KEY=your_merchant_key
PAYFAST_PASSPHRASE=your_passphrase

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_google_app_password
SMTP_FROM="PRaww+ <noreply@your-domain.com>"
```

---

## Step 6 — Build and Start

```bash
cd ~/PRawwPlus

# Install all dependencies
pnpm install --no-frozen-lockfile

# Build library packages (db models, API client hooks, auth)
pnpm --filter @workspace/db \
     --filter @workspace/auth-web \
     --filter @workspace/api-client-react \
     run build

# Build frontend (outputs to artifacts/prawwplus/dist/public)
pnpm --filter @workspace/prawwplus run build

# Build backend (bundles to artifacts/api-server/dist/index.cjs)
pnpm --filter @workspace/api-server run build

# Create PM2 log directory
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

**Check logs:**
```bash
pm2 logs prawwplus --lines 50
```

---

## Step 7 — Configure Nginx

The `deploy/setup.sh` script already copies and enables the nginx config. If you need to do it manually:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/prawwplus
sudo sed -i 's/YOUR_DOMAIN/your-domain.com/g' /etc/nginx/sites-available/prawwplus
sudo ln -sf /etc/nginx/sites-available/prawwplus /etc/nginx/sites-enabled/prawwplus
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 8 — SSL Certificate (Let's Encrypt)

```bash
sudo certbot --nginx -d your-domain.com
# Auto-renew is set up automatically by certbot on Ubuntu
```

Verify HTTPS works: `https://your-domain.com/api/healthz` should return `{ "status": "ok" }`.

---

## Step 9 — OS Firewall

```bash
sudo bash deploy/oracle-ports.sh
```

This sets UFW defaults: deny incoming, allow SSH/HTTP/HTTPS + FreeSWITCH RTP UDP range.

---

## Step 10 — Verify Everything Works

```bash
# API health check
curl https://your-domain.com/api/healthz

# PM2 status
pm2 status
pm2 logs prawwplus --lines 100

# FreeSWITCH status
sudo fs_cli -x "status"
sudo fs_cli -x "sofia status"

# MongoDB connection (check PM2 logs for "MongoDB connected")
pm2 logs prawwplus | grep -i mongo

# Nginx
sudo nginx -t
sudo systemctl status nginx
```

---

## Zero-Downtime Updates (after code changes)

```bash
cd ~/PRawwPlus
bash deploy/update.sh
```

This pulls latest code, rebuilds everything, and does a PM2 reload (zero-downtime).

---

## FreeSWITCH Configuration

PRaww+ auto-pushes FreeSWITCH configuration via SSH every time the API server starts. It provisions:

- SIP directory entries for each user (extension + password)
- Verto WebSocket profile (`mod_verto` on port 8081)
- SIP WebSocket profile (`mod_sofia` on port 5066)
- Voicemail configuration

**Check that config was pushed:**
```bash
pm2 logs prawwplus | grep -i "FSH\|freeswitch\|provision"
```

**Manually reload FreeSWITCH config:**
```bash
sudo fs_cli -x "reloadxml"
sudo fs_cli -x "sofia rescan"
sudo fs_cli -x "reload mod_verto"
```

---

## MongoDB

**Atlas (recommended):**
1. Create free M0 cluster at https://cloud.mongodb.com
2. Create a database user
3. Whitelist `0.0.0.0/0` (or your VPS IP) in Network Access
4. Copy the connection string into `MONGODB_URI` in `.env`

**Self-hosted (replica set required for transactions):**
```bash
sudo apt-get install -y mongodb
sudo systemctl enable mongod
sudo systemctl start mongod
# Initialize replica set (required for ACID transactions):
mongosh --eval "rs.initiate()"
```
Set `MONGODB_URI=mongodb://localhost:27017/prawwplus?replicaSet=rs0`

---

## Firebase Setup

1. Go to https://console.firebase.google.com
2. Create or open your project
3. Project Settings → Service Accounts → **Generate new private key**
4. Download the JSON file
5. Extract values into `.env`:
   - `FIREBASE_PROJECT_ID` = `project_id` field
   - `FIREBASE_CLIENT_EMAIL` = `client_email` field
   - `FIREBASE_PRIVATE_KEY` = `private_key` field (replace literal `\n` with `\n` in .env)

---

## PayFast Setup

1. Log in at https://www.payfast.co.za
2. My Account → Settings → Merchant Details
3. Copy Merchant ID, Merchant Key, and Passphrase into `.env`
4. In PayFast settings, set your Return URL and Notify URL:
   - Notify URL: `https://your-domain.com/api/payments/payfast/notify`

---

## Audio Troubleshooting (No Sound / One-Way Audio)

This is the most common deployment issue. Work through this checklist:

**1. Verify RTP ports are open (Oracle Cloud + UFW)**
```bash
# Oracle Cloud Console → Security List → must have UDP 16384-32768 inbound
# On the VPS:
sudo ufw status | grep 16384
# Should show: 16384:32768/udp ALLOW Anywhere
```

**2. Verify FREESWITCH_DOMAIN is the correct PUBLIC IP**
```bash
# Get your public IP:
curl -s ifconfig.me
# Must match FREESWITCH_DOMAIN in .env exactly
grep FREESWITCH_DOMAIN .env
```

**3. Verify mod_opus is loaded**
```bash
sudo fs_cli -x "show codec" | grep -i opus
# Must return one or more opus codec lines
# If empty: sudo apt-get install freeswitch-mod-opus
# Then: sudo fs_cli -x "load mod_opus"
```

**4. Verify FreeSWITCH config was pushed**
```bash
pm2 logs prawwplus | grep FSH
# Should show "Config push complete" steps
# If SSH key error: check FREESWITCH_SSH_KEY in .env
```

**5. Check ICE candidates in browser**
Open browser DevTools → Network tab. After a call attempt, look for `/api/verto/ws` WebSocket frames. The Verto `verto.invite` message should include ICE candidates with your VPS public IP (not 10.x.x.x or 172.x.x.x).

**6. Optional: Add TURN server for restrictive networks**
Some mobile networks block direct UDP/RTP. Add a TURN server in `.env`:
```bash
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:YOUR_TURN_SERVER:3478","username":"user","credential":"pass"}]
```
Free TURN servers: [Metered.ca](https://www.metered.ca/tools/openrelay/) (limited) or self-host with `coturn`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `502 Bad Gateway` | PM2 app not running — `pm2 start ecosystem.config.cjs` |
| `MongoDB connection error` | Check `MONGODB_URI` and IP whitelist in Atlas |
| `FREESWITCH_SSH_KEY not configured` | Add the private key to `.env` |
| Calls connect but NO AUDIO | `FREESWITCH_DOMAIN` must be the public IP; UDP 16384-32768 must be open; `mod_opus` must be installed |
| One-way audio only | Same as above — wrong ext-rtp-ip in FreeSWITCH config |
| Calls fail to connect | Check `FREESWITCH_WS_URL=ws://127.0.0.1:8081/` — must use 127.0.0.1, not public IP |
| ESL not connecting | Check `FREESWITCH_ESL_PASSWORD` matches FreeSWITCH config; `FREESWITCH_ESL_HOST=127.0.0.1` |
| No voicemail listed | Check `FREESWITCH_STORAGE_DIR` and SSH key access; `sudo fs_cli -x "voicemail list default"` |
| SSL error | Run `sudo certbot --nginx -d your-domain.com` |
| Push notifications not working | Verify Firebase credentials and FCM project ID; check `google-services.json` in mobile app |
| Android build fails | Run `expo prebuild` then `eas build --platform android` |

---

## Security Checklist

- [ ] `.env` file is NOT in git (it's in `.gitignore`)
- [ ] `FREESWITCH_ESL_PASSWORD` changed from default `ClueCon`
- [ ] `FREESWITCH_WEBHOOK_SECRET` set to a random 64-char string
- [ ] Ports 3000, 5066, 8021, 8081 NOT exposed in Oracle Console security list
- [ ] UFW enabled: `sudo ufw status`
- [ ] SSL/TLS certificate installed and auto-renewing: `sudo certbot renew --dry-run`
- [ ] MongoDB Atlas IP whitelist is not `0.0.0.0/0` in production
- [ ] PM2 startup script saved: `pm2 save`

---

## Support

Contact: info@prawwplus.co.za
