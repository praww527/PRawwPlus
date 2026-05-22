# PRaww+ Android APK — Build Guide

## What's already done for you

| Component | Status |
|---|---|
| React Native app (`artifacts/prawwplus-mobile`) | Complete |
| Firebase project + `google-services.json` | Real credentials in repo |
| FCM push notifications (foreground + background + killed-state) | Wired |
| CallKeep (native incoming call screen) | Wired |
| JsSIP + WebRTC (VoIP audio) | Wired |
| SIP/WS proxy on API server (`/api/sip/ws`) | Live |
| All Android permissions | Declared in `app.json` |
| EAS build profiles (dev / preview APK / production APK / AAB) | Configured |

You only need to do steps 1–3 below to get a working APK.

---

## Step 1 — Create an Expo account (free)

1. Go to <https://expo.dev> and sign up (free account is sufficient)
2. Remember your **username** — you need it in step 2

---

## Step 2 — Update `app.json` with your Expo username

Open `artifacts/prawwplus-mobile/app.json` and set `owner` to your Expo username:

```json
{
  "expo": {
    "owner": "YOUR_EXPO_USERNAME",
    ...
  }
}
```

---

## Step 3 — Build the APK with EAS (no Android Studio needed)

EAS Build runs the Android build in Expo's cloud — you don't need Android Studio, a JDK, or Gradle locally.

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Log in to your Expo account
eas login

# Go to the mobile app directory
cd artifacts/prawwplus-mobile

# Build an APK (internal distribution — installs directly on any Android device)
eas build --platform android --profile preview
```

EAS will:
- Upload your code to Expo's build servers
- Run `expo prebuild`, Gradle, and sign the APK
- Give you a download link when it's done (usually 5–15 minutes)

### Build profiles available

| Profile | Output | Use for |
|---|---|---|
| `preview` | APK | Internal testing — install directly on device |
| `production` | APK | Production distribution outside Play Store |
| `production-aab` | AAB (App Bundle) | Google Play Store submission |

All `preview` and `production` builds automatically point to `https://rtc.praww.co.za/api`.

---

## Step 4 — Verify backend env vars for FCM push

For incoming calls to wake the app when it's killed, the API server needs these in `.env`:

```
FIREBASE_PROJECT_ID=prawwplus-1324c
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@prawwplus-1324c.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Get the service account key from:  
**Firebase Console → Project Settings → Service Accounts → Generate new private key**

---

## How incoming calls work (end-to-end)

```
Caller dials a number
  └─ FreeSWITCH receives the call via SIP trunk
       └─ ESL handler fires → API server looks up callee's FCM token
            └─ API sends high-priority FCM data push to device
                 └─ Android wakes the app (even if killed)
                      └─ Background handler in index.js runs
                           └─ react-native-callkeep shows native call screen
                                └─ User answers → JsSIP + WebRTC audio begins
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No incoming call when app is closed | Check `FIREBASE_*` env vars on VPS; confirm `google-services.json` is the real one from Firebase Console |
| "Cannot find module @react-native-firebase/messaging" | Run `npx expo prebuild --no-install` first, then rebuild |
| Audio works in one direction only | In `.env`: set `FREESWITCH_DOMAIN` to your VPS public IP (not 127.0.0.1) |
| SIP registration fails | Confirm port 5066 is open on VPS and FreeSWITCH SIP/WS profile is active |
| APK installs but crashes on launch | Run `eas build --platform android --profile development` and use Expo Dev Client to see the crash logs |
| "owner" mismatch error in EAS | Update `"owner"` in `app.json` to your Expo username |
