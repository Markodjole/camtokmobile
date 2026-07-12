# Google Maps setup (CamTok mobile)

Native live map uses `react-native-maps` + `PROVIDER_GOOGLE`. The API key is
injected by `app.config.js` from env / EAS build env into Android + iOS native
config. **A new native build is required** after changing the key.

## Enable now (map display only)

In [Google Cloud Console](https://console.cloud.google.com/) on the project that owns key `AIzaSyDGhYpdm871g74WzlW1xRXrTTfiM_NVixs`:

1. **Billing** — link a billing account (required even to use the free credit).
2. Enable these APIs:
   - **Maps SDK for Android** ← required for Android map tiles
   - **Maps SDK for iOS** ← only if you run on iPhone with `PROVIDER_GOOGLE`
3. On the API key:
   - Application restriction: Android apps → package `com.camtok.mobile` + your SHA-1 (optional but recommended)
   - API restriction: allow **Maps SDK for Android** (and iOS if used)
4. Rebuild the app so the key is baked in:
   ```bash
   yarn build:dev:android
   # or production / preview profile as needed
   ```

Maps SDK map loads are covered by Google’s ~$200/mo free credit for normal usage.

## Keep locked for now (premium / billable REST APIs)

Do **not** need to enable these for a working map. Mobile destination search already prefers Nominatim; backend can keep these disabled:

| API | Used for |
|-----|----------|
| Places API (Autocomplete) | Destination typeahead via backend |
| Places API (Details / Nearby) | Resolve place IDs, POIs |
| Geocoding API | Reverse/forward geocode |
| Directions API / Routes API | Google suggested driving routes |
| Maps Static API | Optional; not required for SDK map |

Backend flag reference (`camtok`): `GOOGLE_MAPS_APIS_DISABLED`, `GOOGLE_ROUTES_ENABLED`.

## Already wired in this repo

- `eas.json` — `GOOGLE_MAPS_ANDROID_API_KEY` on development / preview / production
- `.env` — same key for local `app.config.js`
- `app.config.js` — writes Android `googleMaps.apiKey` + iOS `googleMapsApiKey`
- `LiveMap.native.tsx` — `PROVIDER_GOOGLE` (unchanged; no OSM fallback)
