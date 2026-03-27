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

## Building Mobile APK / IPA

```bash
npm install -g eas-cli
eas login
# Android APK (internal/preview)
eas build --platform android --profile preview
# iOS IPA (internal/preview)
eas build --platform ios --profile preview
```
