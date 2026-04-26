# Google Maps Android API Key Setup

The Android dev client needs a Google Maps SDK for Android API key to render the map. This is **free** for typical usage (Google's Maps SDK for Android has no quota cost).

## Steps to create the key

1. Open https://console.cloud.google.com/google/maps-apis/credentials in any browser, sign in with a Google account.

2. **Create or pick a project**
   - Click the project dropdown in the top bar.
   - Either pick an existing project or click "New Project" → name it (e.g. `camtok-mobile`) → Create.

3. **Enable the Maps SDK for Android**
   - Go to https://console.cloud.google.com/google/maps-apis/api-list
   - Find "Maps SDK for Android" → click it → click "Enable".

4. **Create the API key**
   - Go back to Credentials: https://console.cloud.google.com/google/maps-apis/credentials
   - Click "Create credentials" → "API key".
   - Copy the key — it starts with `AIza` and is ~39 characters long, e.g. `AIzaSyA-abcdefghijklmnopqrstuvwxyz0123456`.

5. **(Recommended) Restrict the key to Android apps only**
   - Click the new key, then under "Application restrictions" pick "Android apps".
   - Add the package name `com.camtok.mobile` and the SHA‑1 fingerprint from your EAS build credentials (you can find this with `npx eas credentials`).
   - Under "API restrictions" → restrict to "Maps SDK for Android".
   - Save.

6. **Paste the key back to the assistant** in chat (just the `AIza...` string), or set it manually:
   - In `.env`: `GOOGLE_MAPS_ANDROID_API_KEY=AIzaSy...`
   - Or as an EAS secret: `npx eas-cli env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value AIzaSy... --visibility sensitive --environment development`.

7. After the key is in place, a new EAS Android dev build is required so it bakes into `AndroidManifest.xml`:
   ```bash
   npx eas-cli build --platform android --profile development
   ```

## Pricing note

The Maps SDK for Android is part of Google's $200/month free credit (effectively unlimited for personal/dev usage). You will not be charged unless your app gets thousands of daily map views and you go past the free tier.
