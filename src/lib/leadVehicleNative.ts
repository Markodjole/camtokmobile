/**
 * Web / vitest stub — native module is not present.
 * Metro uses `leadVehicleNative.native.ts` on iOS/Android.
 */
export type { NativeDetectionPayload } from "./leadVehicleNativeShared";
export { mapNativeDetections } from "./leadVehicleNativeShared";

export function leadVehicleNativePresent(): boolean {
  return false;
}

export async function leadVehicleNativeIsAvailable(): Promise<boolean> {
  return false;
}

export async function leadVehicleNativeGetStatus() {
  return {
    available: false,
    enabled: false,
    detail: "web_or_test_stub",
    modelName: "none",
    modelVersion: "none",
    platform: "web",
  };
}

export async function leadVehicleNativeSetEnabled(
  _enabled: boolean,
): Promise<void> {
  throw new Error("LeadVehicleNative is not available on web");
}

export async function leadVehicleNativeSetSamplingEnabled(
  _enabled: boolean,
): Promise<void> {
  // no-op on web
}

export async function setHighPerfNetwork(_enabled: boolean): Promise<void> {
  // no-op on web
}

export function subscribeLeadVehicleDetections(
  _onPayload: (payload: import("./leadVehicleNativeShared").NativeDetectionPayload) => void,
): () => void {
  return () => undefined;
}
