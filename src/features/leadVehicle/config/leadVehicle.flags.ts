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
  // Default on in __DEV__ mock mode so engineers can see the overlay path.
  if (flag("EXPO_PUBLIC_LEAD_VEHICLE_TRACKING")) return true;
  return typeof __DEV__ !== "undefined" && __DEV__;
}

export function leadVehicleDebugOverlayEnabled(): boolean {
  if (flag("EXPO_PUBLIC_LEAD_VEHICLE_DEBUG_OVERLAY")) return true;
  return typeof __DEV__ !== "undefined" && __DEV__;
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
  // Safe default until native model ships.
  return "mock";
}
