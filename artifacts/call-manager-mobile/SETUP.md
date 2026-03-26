# PRawwPlus Mobile — Build & Setup Guide

## Overview

This is a React Native bare-workflow VoIP app using JsSIP + WebRTC + CallKeep + Firebase FCM.

---

## Prerequisites

- Node.js 20+, pnpm 9+
- Android Studio (for Android) or Xcode 15+ (for iOS)
- A Firebase project
- FreeSWITCH with SIP/WS enabled on port 5066

---

## 1. Firebase Setup

### Create a Firebase project

1. Go to <https://console.firebase.google.com>
2. Create a new project (or use an existing one)
3. Enable **Cloud Messaging** (FCM) under Project Settings → Cloud Messaging

### Android

1. Click **Add app → Android**; set the package name to `com.prawwplus.mobile`
2. Download **`google-services.json`** and replace the placeholder at:
   ```
   artifacts/call-manager-mobile/google-services.json
   ```

### iOS

1. Click **Add app → iOS**; set the bundle ID to `com.prawwplus.mobile`
2. Download **`GoogleService-Info.plist`** and replace the placeholder at:
   ```
   artifacts/call-manager-mobile/ios/PRawwPlus/GoogleService-Info.plist
   ```

### Backend environment variables

Set these on the API server (already added to Replit Secrets):

```
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Generate a service account key: Firebase Console → Project Settings → Service Accounts → Generate New Private Key.

---

## 2. iOS: Push Notification Certificate

For `react-native-callkeep` to trigger CallKit via VoIP push:

1. In Apple Developer Portal, create a **VoIP Services Certificate** for bundle ID `com.prawwplus.mobile`
2. Export as `.p12` and upload to Firebase Console → Project Settings → Cloud Messaging → iOS app → VoIP Certificate

---

## 3. Building

### Install dependencies

```bash
cd artifacts/call-manager-mobile
pnpm install
```

### Run prebuild (regenerate native folders)

```bash
npx expo prebuild --no-install
```

### Android

```bash
npx expo run:android
# or open android/ in Android Studio and run from there
```

### iOS

```bash
cd ios && pod install && cd ..
npx expo run:ios
# or open ios/PRawwPlus.xcworkspace in Xcode
```

---

## 4. Key Architecture

| Layer | Library | Role |
|---|---|---|
| SIP signaling | JsSIP | Registers with FreeSWITCH via WebSocket |
| Audio media | react-native-webrtc | Captures mic / plays remote audio |
| Native call UI | react-native-callkeep | Shows system incoming call screen (CallKit / Telecom) |
| Speaker switching | react-native-incall-manager | Controls earpiece/speaker audio routing |
| Background wake | Firebase FCM (data-only) | High-priority push wakes app when terminated |
| Backend | FreeSWITCH ESL | Sends FCM on incoming call, bridges SIP + Verto |

### Call flow (incoming)

```
FreeSWITCH → ESL handler
  └─ HTTP v1 FCM data push to device
       └─ FCM background handler (index.js) wakes app
            └─ JsSIP UA receives SIP INVITE over WS
                 └─ react-native-callkeep shows system call UI
                      └─ User answers → WebRTC audio session begins
```

---

## 5. SIP WebSocket Proxy

The API server (`artifacts/api-server`) exposes a SIP/WS proxy at `/api/sip/ws` that bridges the mobile client to FreeSWITCH on port 5066. This avoids exposing FreeSWITCH directly to the internet and allows re-use of the existing JWT authentication flow.

---

## 6. EAS Build (APK / IPA without local toolchain)

```bash
# Install EAS CLI
npm install -g eas-cli

# Log in to Expo
eas login

# Build Android APK for internal distribution
eas build --platform android --profile preview

# Build iOS IPA for internal distribution
eas build --platform ios --profile preview
```

The `preview` profile produces a distributable APK (Android) or IPA (iOS) that can be installed directly on devices. Use the `production` profile for App Store / Play Store submissions.

---

## 7. Troubleshooting

| Issue | Fix |
|---|---|
| No incoming calls when app closed | Verify FCM `google-services.json` is real (not placeholder) and `FIREBASE_*` backend env vars are set |
| CallKit doesn't show | iOS VoIP entitlement must be provisioned in Apple Dev Portal; check `aps-environment` in entitlements |
| Audio not working | Check `RECORD_AUDIO` permission is granted at runtime (Android) and microphone usage description is set (iOS) |
| SIP registration fails | Confirm FreeSWITCH WS port 5066 is reachable from API server and SIP profile XML was applied |
| Speaker toggle not working | Ensure `react-native-incall-manager` is installed and linked via `npx expo prebuild` |
