# Google Maps setup (CamTok mobile)

Native live map uses `react-native-maps` + `PROVIDER_GOOGLE`. The API key is
injected by `app.config.js` / EAS `env` into AndroidManifest as
`com.google.android.geo.API_KEY`. **JS reload cannot fix a blank map** — only a
native APK build can change the baked-in key.

## Verified on build `00b309f9` (2026-07-12)

- APK **does** contain:
  - `com.google.android.geo.API_KEY` = `AIzaSyDGhYpdm871g74WzlW1xRXrTTfiM_NVixs`
  - package `com.camtok.mobile`
- Metro logs `[LiveMap] Google MapView ready` → MapView mounts fine.
- Blank / grey map with “ready” = **Google rejects tile downloads** for this key
  (restrictions / API allow-list), not a React bug.

### EAS Android signing SHA-1 (must match GCP key restriction)

```
d9597f77a4871dedcf1828134ff1208d6bcf8239
```

SHA-256 (optional):

```
56573eea1d20a4e45cdb7a4d1c32507b09c45dad0169dccf63fd8efaa812c5fb
```

## Fix in Google Cloud (do this now)

Open the key used above:
https://console.cloud.google.com/apis/credentials

1. **Billing** linked on that project.
2. Enable **Maps SDK for Android** (Libraries).
3. Edit the API key:
   - **Application restrictions**
     - Temporarily set to **None** to verify tiles appear, **or**
     - **Android apps** → add:
       - Package name: `com.camtok.mobile`
       - SHA-1: `d9597f77a4871dedcf1828134ff1208d6bcf8239`
     - Do **not** use “HTTP referrers” for this mobile key.
   - **API restrictions**
     - Include at least **Maps SDK for Android**
     - (Places/Geocoding can stay separate / locked)
4. Save → wait 1–5 minutes → kill & reopen the app (no rebuild needed if the
   key string is unchanged).

## Keep locked (billable REST)

Places Autocomplete / Details, Geocoding (if unused), Directions / Routes.

## Already wired

- `eas.json` development/preview/production → `GOOGLE_MAPS_ANDROID_API_KEY`
- `.env` → same key for local `expo config`
- `app.config.js` → Android + iOS native config injection
