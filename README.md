# PRaww+

**PRaww+** is a production-grade VoIP and unified communications platform built for South African businesses.

## Features

- Web-based softphone (browser calling via FreeSWITCH Verto WebRTC)
- Mobile app (React Native / Expo — separate build)
- REST API + WebSocket proxy backend (Node.js / Express)
- MongoDB user/call/payment storage
- FreeSWITCH telephony integration (provisioning, call control, voicemail)
- PayFast payment gateway (subscriptions + coin top-ups)
- Firebase Cloud Messaging push notifications
- systemd-managed deployment on Oracle Cloud Ubuntu (ARM64 or AMD64)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, Tailwind CSS v4, TanStack Query, Wouter |
| Backend  | Node.js 22, Express 5, TypeScript, Pino logging |
| Database | MongoDB (Atlas or self-hosted replica set) |
| Telephony | FreeSWITCH 1.10 via ESL + SSH provisioning |
| Auth | JWT, httpOnly cookies, bcrypt |
| Payments | PayFast (subscriptions + one-time) |
| Push | Firebase Admin SDK (FCM) |
| Process | systemd |
| Proxy | Nginx (TLS termination, WebSocket upgrade, static files) |

---

## Repository Structure

```
artifacts/
  prawwplus/        # React web frontend (Vite)
  api-server/       # Node.js/Express backend (bundled with esbuild)
  prawwplus-mobile/ # React Native / Expo (not deployed here)
lib/
  db/               # Mongoose models + MongoDB connection utility
  api-spec/         # OpenAPI spec + Orval codegen config
  api-zod/          # Auto-generated Zod validation schemas
  api-client-react/ # Auto-generated TanStack Query hooks (frontend)
  auth-web/         # Shared browser auth logic
scripts/            # Build + codegen utilities
deploy/             # Oracle VPS deployment scripts
  setup.sh          # One-time VPS bootstrap
  update.sh         # Zero-downtime redeploy
  freeswitch.sh     # FreeSWITCH 1.10 install on Ubuntu
  oracle-ports.sh   # UFW + Oracle Console firewall guide
  nginx.conf        # Nginx reverse proxy config
  prawwplus-api.service # systemd unit file (API server)
.env.example        # Template for all required environment variables
```

---

## Deployment — Oracle VPS (Ubuntu 22.04)

See [DEPLOY.md](./DEPLOY.md) for the complete step-by-step guide.

**Quick summary:**

```bash
# 1. Build and install FreeSWITCH from source (takes 20-40 min)
sudo bash deploy/freeswitch.sh

# 2. Bootstrap VPS (Node.js 22, pnpm, nginx, certbot)
bash deploy/setup.sh

# 3. Copy and fill in your secrets
cp .env.example .env
nano .env

# 4. Start API server
sudo systemctl restart prawwplus-api

# 5. SSL certificate
sudo certbot --nginx -d your-domain.com

# Zero-downtime redeploy (after git pull):
bash deploy/update.sh
```

---

## Local Development

### Prerequisites
- Node.js 22+
- pnpm 10+
- MongoDB accessible via `MONGODB_URI`
- FreeSWITCH running (or point `FREESWITCH_*` vars at a remote server)

### Start

```bash
pnpm install

# Build shared libraries
pnpm --filter @workspace/db --filter @workspace/auth-web --filter @workspace/api-client-react run build

# Terminal 1 — API server (port 8080)
cd artifacts/api-server && PORT=8080 pnpm run dev

# Terminal 2 — Vite dev server (port 5173, proxies /api → 8080)
cd artifacts/prawwplus && pnpm run dev
```

### Environment

Copy `.env.example` to `.env` at the repo root and fill in all values. The API server reads from the working directory `.env`.

---

## Environment Variables

See [.env.example](./.env.example) for every required variable with inline documentation.

Key groups:

| Group | Variables |
|---|---|
| Server | `PORT`, `NODE_ENV`, `TRUST_PROXY`, `APP_URL` |
| MongoDB | `MONGODB_URI`, `MONGODB_USE_TRANSACTIONS` |
| Firebase | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| FreeSWITCH | `FREESWITCH_DOMAIN`, `FREESWITCH_ESL_*`, `FREESWITCH_SSH_*`, `FREESWITCH_WS_URL` |
| PayFast | `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| Billing | `LOW_BALANCE_THRESHOLD_COINS`, `MAX_BILLSEC_PER_CALL`, `MAX_CONCURRENT_CALLS_PER_USER` |

---

## API Routes

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/signup` | Register a new user |
| POST | `/api/auth/login` | Login (returns httpOnly JWT cookie) |
| POST | `/api/auth/logout` | Clear session |
| GET  | `/api/users/me` | Current user profile |
| GET  | `/api/calls` | Paginated call history |
| POST | `/api/calls` | Initiate outbound call |
| GET  | `/api/contacts` | List contacts |
| POST | `/api/contacts` | Add contact |
| GET  | `/api/numbers` | List available DID numbers |
| POST | `/api/numbers/claim` | Claim a phone number |
| POST | `/api/payments/subscribe` | Start PayFast subscription |
| POST | `/api/payments/topup` | Top up coin balance |
| GET  | `/api/voicemail` | List voicemail messages |
| GET  | `/api/voicemail/message` | Stream voicemail audio |
| PATCH| `/api/voicemail/message/read` | Mark message as read |
| DELETE | `/api/voicemail/message` | Delete voicemail |
| GET  | `/api/healthz` | Health check |

---

## License

Proprietary — all rights reserved.
