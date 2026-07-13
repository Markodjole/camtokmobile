import type {
  VehicleFrameInput,
  VehicleFrameResult,
  VehicleInferenceStatus,
} from "../domain/leadVehicle.types";

/**
 * Swappable vehicle detector. Public API is identical for
 * on-device, remote, and mock backends.
 */
export interface VehicleInferenceEngine {
  initialize(): Promise<void>;
  processFrame(input: VehicleFrameInput): Promise<VehicleFrameResult>;
  dispose(): Promise<void>;
  getStatus(): VehicleInferenceStatus;
}

export type CreateInferenceEngineOptions = {
  mode: "on_device" | "remote" | "mock";
};
