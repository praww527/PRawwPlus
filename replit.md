# Call Manager Workspace

## Overview

Telecom call management application with Telnyx integration for VoIP calls, PayFast for South African payments, and custom email/password auth. Built as a pnpm monorepo.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: MongoDB + Mongoose
- **Auth**: Custom email/password with session store
- **Calling**: Telnyx API (uses owned phone number as caller ID)
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
├── scripts/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Business Logic

### Subscription Plans
- **Basic**: R59/month → max 1 phone number
- **Pro**: R109/month → max 2 phone numbers
- Must subscribe before accessing numbers or making calls
- If subscriptionActive = false → block access to numbers and calling

### Wallet / Coins System
- Users have a coin wallet (stored as `coins` field on User)
- 1 coin = R0.90
- Top up via PayFast (min R10)
- Coins deducted: 1 coin per minute of call time
- If coins reach 0 → call cannot be made (enforced server-side)

### Phone Numbers
- Numbers sourced from Telnyx (synced via API on each `/numbers` load)
- Stored in `PhoneNumber` collection with `userId` (null = free)
- Users can claim free numbers up to their plan limit
- **Number change**: R100 one-off fee via PayFast — releases old, assigns new after payment confirmed

### Calling
- Calls use the user's owned phone number as caller ID
- Telnyx API used for actual dialing
- Webhook (`POST /api/calls/webhook`) tracks answered/hangup events
- Cost calculated on hangup: `ceil(duration_minutes) * 1 coin`
- Without Telnyx secrets: calls are logged without actual dialing

### PayFast Integration
- Sandbox: `https://sandbox.payfast.co.za/eng/process` (used when no merchant ID set)
- Production: `https://www.payfast.co.za/eng/process`
- Webhook: `POST /api/payments/webhook` (PayFast ITN)
- `custom_str1` = userId, `custom_str2` = plan (for subscriptions)
- `paymentType` in Payment model: `subscription` | `topup` | `number_change`

## Environment Variables / Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `TELNYX_API_KEY` | Optional | Telnyx API key for real calls + number sync |
| `TELNYX_SIP_CONNECTION_ID` | Optional | Telnyx SIP connection ID |
| `PAYFAST_MERCHANT_ID` | Optional | PayFast merchant ID (sandbox if absent) |
| `PAYFAST_MERCHANT_KEY` | Optional | PayFast merchant key |
| `PAYFAST_PASSPHRASE` | Optional | PayFast passphrase for signature |

## MongoDB Models

- `User` — user accounts, coins balance, subscription plan/status
- `Session` — session store (TTL index on expire)
- `Call` — call records with duration and coin cost
- `Payment` — payment records (subscription/topup/number_change)
- `PhoneNumber` — available numbers with userId ownership

## API Routes

### Auth
- `POST /api/auth/signup` — register
- `POST /api/auth/login` — login
- `POST /api/auth/verify-email` — verify email token
- `POST /api/auth/resend-verification` — resend verification
- `POST /api/auth/forgot-password` — request reset
- `POST /api/auth/reset-password` — reset password
- `GET /api/auth/user` — current user info
- `GET /api/logout` — logout

### Users
- `GET /api/users/me` — full profile with coins/subscription

### Numbers
- `GET /api/numbers` — list all numbers (syncs from Telnyx)
- `POST /api/numbers/select` — claim a free number
- `POST /api/numbers/change` — initiate number change (R100 PayFast)

### Calls
- `GET /api/calls` — call history (paginated)
- `POST /api/calls` — initiate call (uses owned number as caller ID)
- `GET /api/calls/:id` — single call
- `POST /api/calls/webhook` — Telnyx ITN webhook

### Payments
- `POST /api/payments/subscribe` — initiate subscription (basic R59 / pro R109)
- `POST /api/payments/webhook` — PayFast ITN webhook
- `GET /api/payments/history` — payment history
- `POST /api/credits/topup` — top-up wallet coins

### Admin
- `GET /api/admin/stats` — platform statistics
- `GET /api/admin/users` — list all users
- `GET /api/admin/users/:id` — user detail
- `POST /api/admin/users/:id/adjust-credit` — adjust user coins
- `GET /api/admin/calls` — all calls across platform

## Frontend Pages

- `/` — Public landing page
- `/login`, `/signup` — Auth
- `/verify-email`, `/forgot-password`, `/reset-password` — Auth flows
- `/dashboard` — Dial pad (protected)
- `/calls` — Call history (protected)
- `/numbers` — Phone number management (protected)
- `/profile` — Subscription, wallet top-up, payment history (protected)
- `/admin` — Admin dashboard (admin only)

## Development

```bash
# Start API server (port 8080)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Start frontend (port 3000)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/call-manager run dev

# Regenerate API client after openapi.yaml changes
cd lib/api-spec && pnpm exec orval --config orval.config.ts
```
