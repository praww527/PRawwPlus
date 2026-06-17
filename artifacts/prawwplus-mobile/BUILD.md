# PRawwPlus Mobile — EAS Build Guide

## Prerequisites

1. **EAS CLI** (>= 14.0.0)
   ```
   npm install -g eas-cli
   eas login
   ```

2. **Project configured** — `eas.json` and `app.json` are already set up for the `development` profile.

3. **Service credentials** — A valid `google-services.json` must exist at `artifacts/prawwplus-mobile/google-services.json` before building (already present in repo).

---

## Trigger the Android development build (debug APK)

Run from the **`artifacts/prawwplus-mobile/`** directory:

```bash
cd artifacts/prawwplus-mobile
eas build --platform android --profile development
```

This builds via EAS cloud servers and outputs a download URL when complete.

- Build profile: `development`
- Build type: `apk` (`:app:assembleDebug`)
- Distribution: `internal`
- `developmentClient: true` — requires the `expo-dev-client` package (already installed)

---

## Download & install the APK

1. **Download** — EAS prints a URL at the end of the build, or visit https://expo.dev/accounts/praww/projects/prawwplus-mobile/builds

2. **Install via ADB** (USB cable, USB debugging enabled on device):
   ```bash
   adb install /path/to/downloaded/prawwplus.apk
   ```

3. **Install over WiFi** (alternative):
   - Enable "Install from unknown sources" on the device
   - Open the QR code or URL from the EAS build page directly on the device

---

## What the development build contains

| Feature | Status |
|---|---|
| expo-dev-client (dev menu) | ✅ included |
| react-native-callkeep (ConnectionService) | ✅ via app.json plugin |
| @react-native-firebase/messaging (FCM) | ✅ via app.json plugin |
| react-native-webrtc | ✅ included (native build only) |
| react-native-incall-manager | ✅ included |
| New Architecture (Bridgeless) | ✅ enabled |

---

## Run the Metro dev server (after APK is installed)

```bash
cd artifacts/prawwplus-mobile
npx expo start --dev-client
```

The device will connect to Metro automatically when the app opens (dev menu → scan QR or enter IP manually).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App crashes immediately on launch | Check that `google-services.json` is valid and `android.package` matches Firebase project |
| CallKeep / MANAGE_OWN_CALLS permission dialog missing | Ensure `selfManaged: true` in callKeepService setup and device is Android 10+ |
| FCM push not delivered in background | Verify the FCM server key in the API server matches the `google-services.json` project |
| WebRTC audio not working | Grant RECORD_AUDIO permission on first launch; check ICE server config in `/verto/config` |
| Metro connection refused | Ensure phone and development machine are on the same WiFi network |
