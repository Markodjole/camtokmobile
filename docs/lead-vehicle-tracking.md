# Lead-vehicle tracking (Crosstown / CamTok mobile)

## Goal

While the rider streams live video, continuously detect and track the single most relevant vehicle travelling ahead — enough signal for Crosstown prediction markets such as “will we overtake the lead vehicle in the next 30 seconds?”

This is **not** ANPR / plate OCR / facial recognition. Temporary session track IDs only (`vehicle_17`, …).

## Current video architecture (inspected)

| Item | Value |
|------|--------|
| React Native | 0.81.5 |
| Expo SDK | ~54 (`expo-dev-client`) |
| Native projects | Generated via prebuild (`ios/` / `android/` gitignored); New Architecture on |
| Streaming camera | `react-native-webrtc` `getUserMedia` in `BroadcasterCameraPreview.native.tsx` |
| Preview-only fallback | `expo-camera` (Expo Go — no WebRTC publish) |
| Frame hook today | WebRTC `VideoFrameProcessor` via `native/stream-top-crop` (top-crop only) |
| Vision Camera / TFLite / ONNX | **Not present** |
| GPS / heading / speed | `expo-location` → `useBroadcasterTelemetry` → REST `/location` + `/heartbeat` |
| Session create | `POST /api/live/sessions` from `app/live/go/[characterId].tsx` |
| Signaling | Supabase Realtime (`live-webrtc:*`) — **no** RTC data channel |
| State | Zustand (`liveBroadcastStore`) + TanStack Query |
| Feature flags | Env (`EXPO_PUBLIC_LEAD_VEHICLE_*`) — no remote flag service yet |
| Tests | Vitest (added for this feature) |

**Camera reuse:** One WebRTC capture feeds preview + P2P. Lead-vehicle analysis must **not** open a second camera session. Preferred production path: extend the existing `VideoFrameProcessor` factory (same pattern as stream-top-crop) and call into JS / native tracker with detections — never base64 every frame across the bridge.

## Selected inference approach (v1)

1. **Default: `mock`** — deterministic scenario engine for UI, events, scoring, and backend contract testing without a model.
2. **`remote`** — stub client with rate limits / out-of-order discard; HTTP no-op until camtok adds `POST .../lead-vehicle/infer`.
3. **`on_device`** — stub reporting `unsupported` until a TFLite (Android) / Core ML (iOS) processor is shipped beside stream-top-crop.

Public interface is identical for all three: `VehicleInferenceEngine`.

### Why this order

- No ML runtime is in the app yet; wiring TFLite/Core ML safely needs a dedicated native plugin + model licensing review.
- Betting / engine work on **camtok web** can proceed against mock + REST telemetry events immediately.
- Live stream must never break if analysis fails.

## Native dependencies added

**None for inference in this milestone.** Vitest added as a devDependency for unit tests.

Planned (not installed yet):

- Android: TensorFlow Lite (or ONNX Runtime Mobile) + exported COCO-style vehicle model
- iOS: Core ML conversion of the same model
- License of the chosen weights must be documented before shipping (prefer Apache-2.0 / MIT COCO-trained exports; avoid GPL weights if distribution terms conflict)

## Module layout

```text
src/features/leadVehicle/
  domain/     types, geometry, scoring, motion, state machine, prediction readiness
  services/   engines, tracker, event emitter, telemetry client, pipeline
  hooks/      useLeadVehicleTracking
  state/      zustand UI store
  config/     feature flags
  debug/      LeadVehicleDebugOverlay
  tests/      vitest unit + integration
```

## How frames are accessed (v1)

| Mode | Frame source |
|------|----------------|
| mock | Timer at ~8 FPS inside `LeadVehiclePipeline` (no camera pixels) |
| remote | Stub — would send reduced frames later; currently returns empty detections |
| on_device | Stub — native processor not wired; returns empty / `unsupported` |

`LeadVehiclePipeline.ingestFrame()` is the single entry for future native callbacks.

## Feature flags

| Env | Effect |
|-----|--------|
| `EXPO_PUBLIC_LEAD_VEHICLE_TRACKING=1` | Force-enable tracking |
| (unset in `__DEV__`) | Tracking enabled by default in development |
| `EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY=1` | Force debug overlay |
| (unset in `__DEV__`) | Overlay on in development |
| `EXPO_PUBLIC_LEAD_VEHICLE_MODE=mock\|on_device\|remote` | Engine selection (default `mock`) |
| `EXPO_PUBLIC_LEAD_VEHICLE_REMOTE=1` | Force remote engine |
| `EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY=1` | POST events to camtok REST |

## Enable / mock / overlay

```bash
# .env
EXPO_PUBLIC_LEAD_VEHICLE_TRACKING=1
EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY=1
EXPO_PUBLIC_LEAD_VEHICLE_MODE=mock
# When camtok endpoint exists:
EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY=1
```

Go live as a rider → room screen starts `useLeadVehicleTracking` and shows the debug overlay in dev.

## Backend contract (camtok) — implemented

Mobile posts (telemetry on in `__DEV__` or `EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY=1`):

`POST /api/live/sessions/:sessionId/lead-vehicle-events`

Body: `LeadVehicleTelemetryEvent` (includes optional `predictionReady`).

Camtok:

- Stores rows in `lead_vehicle_events` + upserts `character_lead_vehicle_state`
- When `predictionReady` and room is `waiting_for_next_market`, opens `overtake_30s` yes/no market
- Tick also tries open from latest lead state
- Resolver settles from lead lost / 30s window

**Web bettor UI:** uses existing live room market chrome once market is open — no separate screen required for v1.

## Next engineering steps

1. Apply migration `00065_lead_vehicle_events_and_overtake_market.sql` (local + remote)
2. Deploy camtok web so the new API route is live
3. Reload mobile with telemetry env set; go live; watch mock lead acquire → market open on web
4. Later: native on-device detector via WebRTC `VideoFrameProcessor`
5. Tune overtake settlement with real road data

## Privacy

- No raw frame persistence by default
- No plate OCR / crops / faces
- Temporary track IDs reset per session
- Bounding boxes in telemetry are optional (`includeBoundingBoxes`)

## Performance assumptions

- Analysis target: ~8 FPS, adaptive throttle if inference &gt; 120 ms
- Newest-frame-wins backpressure; dropped frames counted
- Live WebRTC remains higher priority than AI

## Known limitations

- **On-device detection not verified** — no model packaged yet
- Mock scenario is synthetic, not road truth
- Distance meters omitted (no calibrated camera geometry)
- Overtake settlement heuristic (lost-while-approaching) needs road validation
- Not yet verified on a moving motorcycle
- Debug overlay is local UI only (not burned into the outgoing stream)

## Tests

```bash
yarn test
# or
yarn vitest run
```

## Status legend

| Area | Status |
|------|--------|
| Domain scoring / corridor / state machine | **Implemented + unit tested** |
| Mock engine + pipeline + rider hook | **Implemented** |
| Debug overlay | **Implemented (dev / flag)** |
| REST telemetry client | **Implemented** |
| camtok ingest + overtake_30s market | **Implemented (needs migration deploy)** |
| On-device TFLite/Core ML | **Stub only** |
| Remote infer HTTP | **Stub only** |
| Production road accuracy | **Not claimed** |
