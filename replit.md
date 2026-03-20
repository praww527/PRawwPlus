# Call Manager Workspace

## Overview

Business-grade call management application with Telnyx integration for VoIP calls, PayFast for South African payments, and Replit Auth for user authentication. Built as a pnpm monorepo.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: MongoDB + Mongoose
- **Auth**: Replit Auth (OpenID Connect with PKCE)
- **Calling**: Telnyx API
- **Payments**: PayFast (South African payment gateway)
- **Frontend**: React + Vite + Tailwind CSS

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port: 8080, path: /api)
│   └── call-manager/       # React + Vite frontend (port: 20950, path: /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Mongoose models + MongoDB connection
│   └── replit-auth-web/    # Replit Auth web client hook (useAuth)
├── scripts/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Business Logic

### Subscription Model
- Plan: R100/month
- Monthly payment grants R20 of call credit
- Credit balance resets only upon confirmed PayFast payment (via ITN webhook)
- If balance is 0 or subscription inactive, calls are blocked

### PayFast Integration
- Sandbox: `https://sandbox.payfast.co.za/eng/process`
- Production: `https://www.payfast.co.za/eng/process`
- Set `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` secrets
- Without secrets, sandbox test credentials are used automatically
- Webhook: `POST /api/payments/webhook` (PayFast ITN)

### Telnyx Integration
- Set `TELNYX_API_KEY` and `TELNYX_SIP_CONNECTION_ID` secrets
- Without secrets, calls are logged without actual dialing
- Webhook: `POST /api/calls/webhook` (Telnyx call events)

### User Roles
- Regular users: manage own calls, subscription, credits
- Admin users: set `isAdmin: true` in MongoDB directly or via adjust-credit API

## Environment Variables / Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `REPL_ID` | Auto | Replit app ID (for OIDC) |
| `TELNYX_API_KEY` | Optional | Telnyx API key for real calls |
| `TELNYX_SIP_CONNECTION_ID` | Optional | Telnyx SIP connection ID |
| `PAYFAST_MERCHANT_ID` | Optional | PayFast merchant ID (sandbox used if absent) |
| `PAYFAST_MERCHANT_KEY` | Optional | PayFast merchant key |
| `PAYFAST_PASSPHRASE` | Optional | PayFast passphrase for signature |

## MongoDB Models

- `User` — user accounts, credit balances, subscription state
- `Session` — Replit Auth session store (TTL index on expire field)
- `Call` — call records with duration and cost
- `Payment` — payment records with PayFast IDs

## API Routes

### Auth
- `GET /api/auth/user` — current user info
- `GET /api/login` — OIDC login redirect
- `GET /api/callback` — OIDC callback
- `GET /api/logout` — logout

### Users
- `GET /api/users/me` — full profile with credit/subscription

### Calls
- `GET /api/calls` — call history (paginated)
- `POST /api/calls` — initiate call
- `GET /api/calls/:id` — single call
- `POST /api/calls/webhook` — Telnyx ITN webhook

### Payments
- `POST /api/payments/subscribe` — initiate subscription (R100)
- `POST /api/payments/webhook` — PayFast ITN webhook
- `GET /api/payments/history` — payment history
- `POST /api/credits/topup` — top-up credits

### Admin
- `GET /api/admin/stats` — platform statistics
- `GET /api/admin/users` — list all users
- `GET /api/admin/users/:id` — user detail
- `POST /api/admin/users/:id/adjust-credit` — adjust credit
- `GET /api/admin/calls` — all calls across platform

## Development

```bash
# Start API server
pnpm --filter @workspace/api-server run dev

# Start frontend
pnpm --filter @workspace/call-manager run dev
```
