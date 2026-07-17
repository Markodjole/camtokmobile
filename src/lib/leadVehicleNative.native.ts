import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import {
  mapNativeDetections,
  type NativeDetectionPayload,
} from "./leadVehicleNativeShared";

export type { NativeDetectionPayload } from "./leadVehicleNativeShared";
export { mapNativeDetections } from "./leadVehicleNativeShared";

type LeadVehicleNativeModule = {
  isAvailable(): Promise<boolean>;
  getStatus(): Promise<{
    available: boolean;
    enabled: boolean;
    detail: string;
    modelName: string;
    modelVersion: string;
  }>;
  setEnabled(enabled: boolean): Promise<void>;
  setSamplingEnabled(enabled: boolean): Promise<void>;
  setHighPerfNetwork(enabled: boolean): Promise<void>;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

const Native: LeadVehicleNativeModule | undefined =
  NativeModules.LeadVehicleNative;

export function leadVehicleNativePresent(): boolean {
  return Native != null;
}

export async function leadVehicleNativeIsAvailable(): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.isAvailable();
  } catch {
    return false;
  }
}

export async function leadVehicleNativeGetStatus() {
  if (!Native) {
    return {
      available: false,
      enabled: false,
      detail: "module_missing",
      modelName: "none",
      modelVersion: "none",
      platform: Platform.OS,
    };
  }
  const status = await Native.getStatus();
  return { ...status, platform: Platform.OS };
}

export async function leadVehicleNativeSetEnabled(
  enabled: boolean,
): Promise<void> {
  if (!Native) {
    throw new Error("LeadVehicleNative module not present in this build");
  }
  await Native.setEnabled(enabled);
}

/** Hybrid/server-refine only — leave off for on-device-only tracking. */
export async function leadVehicleNativeSetSamplingEnabled(
  enabled: boolean,
): Promise<void> {
  if (!Native) return;
  try {
    await Native.setSamplingEnabled(enabled);
  } catch {
    // Older installed build without this method — safe to ignore.
  }
}

/** Hold/release the low-latency WiFi + CPU locks while broadcasting. */
export async function setHighPerfNetwork(enabled: boolean): Promise<void> {
  if (!Native) return;
  try {
    await Native.setHighPerfNetwork(enabled);
  } catch {
    // Older installed build without this method — safe to ignore.
  }
}

export function subscribeLeadVehicleDetections(
  onPayload: (payload: NativeDetectionPayload) => void,
): () => void {
  if (!Native) return () => undefined;
  const emitter = new NativeEventEmitter(Native as never);
  const sub = emitter.addListener("LeadVehicleDetections", (raw) => {
    onPayload(raw as NativeDetectionPayload);
  });
  return () => sub.remove();
}
