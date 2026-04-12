# PRaww+ — Oracle VPS Deployment Guide

> **Platform:** Ubuntu 22.04 LTS on Oracle Cloud (ARM64 Ampere A1 or AMD64 x86_64)
> **Stack:** Node.js 22 + systemd · Nginx · MongoDB · FreeSWITCH · Firebase FCM · PayFast

---

## IMPORTANT: Migrating from call-manager / call-manager-mobile

If you previously had `call-manager` or `call-manager-mobile` deployed on this VPS, you MUST
remove those old services first. They will hold port 3000 hostage, prevent `prawwplus-api`
from starting, and cause login to return **"Network error"** in the browser.

Run this cleanup script **once** on your VPS before deploying PRaww+:

```bash
cd /home/ubuntu/PRawwPlus
bash deploy/cleanup-old-services.sh
```

What it does:
- Stops and disables all `call-manager*` systemd services
- Removes their unit files from `/etc/systemd/system/`
- Removes stale nginx site configs for `call-manager*`
- Reloads nginx
- Confirms port 3000 is free

After running it, proceed with the normal setup steps below.

---

## Prerequisites

| Service | What you need |
|---------|--------------|
| **Oracle VPS** | Ubuntu 22.04 LTS, public IP, SSH access as `ubuntu` user |
| **Domain** | DNS A record pointing to your VPS public IP (e.g. `rtc.praww.co.za`) |
| **MongoDB** | Atlas cluster — whitelist your VPS public IP in Network Access settings |
| **Firebase** | Project with FCM enabled — download service account JSON for push notifications |
| **PayFast** | Merchant credentials (for billing/subscriptions) |
| **SMTP** | Any SMTP service (Gmail App Password, SendGrid) — optional but recommended |

---

## First-time Setup

### 1. SSH into your VPS

```bash
ssh ubuntu@YOUR_VPS_IP
```

### 2. Clone the repository

```bash
git clone https://github.com/praww527/PRawwPlus.git /home/ubuntu/PRawwPlus
cd /home/ubuntu/PRawwPlus
```

### 3. Remove old call-manager services (if present)

```bash
bash deploy/cleanup-old-services.sh
```

### 4. Create your `.env` file

```bash
cp .env.example .env
nano .env
```

**Minimum required to get login working:**

```env
NODE_ENV=production
PORT=3000
TRUST_PROXY=1
APP_URL=https://rtc.praww.co.za

MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/prawwplus?retryWrites=true&w=majority
```

Fill in all other variables from `.env.example` for full functionality (FreeSWITCH, Firebase, PayFast, SMTP).

> **Note on email verification:** If `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` are not set,
> new accounts are **automatically verified** on signup — users can log in immediately
> without needing email confirmation.

### 5. Run the setup script

```bash
sudo bash deploy/setup.sh
```

This installs Node.js 22, pnpm, nginx, certbot, installs all dependencies,
builds the app, starts it with systemd, and configures nginx.

### 6. Get a free SSL certificate

```bash
sudo certbot --nginx -d rtc.praww.co.za
```

### 7. Reload services

```bash
sudo systemctl reload nginx
sudo systemctl restart prawwplus-api
```

---

## Installing FreeSWITCH (VoIP calls)

FreeSWITCH is 100% open-source and free. Build it from source on your VPS:

```bash
sudo bash deploy/freeswitch.sh
```

**Build time: 20–40 minutes.** After building, set these in your `.env`:

```env
FREESWITCH_DOMAIN=YOUR_VPS_PUBLIC_IP
FREESWITCH_ESL_HOST=127.0.0.1
FREESWITCH_ESL_PORT=8021
FREESWITCH_ESL_PASSWORD=change_me_strong_password
FREESWITCH_WS_URL=ws://127.0.0.1:8081/
FREESWITCH_SIP_WS_URL=ws://127.0.0.1:5066
FREESWITCH_SIP_WS_PORT=5066
FREESWITCH_SSH_USER=ubuntu
FREESWITCH_SSH_PORT=22
FREESWITCH_CONF_DIR=/etc/freeswitch
FREESWITCH_STORAGE_DIR=/usr/local/freeswitch/storage
FREESWITCH_WEBHOOK_SECRET=change_me_random_secret
FREESWITCH_SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END OPENSSH PRIVATE KEY-----\n"
PSTN_GATEWAY_NAME=your-sip-trunk
PSTN_GATEWAY_USERNAME=your-sip-username
PSTN_GATEWAY_PASSWORD=your-sip-password
PSTN_GATEWAY_PROXY=sip.provider.example
PSTN_GATEWAY_REALM=sip.provider.example
PSTN_GATEWAY_FROM_DOMAIN=sip.provider.example
PSTN_GATEWAY_REGISTER=true
```

Then restart the service:
```bash
sudo systemctl restart prawwplus-api
```

---

## Firebase (Push Notifications)

1. Firebase Console → Project Settings → Service Accounts → Generate new private key
2. From the downloaded JSON, set:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```

---

## MongoDB Network Access

MongoDB Atlas blocks all connections by default. You MUST whitelist your VPS IP:

1. Atlas → Network Access → Add IP Address
2. Enter your Oracle VPS public IP (e.g. `140.245.xx.xx`)

---

## Updating the App

```bash
cd /home/ubuntu/PRawwPlus
bash deploy/update.sh
```

Pulls latest code, rebuilds everything, restarts the systemd service.

---

## Fixing Login Issues

### "Network error" on login

This almost always means one of these:

1. **Old call-manager service is still running on port 3000** — run `bash deploy/cleanup-old-services.sh`
2. **prawwplus-api failed to start** — check: `sudo journalctl -u prawwplus-api -n 50 --no-pager`
3. **MongoDB URI not set** — ensure `MONGODB_URI` is in your `.env`
4. **MongoDB Atlas IP not whitelisted** — whitelist your VPS public IP in Atlas → Network Access

### Users can't log in — email not verified

If users signed up when SMTP was not configured (before the auto-verify fix),
their accounts are stuck as unverified. Use the admin tool to fix them:

```bash
cd /home/ubuntu/PRawwPlus

# List all unverified users
pnpm tsx scripts/verify-user.ts --list

# Verify a specific user
pnpm tsx scripts/verify-user.ts user@example.com

# Verify ALL unverified users at once
pnpm tsx scripts/verify-user.ts --all
```

### MongoDB connection refused

Ensure your VPS public IP is whitelisted in MongoDB Atlas → Network Access.

### Login works but page doesn't stay logged in (cookie dropped)

- Ensure `TRUST_PROXY=1` is in `.env`
- Ensure nginx forwards `X-Forwarded-Proto: https` (it does by default in our nginx.conf)
- Ensure the site is accessed over HTTPS — the session cookie requires it

---

## API Service Commands

```bash
sudo systemctl status prawwplus-api --no-pager
sudo journalctl -u prawwplus-api -n 200 --no-pager
sudo journalctl -u prawwplus-api -f
sudo systemctl restart prawwplus-api
```

---

## Nginx Commands

```bash
sudo nginx -t                           # Test config
sudo systemctl reload nginx             # Reload (no downtime)
sudo tail -f /var/log/nginx/error.log   # Error log
```

---

## FreeSWITCH Commands

```bash
fs_cli -x "status"                      # Check status
fs_cli -x "show registrations"          # List registered phones
sudo journalctl -u freeswitch -f        # Live logs
```

---

## Oracle Firewall Ports

Open these in both UFW (setup script does this) and Oracle Cloud Security Lists:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP → HTTPS redirect |
| 443 | TCP | HTTPS |
| 5060 | UDP | SIP signalling |
| 5066 | TCP | SIP over WebSocket |
| 16384–32768 | UDP | RTP audio media |

Run `sudo bash deploy/oracle-ports.sh` for Oracle Cloud iptables rules.

---

## Architecture

```
Internet (HTTPS :443)
    │
 Nginx  ──────────────────────────────────────────
    │  /api/*  →  localhost:3000 (Node.js API)
    │  /       →  Static files (dist/public)
    │
 systemd → Node.js API (Express, port 3000)
    ├── MongoDB Atlas  (user data, sessions, calls)
    ├── FreeSWITCH ESL (127.0.0.1:8021)  — call control
    ├── Verto WS Proxy (127.0.0.1:8081)  — browser WebRTC
    └── SIP WS Proxy   (127.0.0.1:5066)  — mobile SIP
```
