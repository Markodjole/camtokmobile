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

1. **`on_device` (default)** — COCO SSD MobileNet TFLite on the WebRTC frame processor (same camera as the stream). Android is live after a dev-client rebuild; iOS reports unavailable until TensorFlowLiteObjC is linked.
2. **`mock`** — deterministic scenario engine for UI / CI without a camera or model.
3. **`remote`** — stub client with rate limits; HTTP no-op until camtok adds `POST .../lead-vehicle/infer`.

If `on_device` is unavailable in the binary, the pipeline **falls back to mock** so go-live still works.

Public interface is identical for all three: `VehicleInferenceEngine`.

## Native dependencies

- Expo plugin `plugins/withLeadVehicleDetect.js` copies `native/lead-vehicle/` into prebuild, registers `LeadVehiclePackage`, and adds `org.tensorflow:tensorflow-lite:2.14.0`.
- Model: `yarn download:lead-vehicle-model` → `assets/models/coco_ssd_mobilenet_v1.tflite` (gitignored; Apache-2.0 TensorFlow Lite example weights).
- Frame hook: `TopCropVideoFrameProcessor` crops then calls `LeadVehicleFrameAnalyzer.maybeAnalyze` off-thread (~8 FPS).

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
native/lead-vehicle/
  android/    TFLite analyzer + RN module
  ios/        RN bridge (interpreter follow-up)
```

## How frames are accessed (v1)

| Mode | Frame source |
|------|----------------|
| on_device | WebRTC `VideoFrameProcessor` → TFLite → `LeadVehicleDetections` JS events |
| mock | Timer at ~8 FPS inside `LeadVehiclePipeline` (no camera pixels) |
| remote | Stub — would send reduced frames later; currently returns empty detections |

## Feature flags

| Env | Effect |
|-----|--------|
| `EXPO_PUBLIC_LEAD_VEHICLE_TRACKING=1` | Force-enable tracking |
| (unset in `__DEV__`) | Tracking enabled by default in development |
| `EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY=1` | Force debug overlay |
| (unset in `__DEV__`) | Overlay on in development |
| `EXPO_PUBLIC_LEAD_VEHICLE_MODE=mock\|on_device\|remote` | Engine selection (default `on_device`) |
| `EXPO_PUBLIC_LEAD_VEHICLE_REMOTE=1` | Force remote engine |
| `EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY=1` | POST events to camtok REST |

## Enable on-device

```bash
# Download weights (once)
yarn download:lead-vehicle-model

# .env
EXPO_PUBLIC_LEAD_VEHICLE_TRACKING=1
EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY=1
EXPO_PUBLIC_LEAD_VEHICLE_MODE=on_device
EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY=1

# Native rebuild required (Metro alone is not enough)
npx expo prebuild --clean
npx expo run:android --device
# then
npx expo start --dev-client --lan
```

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

1. Rebuild Android dev client with TFLite plugin; road-test lead boxes on real traffic
2. Link TensorFlowLiteObjC (or Core ML) on iOS and flip `LeadVehicleFrameAnalyzer` to ready
3. Tune corridor / confidence thresholds from road captures
4. Harden overtake settlement with real lost/overtake signals

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
