import type {
  VehicleFrameInput,
  VehicleFrameResult,
  VehicleInferenceStatus,
} from "../domain/leadVehicle.types";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";
import {
  leadVehicleNativeIsAvailable,
  leadVehicleNativePresent,
  leadVehicleNativeSetEnabled,
  mapNativeDetections,
  subscribeLeadVehicleDetections,
} from "@/lib/leadVehicleNative";

export type OnDeviceFrameHandler = (result: VehicleFrameResult) => void;

/**
 * On-device vehicle inference via the WebRTC VideoFrameProcessor path
 * (same camera as the live stream — never opens a second session).
 *
 * Native TFLite runs in `LeadVehicleFrameAnalyzer` and emits
 * `LeadVehicleDetections`; this engine forwards them into the pipeline.
 */
export class OnDeviceVehicleInferenceEngine implements VehicleInferenceEngine {
  private status: VehicleInferenceStatus = "uninitialized";
  private unsubscribe: (() => void) | null = null;
  private handler: OnDeviceFrameHandler | null = null;
  private frameId = 0;

  /** Pipeline registers this so native detection frames drive tracking. */
  attachFrameHandler(handler: OnDeviceFrameHandler): void {
    this.handler = handler;
  }

  async initialize(): Promise<void> {
    if (!leadVehicleNativePresent()) {
      this.status = "unsupported";
      return;
    }
    const available = await leadVehicleNativeIsAvailable();
    if (!available) {
      this.status = "unsupported";
      return;
    }
    await leadVehicleNativeSetEnabled(true);
    this.unsubscribe = subscribeLeadVehicleDetections((payload) => {
      this.frameId += 1;
      const result = mapNativeDetections(payload, this.frameId);
      this.handler?.(result);
    });
    this.status = "ready";
  }

  async processFrame(input: VehicleFrameInput): Promise<VehicleFrameResult> {
    // Frames are pushed from native; processFrame is unused for on_device.
    return {
      frameId: input.frameId,
      timestampMs: input.timestampMs,
      inferenceDurationMs: 0,
      detections: [],
    };
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.handler = null;
    try {
      if (leadVehicleNativePresent()) {
        await leadVehicleNativeSetEnabled(false);
      }
    } catch {
      // ignore
    }
    this.status = "disposed";
  }

  getStatus(): VehicleInferenceStatus {
    return this.status;
  }
}
