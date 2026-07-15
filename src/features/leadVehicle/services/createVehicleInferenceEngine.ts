import type { InferenceMode } from "../domain/leadVehicle.types";
import { HybridVehicleInferenceEngine } from "./HybridVehicleInferenceEngine";
import { MockVehicleInferenceEngine } from "./MockVehicleInferenceEngine";
import { OnDeviceVehicleInferenceEngine } from "./OnDeviceVehicleInferenceEngine";
import { RemoteVehicleInferenceEngine } from "./RemoteVehicleInferenceEngine";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";

export type CreateVehicleInferenceEngineOptions = {
  sessionId?: string;
};

export function createVehicleInferenceEngine(
  mode: InferenceMode,
  opts: CreateVehicleInferenceEngineOptions = {},
): VehicleInferenceEngine {
  switch (mode) {
    case "hybrid":
      if (!opts.sessionId) {
        return new OnDeviceVehicleInferenceEngine();
      }
      return new HybridVehicleInferenceEngine({ sessionId: opts.sessionId });
    case "remote":
      if (!opts.sessionId) {
        return new RemoteVehicleInferenceEngine();
      }
      return new RemoteVehicleInferenceEngine({ sessionId: opts.sessionId });
    case "on_device":
      return new OnDeviceVehicleInferenceEngine();
    case "mock":
    default:
      return new MockVehicleInferenceEngine();
  }
}

export function engineSupportsPushFrames(
  engine: VehicleInferenceEngine,
): engine is HybridVehicleInferenceEngine | OnDeviceVehicleInferenceEngine {
  return (
    engine instanceof OnDeviceVehicleInferenceEngine ||
    engine instanceof HybridVehicleInferenceEngine
  );
}
