# CamTok Mobile

React Native (Expo) client for the CamTok live-streaming + betting platform.
It reuses the same Supabase database and Next.js API routes as the web app in
`../camtok`, so there is only one backend to run and one set of data to
maintain.

## Stack

| Area            | Choice                                                  |
| --------------- | ------------------------------------------------------- |
| Framework       | Expo 52 + Expo Router (file-based routing)              |
| Language        | TypeScript (strict)                                     |
| Styling         | NativeWind (Tailwind for RN)                            |
| Data fetching   | TanStack Query v5                                       |
| Auth / DB       | Supabase (shared with web) via `@supabase/supabase-js`  |
| Secure storage  | `expo-secure-store` (Keychain / Keystore)               |
| Maps            | `react-native-maps`                                     |
| Location        | `expo-location`                                         |

## Folder layout

```
camtokmobile/
├── app/                        # Expo Router routes (screens)
│   ├── _layout.tsx             # Root providers + auth gate
│   ├── index.tsx               # "/" redirect
│   ├── (auth)/                 # Signed-out stack
│   │   ├── login.tsx
│   │   └── signup.tsx
│   ├── (tabs)/                 # Signed-in bottom tabs
│   │   ├── _layout.tsx
│   │   ├── live.tsx            # Live rooms feed
│   │   ├── feed.tsx
│   │   ├── wallet.tsx
│   │   └── profile.tsx
│   └── room/[roomId].tsx       # Full-screen live room
├── src/
│   ├── components/
│   │   ├── ui/                 # Button / Input / Card / Screen
│   │   └── live/               # LiveMap, BettingPanel
│   ├── hooks/                  # useLiveFeed, useLiveRoom, ...
│   ├── lib/                    # env, supabase, api, format helpers
│   ├── providers/              # AuthProvider, QueryProvider
│   └── types/                  # Shared domain types
├── app.json                    # Expo config
├── babel.config.js
├── metro.config.js
├── tailwind.config.js
└── global.css                  # Tailwind entry (consumed by NativeWind)
```

## Getting started

1. **Install dependencies**

   ```bash
   cd camtokmobile
   pnpm install      # or npm / yarn / bun
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Fill in:

   - `EXPO_PUBLIC_API_BASE_URL` — URL of the running `camtok` web app.
     When testing on a physical device, use your machine's LAN IP
     (e.g. `http://192.168.1.42:3000`), not `localhost`.
   - `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` — the
     same values the web app uses. The anon key is safe to ship in the
     client bundle; never put the service-role key here.

3. **Run the backend** (from the `camtok` repo)

   ```bash
   cd ../camtok
   pnpm dev          # runs Next.js on :3000
   ```

4. **Run the app**

   ```bash
   cd ../camtokmobile
   pnpm start        # opens Expo dev tools
   # then press "i" (iOS Simulator) or "a" (Android), or scan the QR with Expo Go
   ```

   `react-native-maps` needs a native build, so Expo Go will fall back to
   a placeholder. Use `pnpm ios` / `pnpm android` for the full experience
   — Expo will build a dev client the first time.

## How the mobile app talks to the backend

`src/lib/api.ts` defines `apiFetch(path)` which:

1. Pulls the current Supabase access token out of the auth session.
2. Attaches it as `Authorization: Bearer <token>`.
3. Hits `${EXPO_PUBLIC_API_BASE_URL}${path}` — for example:
   - `GET /api/live/feed`
   - `GET /api/live/rooms/:id/state`
   - `GET /api/live/rooms/:id/driver-route`
   - `POST /api/live/rooms/:id/bet`

On the web side those routes already accept a bearer token (they call
`supabase.auth.getUser()` which verifies the JWT). No backend changes are
required.

## What's ported vs TODO

**Ported**

- Supabase email/password auth + session persistence in Keychain
- Live rooms feed (polled every 10 s)
- Live room viewer: map with history / rail / crossroad dot, betting panel
  with stake chips, 1.5 s room polling, 2 s driver-route polling
- Tab navigation (Live / Feed / Wallet / Profile), sign-out

**Scaffolded but not filled in**

- Feed tab (clips / stories). The types + query shape are ready; wire up
  the corresponding `/api/clips` endpoints.
- Broadcaster flow (going live from the phone). Needs a LiveKit RN SDK
  integration (`@livekit/react-native`) + `expo-location` streaming.
- Character creation + profile editing. Forms should follow the same
  `Input` / `Button` / `Card` pattern used in `(auth)/*.tsx`.
- Push notifications (`expo-notifications`) for "a creator you follow
  just went live".

## Good-practices notes

- **Providers are composed once** in `app/_layout.tsx`; no screen should
  wrap its own `QueryClient` or create its own Supabase client. Use
  `getSupabase()` everywhere.
- **All network calls go through `apiFetch`** so auth + error shape stay
  consistent. Do not call `fetch()` directly from screens.
- **Mobile polling is deliberate**, not WebSocket-based, to match the web
  app's existing pattern and keep the surface small. If / when the web
  app moves to Realtime subscriptions, update `useLiveRoom` to use
  `supabase.channel(...)` the same way.
- **Strict TypeScript + path alias `@/*`** — enable "Organize imports" in
  your editor to keep imports tidy.
- **No console logs in committed code.** Use `__DEV__` guards when
  debugging.
