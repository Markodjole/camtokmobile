/**
 * Lead-vehicle feature flags.
 * Env-based until a remote config service exists.
 *
 * EXPO_PUBLIC_LEAD_VEHICLE_TRACKING=1
 * EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY=1
 * EXPO_PUBLIC_LEAD_VEHICLE_REMOTE=1   → enables hybrid (on-device + server refine)
 * EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY=1
 * EXPO_PUBLIC_LEAD_VEHICLE_MODE=mock|on_device|remote|hybrid
 */

import type { InferenceMode } from "../domain/leadVehicle.types";

// IMPORTANT: every env read below must be a *static* `process.env.EXPO_PUBLIC_X`
// member access. Metro inlines those at bundle time; dynamic `process.env[name]`
// is NOT inlined and evaluates to undefined on-device. That bug silently
// disabled telemetry (no viewer boxes) in release builds while dev builds were
// rescued by the __DEV__ fallback.

function isOn(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

export function leadVehicleTrackingEnabled(): boolean {
  const raw = process.env.EXPO_PUBLIC_LEAD_VEHICLE_TRACKING;
  if (isOn(raw)) return true;
  // Default on — mock detector is always safe; disable with =0 if needed.
  if (raw === "0" || raw === "false") return false;
  return true;
}

export function leadVehicleDebugOverlayEnabled(): boolean {
  // Rider never sees boxes/HUD unless explicitly forced for engineering debug.
  return isOn(process.env.EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY);
}

export function leadVehicleRemoteInferenceEnabled(): boolean {
  return isOn(process.env.EXPO_PUBLIC_LEAD_VEHICLE_REMOTE);
}

export function leadVehicleTelemetryEnabled(): boolean {
  if (isOn(process.env.EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY)) return true;
  // In dev, push events so local camtok can open overtake markets.
  return typeof __DEV__ !== "undefined" && __DEV__;
}

export function leadVehicleInferenceMode(): InferenceMode {
  const raw = process.env.EXPO_PUBLIC_LEAD_VEHICLE_MODE;
  if (
    raw === "on_device" ||
    raw === "remote" ||
    raw === "hybrid" ||
    raw === "mock"
  ) {
    return raw;
  }
  if (leadVehicleRemoteInferenceEnabled()) return "hybrid";
  return "on_device";
}

/** Rush Hour–style timed count rounds (default). Set =0 to use legacy lead tracking. */
export function vehicleCountRoundEnabled(): boolean {
  const raw = process.env.EXPO_PUBLIC_VEHICLE_COUNT_ROUND;
  if (raw === "0" || raw === "false") return false;
  return true;
}

/**
 * Count rounds default to on-device for predictable counting. Enable hybrid
 * (server refine) only once a real detector is configured server-side — set
 * EXPO_PUBLIC_VEHICLE_COUNT_ROUND_MODE=hybrid or EXPO_PUBLIC_LEAD_VEHICLE_REMOTE=1.
 */
export function vehicleCountRoundInferenceMode(): InferenceMode {
  const raw = process.env.EXPO_PUBLIC_VEHICLE_COUNT_ROUND_MODE;
  if (
    raw === "on_device" ||
    raw === "remote" ||
    raw === "hybrid" ||
    raw === "mock"
  ) {
    return raw;
  }
  if (leadVehicleRemoteInferenceEnabled()) return "hybrid";
  return "on_device";
}
