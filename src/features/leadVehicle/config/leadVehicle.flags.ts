/**
 * Lead-vehicle feature flags.
 * Env-based until a remote config service exists.
 *
 * EXPO_PUBLIC_LEAD_VEHICLE_TRACKING=1
 * EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY=1
 * EXPO_PUBLIC_LEAD_VEHICLE_REMOTE=1
 * EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY=1
 * EXPO_PUBLIC_LEAD_VEHICLE_MODE=mock|on_device|remote
 */

import type { InferenceMode } from "../domain/leadVehicle.types";

function flag(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

export function leadVehicleTrackingEnabled(): boolean {
  if (flag("EXPO_PUBLIC_LEAD_VEHICLE_TRACKING")) return true;
  // Default on — mock detector is always safe; disable with =0 if needed.
  const raw = process.env.EXPO_PUBLIC_LEAD_VEHICLE_TRACKING;
  if (raw === "0" || raw === "false") return false;
  return true;
}

export function leadVehicleDebugOverlayEnabled(): boolean {
  // Rider never sees boxes/HUD unless explicitly forced for engineering debug.
  return flag("EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY");
}

export function leadVehicleRemoteInferenceEnabled(): boolean {
  return flag("EXPO_PUBLIC_LEAD_VEHICLE_REMOTE");
}

export function leadVehicleTelemetryEnabled(): boolean {
  if (flag("EXPO_PUBLIC_LEAD_VEHICLE_TELEMETRY")) return true;
  // In dev, push events so local camtok can open overtake markets.
  return typeof __DEV__ !== "undefined" && __DEV__;
}

export function leadVehicleInferenceMode(): InferenceMode {
  if (leadVehicleRemoteInferenceEnabled()) return "remote";
  const raw = process.env.EXPO_PUBLIC_LEAD_VEHICLE_MODE;
  if (raw === "on_device" || raw === "remote" || raw === "mock") return raw;
  // Prefer real detections when the native module is present; mock otherwise.
  // Native availability is checked at engine init — unsupported → error UI.
  return "on_device";
}
