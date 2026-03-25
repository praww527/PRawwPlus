# Call Manager Workspace

## Overview

Telecom call management application using FreeSWITCH Verto for VoIP calls (WebRTC), PayFast for South African payments, and custom email/password auth. Built as a pnpm monorepo.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: MongoDB + Mongoose
- **Auth**: Custom email/password with session store
- **Calling**: FreeSWITCH Verto WebRTC (internal calls free, external calls deduct coins)
- **Payments**: PayFast (South African payment gateway)
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port: 8080, path: /api)
│   └── call-manager/       # React + Vite frontend (port: 3000, path: /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Mongoose models + MongoDB connection
│   └── replit-auth-web/    # Auth web client hook (useAuth)
```

## Call Architecture (FreeSWITCH Verto)

### Extension System
- Every user is automatically assigned a unique 4-digit extension (starting at 1000)
- Extensions are assigned on first login / email verification
- Stored as `extension` field on User model
- Each user gets a unique `fsPassword` for FreeSWITCH authentication

### Call Type Detection
- **Internal call**: number has 3-4 digits (extension-to-extension) → **always free**, routes via FreeSWITCH
- **External call**: number has 5+ digits or starts with `+` → deducts coins, routes externally

### Verto WebRTC Flow
1. Frontend fetches `GET /api/verto/config` — gets WSS URL, extension, login, password
2. Frontend establishes WebSocket to FreeSWITCH Verto endpoint (`wss://host:8082`)
3. Login via `verto.login` JSON-RPC message
4. Outgoing call: `verto.invite` with RTCPeerConnection SDP offer
5. Incoming call: server sends `verto.invite` to client → client shows IncomingCallScreen
6. Hangup: `verto.bye` from either side
7. On call end, frontend calls `POST /api/calls/:id/end` with duration → backend deducts coins (external only)

### Coin Deduction
- Internal calls (extensions): **0 coins** always
- External calls: `ceil(duration_minutes) * 1 coin` deducted on call end
- External calls require active subscription + non-zero coin balance

## Environment Variables / Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `FREESWITCH_WS_URL` | Yes (for calls) | FreeSWITCH Verto WebSocket URL (e.g. `wss://your-fs.example.com:8082`) |
| `FREESWITCH_DOMAIN` | Yes (for calls) | FreeSWITCH SIP domain (e.g. `your-fs.example.com`) |
| `PAYFAST_MERCHANT_ID` | Optional | PayFast merchant ID (sandbox if absent) |
| `PAYFAST_MERCHANT_KEY` | Optional | PayFast merchant key |
| `PAYFAST_PASSPHRASE` | Optional | PayFast passphrase for signature |

## MongoDB Models

- `User` — user accounts, coins balance, subscription plan/status, `extension` (int), `fsPassword`
- `Session` — session store (TTL index on expire)
- `Call` — call records with `callType` (internal|external), duration and coin cost, `fsCallId`
- `Payment` — payment records (subscription/topup/number_change)
- `PhoneNumber` — available PSTN numbers with userId ownership
- `Contact` — user address book

## API Routes

### Auth
- `POST /api/auth/signup` — register (extension auto-assigned on verify)
- `POST /api/auth/login` — login (extension auto-assigned if missing)
- `POST /api/auth/verify-email` — verify email token (assigns extension)
- `POST /api/auth/resend-verification` — resend verification
- `POST /api/auth/forgot-password` — request reset
- `POST /api/auth/reset-password` — reset password
- `GET /api/auth/user` — current user info
- `GET /api/logout` — logout

### Users
- `GET /api/users/me` — full profile with coins/subscription/extension

### Verto
- `GET /api/verto/config` — FreeSWITCH Verto WebRTC config for current user

### Calls
- `GET /api/calls` — call history (paginated)
- `POST /api/calls` — log call initiation (internal or external)
- `GET /api/calls/:id` — single call
- `POST /api/calls/:id/end` — signal call ended, record duration, deduct coins
- `POST /api/calls/webhook/freeswitch` — FreeSWITCH ESL webhook

### Payments
- `POST /api/payments/subscribe` — initiate subscription (basic R59 / pro R109)
- `POST /api/payments/webhook` — PayFast ITN webhook
- `GET /api/payments/history` — payment history
- `POST /api/credits/topup` — top-up wallet coins

### Contacts
- `GET /api/contacts` — list contacts
- `POST /api/contacts` — create contact
- `POST /api/contacts/bulk` — bulk import (up to 500 from phone)
- `DELETE /api/contacts/:contactId` — delete contact

### Admin
- `GET /api/admin/stats` — platform statistics
- `GET /api/admin/users` — list all users
- `GET /api/admin/users/:id` — user detail
- `POST /api/admin/users/:id/adjust-credit` — adjust user coins
- `GET /api/admin/calls` — all calls across platform

## Business Logic

### Subscription Plans
- **Basic**: R59/month → max 1 PSTN phone number
- **Pro**: R109/month → max 2 PSTN phone numbers
- Internal calls (extensions) work regardless of subscription
- External PSTN calls require active subscription + coin balance

### Wallet / Coins System
- Users have a coin wallet (stored as `coins` field on User)
- 1 coin = R0.90
- Top up via PayFast (min R10)
- Coins deducted: 1 coin per minute of external call time
- Internal calls are always free

### PayFast Integration
- Sandbox: `https://sandbox.payfast.co.za/eng/process` (used when no merchant ID set)
- Production: `https://www.payfast.co.za/eng/process`
- Webhook: `POST /api/payments/webhook` (PayFast ITN)

## Environment Variables / Secrets (complete list)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `FREESWITCH_WS_URL` | Yes | e.g. `wss://158.180.29.84:8082/` |
| `FREESWITCH_DOMAIN` | Yes | e.g. `158.180.29.84` |
| `APP_URL` | Yes | Public base URL of this Replit deployment (for email links, PayFast webhooks) |
| `SESSION_SECRET` | Yes | Random string for session signing |
| `SMTP_HOST` | Yes | SMTP server host |
| `SMTP_USER` | Yes | SMTP username |
| `SMTP_PASS` | Yes | SMTP password |
| `SMTP_FROM` | Yes | From address for emails |
| `PAYFAST_MERCHANT_ID` | Optional | PayFast merchant ID (sandbox used if absent) |
| `PAYFAST_MERCHANT_KEY` | Optional | PayFast merchant key |
| `PAYFAST_PASSPHRASE` | Optional | PayFast passphrase |

## FreeSWITCH Integration Notes

- FreeSWITCH server: `158.180.29.84`, mod_verto port `8082`
- FreeSWITCH must call our directory endpoint to authenticate users:
  `GET https://{APP_URL}/api/freeswitch/directory?user={extension}&domain={domain}`
- Our server provisions user extensions starting at 1001 on startup
- Non-trickle ICE used — full SDP gathered before sending `verto.invite` (required for mod_verto)
- `verto.bye` sent as notification (fire-and-forget), not RPC request

## Development

```bash
# Start API server (port 8080)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Start frontend (port 3000)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/call-manager run dev

# Regenerate API client after openapi.yaml changes
pnpm run --filter @workspace/api-spec codegen
```

## FreeSWITCH Testing (extension-to-extension)

1. Set `FREESWITCH_WS_URL=wss://158.180.29.84:8082/` and `FREESWITCH_DOMAIN=158.180.29.84`
2. On FreeSWITCH server, configure XML curl to call `{APP_URL}/api/freeswitch/directory`
3. User 1001 logs in on Device A, User 1002 logs in on Device B
4. Device A dials `1002` → internal free call, routes via FreeSWITCH mod_verto
5. Both devices hear audio via WebRTC
