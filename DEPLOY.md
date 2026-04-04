# PRaww+ — Oracle VPS Deployment Guide

> **Platform:** Ubuntu 22.04 LTS on Oracle Cloud (ARM64 Ampere A1 or AMD64 x86_64)  
> **Stack:** Node.js 22 + PM2 · Nginx · MongoDB · FreeSWITCH · Firebase FCM · PayFast

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

### 3. Create your `.env` file

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

### 4. Run the setup script

```bash
sudo bash deploy/setup.sh
```

This installs Node.js 22, pnpm, PM2, nginx, certbot, installs all dependencies,
builds the app, starts it with PM2, and configures nginx.

### 5. Get a free SSL certificate

```bash
sudo certbot --nginx -d rtc.praww.co.za
```

### 6. Reload services

```bash
sudo systemctl reload nginx
pm2 reload ecosystem.config.cjs --update-env && pm2 save
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
```

Then reload PM2:
```bash
pm2 reload ecosystem.config.cjs --update-env && pm2 save
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

Pulls latest code, rebuilds everything, reloads PM2 with zero downtime.

---

## Fixing Login Issues

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

## PM2 Commands

```bash
pm2 logs prawwplus --lines 100          # Live logs
pm2 status                              # Process status
pm2 reload ecosystem.config.cjs --update-env && pm2 save  # Reload with new env
pm2 monit                               # CPU/memory monitor
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
 PM2 → Node.js API (Express, port 3000)
    ├── MongoDB Atlas  (user data, sessions, calls)
    ├── FreeSWITCH ESL (127.0.0.1:8021)  — call control
    ├── Verto WS Proxy (127.0.0.1:8081)  — browser WebRTC
    └── SIP WS Proxy   (127.0.0.1:5066)  — mobile SIP
```
