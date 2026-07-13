import type {
  VehicleFrameInput,
  VehicleFrameResult,
  VehicleInferenceStatus,
} from "../domain/leadVehicle.types";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";

/**
 * On-device inference placeholder.
 *
 * Production path: extend the existing WebRTC `VideoFrameProcessor`
 * (same pattern as `native/stream-top-crop`) so frames are never
 * base64-bridged and the camera is not opened twice.
 *
 * Until the native TFLite / Core ML plugin is shipped, this engine
 * reports `unsupported` and returns no detections — live streaming
 * continues unaffected.
 */
export class OnDeviceVehicleInferenceEngine implements VehicleInferenceEngine {
  private status: VehicleInferenceStatus = "uninitialized";

  async initialize(): Promise<void> {
    this.status = "unsupported";
  }

  async processFrame(input: VehicleFrameInput): Promise<VehicleFrameResult> {
    return {
      frameId: input.frameId,
      timestampMs: input.timestampMs,
      inferenceDurationMs: 0,
      detections: [],
    };
  }

  async dispose(): Promise<void> {
    this.status = "disposed";
  }

  getStatus(): VehicleInferenceStatus {
    return this.status;
  }
}
