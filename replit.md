# PRawwPlus — Project Documentation

## Overview

PRawwPlus (PRaww+) — a production VoIP calling platform for South Africa, using FreeSWITCH for SIP/WebRTC calls, PayFast for payments, and custom email/password auth. Built as a pnpm monorepo.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 20
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: MongoDB + Mongoose
- **Auth**: Custom email/password with session/token store
- **Calling**: FreeSWITCH Verto WebRTC (internal calls free, external calls deduct coins) + JsSIP (mobile SIP)
- **Payments**: PayFast (South African payment gateway)
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI
- **Mobile**: React Native (Expo bare workflow) with JsSIP + WebRTC + CallKeep + Firebase FCM

## Structure

```text
prawwplus/
├── artifacts/
│   ├── api-server/            # Express API server (port: 8080, path: /api)
│   ├── call-manager/          # React + Vite web frontend (port: 3000, path: /)
│   └── call-manager-mobile/   # React Native (Expo) mobile app — PRawwPlus
├── lib/
│   ├── api-spec/              # OpenAPI spec + Orval codegen config
│   ├── api-client-react/      # Generated React Query hooks
│   ├── api-zod/               # Generated Zod schemas from OpenAPI
│   ├── db/                    # Mongoose models + MongoDB connection
│   └── auth-web/              # Auth web client hook (useAuth)
```

## Mobile App (PRawwPlus — React Native VoIP)

Located in `artifacts/call-manager-mobile/`. A production-ready managed-workflow Expo app.

### Package identifiers
- **Android**: `com.praww.prawwplus`
- **iOS**: `com.praww.prawwplus`
- **App slug**: `prawwplus`
- **URL scheme**: `prawwplus`

### Stack
- **JsSIP** — SIP signaling over WebSocket (proxied by API server at `/api/sip/ws`)
- **react-native-webrtc** — audio capture and playback for calls
- **react-native-callkeep** — system-level call UI (CallKit on iOS, Telecom on Android)
- **react-native-incall-manager** — ITU-T call progress tones, speaker/earpiece routing
- **@react-native-community/netinfo** — network state monitoring
- **@react-native-firebase/messaging** — FCM high-priority data-only push to wake app when terminated
- **expo-secure-store** — secure auth token storage (Keychain/EncryptedSharedPreferences)
- **expo-router** — file-based navigation

### Call Features Implemented
- **ITU-T call progress tones**: ringback (local + FreeSWITCH early media), ringtone, busy/congestion via FreeSWITCH
- **Call hold/unhold**: JsSIP session.hold()/unhold() with on-hold state UI
- **DTMF**: in-call keypad modal, RFC2833 via JsSIP session.sendDTMF()
- **Call waiting**: detects second incoming call while in-call, shows accept/dismiss banner
- **Call forwarding**: stored in AsyncStorage, applied before dialing
- **Do Not Disturb**: toggle blocks outgoing calls, stored in AsyncStorage
- **No-answer timeout**: 30s auto-terminate for unanswered outgoing calls
- **SIP cause mapping**: 28 SIP/FreeSWITCH cause codes mapped to user-friendly messages
- **Network monitoring**: real-time online/offline detection blocks calls when no connectivity
- **Real call history**: Recents screen wired to `/api/calls` with pull-to-refresh + call-back

### Security
- Auth token in `expo-secure-store` (hardware-backed on Android, Keychain on iOS)
- Android ProGuard/R8 enabled for release builds (`enableProguardInReleaseBuilds: true`)
- Android resource shrinking enabled (`enableShrinkResourcesInReleaseBuilds: true`)
- No secrets in code; all config via environment variables

### Setup required before build
1. Replace `google-services.json` (Android) and `ios/PRawwPlus/GoogleService-Info.plist` (iOS) with real Firebase files
2. Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` secrets (already done)
3. Run `npx expo prebuild --no-install` then build with Android Studio or Xcode
4. See `artifacts/call-manager-mobile/SETUP.md` for full instructions

## Environment Variables / Secrets

All configured in the project's environment secrets or shared env vars:

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `APP_URL` | Production domain (https://rtc.PRaww.co.za) |
| `FREESWITCH_DOMAIN` | FreeSWITCH server public IP |
| `FREESWITCH_WS_URL` | FreeSWITCH Verto WSS URL |
| `FREESWITCH_INTERNAL_WS_URL` | FreeSWITCH internal WS URL (for proxy) |
| `FREESWITCH_ESL_PORT` | ESL port (default 8021) |
| `FREESWITCH_ESL_PASSWORD` | ESL password |
| `FREESWITCH_SSH_KEY` | SSH private key for ESL tunnel |
| `FIREBASE_PROJECT_ID` | Firebase project ID (FCM) |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key |
| `SMTP_HOST` | Email server hostname |
| `SMTP_USER` | Email server username |
| `SMTP_PASS` | Email server password |
| `SMTP_FROM` | From address (no-reply@prawwplus.co.za) |
| `PAYFAST_MERCHANT_ID` | PayFast merchant ID |
| `PAYFAST_MERCHANT_KEY` | PayFast merchant key |
| `PAYFAST_PASSPHRASE` | PayFast passphrase |

## Development

```bash
# Start both services (main workflow)
PORT=8080 pnpm --filter @workspace/api-server run dev & PORT=3000 BASE_PATH=/ pnpm --filter @workspace/call-manager run dev

# Regenerate API client after openapi.yaml changes
pnpm run --filter @workspace/api-spec codegen
```

## Production URL Routing at rtc.PRaww.co.za

| Path | Service |
|------|---------|
| `/` | React frontend (call-manager) |
| `/api/*` | Express API server |
| `/api/verto/ws` | FreeSWITCH Verto WebSocket proxy (wss://) |
| `/api/sip/ws` | SIP WebSocket proxy for mobile JsSIP |
| `/api/freeswitch/directory` | FreeSWITCH XML curl directory |

## Carrier-Grade Backend Upgrades

### ESL Event Buffer (`artifacts/api-server/src/lib/eslEventBuffer.ts`)
Zero event loss system. When a CHANNEL_ANSWER or CHANNEL_HANGUP_COMPLETE event arrives over ESL but no matching DB call record exists yet (race between `POST /calls` and FreeSWITCH), the event is enqueued and retried with exponential back-off (200 ms → 1.6 s, max 5 attempts). Events per call-UUID are processed in FIFO order. Drops the event after max retries with a warning log. Buffer depth exposed on `GET /api/healthz`.

### Formal Call State Machine (`artifacts/api-server/src/lib/callStateMachine.ts`)
All valid state transitions are declared in one table:
- `initiated` → `in-progress | missed | cancelled | failed`
- `in-progress` → `completed | failed`
- Terminal states (`completed`, `missed`, `cancelled`, `failed`) accept no further transitions (idempotent).

`isTransitionAllowed()` returns `false` for already-terminal states (silently skip) and throws for genuinely invalid transitions. `causeToStatus()` maps 28 FreeSWITCH hangup causes to the correct final state.

### Central CallOrchestrator (`artifacts/api-server/src/lib/callOrchestrator.ts`)
Single source of truth for all call lifecycle logic. Removes billing code that was previously duplicated in three places:
- `answerCall(fsCallId)` — CHANNEL_ANSWER path; sets up balance timers for external calls.
- `finalizeCall(fsCallId, billsec, cause)` — CHANNEL_HANGUP_COMPLETE (ESL path); applies billing.
- `endCallById(callId, userId, duration)` — REST `/calls/:id/end` (client-reported).
- `webhookUpdate(...)` — legacy FreeSWITCH webhook compatibility.
- `deductCoinsAndUpdateStats()` — single billing implementation used by all paths.

`freeswitchESL.ts` now wires all CHANNEL_ANSWER / CHANNEL_HANGUP_COMPLETE events through the buffer → orchestrator pipeline. `routes/calls.ts` delegates `/end` and `/webhook` to the orchestrator.

## Bug Fixes Applied

| Bug | File | Fix |
|-----|------|-----|
| FreeSWITCH directory `user_context` was `"default"` — SIP channels joined wrong dialplan | `api-server/src/routes/verto.ts` | Changed to `"call_manager"` so all channels stay in our isolated dialplan |
| XML injection in directory handler | `api-server/src/routes/verto.ts` | Added `xmlEscape()` for `displayName` and `fsPassword` before embedding in XML |
| DialPad race: `makeVertoCall` fired before DB record existed | `call-manager/src/pages/DialPad.tsx` | Pre-generate UUID → `initiateCall` first → `makeVertoCall(uuid)` |
| Contacts race: same `makeVertoCall` before `initiateCall` issue | `call-manager/src/pages/Contacts.tsx` | Same fix as DialPad (pre-generate UUID, DB record first) |
| OpenAPI spec used `phoneNumber` but backend/DB/generated client used `number` | `lib/api-spec/openapi.yaml` | Renamed to `number`; added `fromPhone` to `CreateContactRequest`; re-ran codegen |
| Extension assignment race under concurrent signups | `lib/db/src/models/User.ts`, `extension.ts` | Added `unique: true` to sparse extension index; retry loop (up to 10×) on duplicate-key error |
| Web `causeToEndStatus` sent `"busy"`/`"no-answer"` (invalid status values) | `call-manager/src/pages/CallingScreen.tsx` | Remapped `USER_BUSY`/`CALL_REJECTED` → `"cancelled"`, `NO_ANSWER` → `"missed"` |
| Web: Verto connection drop stored as `"completed"` (undefined cause) | `call-manager/src/pages/CallingScreen.tsx` | Changed default case in `causeToEndStatus` to return `"failed"` |
| Mobile: call DB record ID was discarded after creation | `call-manager-mobile/context/CallContext.tsx` | Stored ID in `dbCallIdRef`, call `POST /calls/:id/end` on hang-up |
| Mobile: no-answer timer fired `"No Answer"` (mixed case); didn't match `"NO_ANSWER"` check | `call-manager-mobile/lib/voipEngine.ts` | Changed timer to emit `"NO_ANSWER"` (uppercase, matching FreeSWITCH convention) |
| `endCallById` (REST path) never stored `failReason` for non-completed calls | `api-server/src/lib/callOrchestrator.ts` | Added `failReason` mapping for `missed`/`cancelled`/`failed` statuses |
| Stale cleanup applied 15-min threshold to `in-progress` calls — active long calls wrongly failed | `api-server/src/lib/startup.ts` | Split: `initiated` → 15-min threshold; `in-progress` → fail immediately on restart |
| `POST /calls` missing `direction` field; callee never got inbound call history record | `lib/db/src/models/Call.ts`, `api-server/src/routes/calls.ts`, `CallContext.tsx` | Added `direction: "inbound"\|"outbound"` to schema; callee creates record on answer |
| Fire-and-forget `POST /calls/:id/end` silently dropped on network failure | `call-manager-mobile/lib/callEndQueue.ts` | Persistent `AsyncStorage` retry queue with auto-flush on foreground + network reconnect |
| Mobile API calls had no timeout — hung indefinitely on poor networks | `call-manager-mobile/lib/api.ts` | Added 10 s `AbortController` timeout to every `apiRequest` call |
| Production mobile build fell back to `http://localhost:8080` silently | `call-manager-mobile/lib/api.ts` | Throws at startup if `EXPO_PUBLIC_DOMAIN` is unset in production builds |
| Invalid state transitions logged at `debug` level — invisible in production | `api-server/src/lib/callOrchestrator.ts`, `eslEventBuffer.ts` | Promoted to `warn` level |

## Mobile Reliability Features

### Call-End Retry Queue (`call-manager-mobile/lib/callEndQueue.ts`)
Persistent `AsyncStorage`-backed queue for `POST /calls/:id/end` requests that fail due to network loss or server unavailability. Items are replayed automatically:
- On app foreground (`AppState "active"` event)
- On network reconnection (via `networkMonitor`)
- On next successful login / SIP register

Items expire after 24 hours and are discarded after 10 failed attempts. `404` and `401` responses cause immediate discard (record gone / session expired).

### API Status UI (`call-manager-mobile/app/(tabs)/index.tsx`)
The dialpad screen shows contextual banners:
- 🟡 **"Server unavailable — retrying in background"** — when an API call returns 5xx or connection is refused
- 🟡 **"Connection timeout — check your network"** — when a request times out after 10 s
- 🔴 **Call failure reason** — SIP-level errors shown as before

### Inbound Call History
When a mobile user answers an incoming call, `POST /calls` is called with `direction: "inbound"` and the caller's extension as `recipientNumber`. This creates a call history record for the callee, so both parties have a record of the call. The record is finalized via the same `callEndQueue` path as outbound calls.

## Building Mobile APK / IPA

```bash
npm install -g eas-cli
eas login
# Android APK (internal/preview)
eas build --platform android --profile preview
# iOS IPA (internal/preview)
eas build --platform ios --profile preview
```
