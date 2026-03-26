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
│   └── auth-web/           # Auth web client hook (useAuth)
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
2. Frontend establishes WebSocket to FreeSWITCH Verto endpoint (proxied at `/api/verto/ws`)
3. Login via JSON-RPC `login` + `verto.clientReady` handshake
4. Outgoing call: `verto.invite` with full ICE-gathered SDP offer
5. `verto.media` → remote is ringing (early media SDP applied ONCE as remote description)
6. `verto.answer` → call connected (remote SDP skipped if already set by verto.media)
7. Incoming call: server sends `verto.invite` → client shows IncomingCallScreen
8. Hangup: `verto.bye` from either side
9. On call end, frontend calls `POST /api/calls/:id/end` with duration → backend deducts coins

### Call Phases (frontend)
`calling` → `ringing` → `connected` → `ended`
- **calling**: `verto.invite` sent, awaiting first response
- **ringing**: `verto.media` received (remote side is ringing, early media flowing)
- **connected**: `verto.answer` received, timer starts
- **ended**: `verto.bye` or user hang-up

### SDP Safety Rule
`remoteSdpSet` flag in `VertoClient` ensures `setRemoteDescription` is called exactly once.
`verto.media` sets the flag; `verto.answer` skips if flag is already set. This prevents the
`InvalidStateError: Cannot set remote answer in state have-remote-answer` that causes no audio.

### Coin Deduction
- Internal calls (extensions): **0 coins** always
- External calls: `ceil(duration_minutes) * 1 coin` deducted on call end
- External calls require active subscription + non-zero coin balance
- **Mid-call enforcement (ESL)**: on `CHANNEL_ANSWER`, ESL schedules a `uuid_kill` API
  command timed to fire when the user's balance would be exhausted. Cancelled on early hangup.

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
- `POST /api/admin/users/:id/verify-email` — manually verify a user's email (bypass email flow)
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
| `APP_URL` | **Required for production** | `https://rtc.PRaww.co.za` — always takes priority over all other domain sources. All email links, PayFast URLs, FreeSWITCH XML curl, and Verto WSS proxy use this value. |
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
- FreeSWITCH authenticates users via `mod_xml_curl` calling:
  `GET https://{APP_URL}/api/freeswitch/directory?user={extension}&domain={domain}`
- FreeSWITCH config lives at `/usr/local/freeswitch/conf/` on the remote server
- **ESL Listener**: API server connects to FreeSWITCH Event Socket (port 8021) via an SSH tunnel over port 22 (bypasses Oracle Cloud firewall). Listens for `CHANNEL_ANSWER` and `CHANNEL_HANGUP_COMPLETE` to update call records in real time.
- **Admin routes** (requires isAdmin=true):
  - `GET /api/freeswitch/status` — ESL connection state + config URLs
  - `POST /api/freeswitch/configure` — push XML config files to FreeSWITCH via SSH and reload
  - `POST /api/freeswitch/test-ssh` — verify SSH connectivity
- Our server provisions user extensions starting at 1001 on startup
- Non-trickle ICE used — full SDP gathered before sending `verto.invite` (required for mod_verto). ICE timeout is 8 seconds.
- `verto.bye` sent as notification (fire-and-forget), not RPC request
- 5 Google STUN servers configured for ICE candidate fallback
- Remote audio autoplay: if blocked by browser policy, resumes on next user click/touch
- Call overlays (CallingScreen, IncomingCallScreen) use `z-[9999]` to always appear above navigation and any modals
- Production domain: `rtc.PRaww.co.za` — set via `APP_URL` env var, governs all WSS, email, PayFast, and XML curl URLs

## Production Deployment (rtc.PRaww.co.za — self-hosted)

The system is self-hosted. `rtc.PRaww.co.za` points directly to the production server via a DNS A record. Replit is used only for development.

### Domain Priority Logic
`APP_URL` → request headers (x-forwarded-host/host). When `APP_URL=https://rtc.PRaww.co.za` is set, it governs every service without exception. CORS is tightly scoped to `APP_URL` only when it is set. `ALLOWED_ORIGINS` can be set to a comma-separated list for multi-domain setups.

### URL Routing at rtc.PRaww.co.za
| Path | Service |
|------|---------|
| `/` | React frontend (call-manager) |
| `/api/*` | Express API server |
| `/api/verto/ws` | FreeSWITCH Verto WebSocket proxy (wss://) |
| `/api/freeswitch/directory` | FreeSWITCH XML curl directory |

### DNS Setup
```
rtc.PRaww.co.za  A  <your-server-public-ip>
```
TLS is terminated by your reverse proxy (nginx/caddy) in front of the API server.

### WebRTC RTP Configuration
The FreeSWITCH `verto.conf` generated by `freeswitchConfig.ts` sets:
- `rtp-ip = 0.0.0.0` — binds RTP sockets on all interfaces (critical for Oracle Cloud VMs with private + public NICs)
- `ext-rtp-ip` / `ext-sip-ip` = `158.180.29.84` — advertised public IP in ICE candidates / SDP
- `apply-candidate-acl = any_v4.auto` — accepts all IPv4 ICE candidates from browser clients
- STUN enabled for IP validation; `stun-auto-disable=false` to prevent fallback to private IP

### Checklist before going live
1. ✅ `APP_URL=https://rtc.PRaww.co.za` — set
2. ✅ `FREESWITCH_DOMAIN=158.180.29.84` — set
3. ✅ `FREESWITCH_WS_URL=wss://158.180.29.84:8082/` — set (not used by proxy; proxy uses FREESWITCH_INTERNAL_WS_URL)
4. ✅ `FREESWITCH_INTERNAL_WS_URL=ws://158.180.29.84:8081/` — set (used by Verto proxy)
5. ☐ Set `MONGODB_URI`, `SESSION_SECRET`, `SMTP_*` on your server
6. ☐ FreeSWITCH XML curl: push config via Admin → `/api/freeswitch/configure` so `mod_xml_curl` calls `https://rtc.PRaww.co.za/api/freeswitch/directory`
7. ☐ Ensure UDP ports 16384–32768 are open on the FreeSWITCH server firewall for RTP traffic

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
