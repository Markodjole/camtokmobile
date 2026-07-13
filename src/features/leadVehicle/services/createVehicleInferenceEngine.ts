import type { InferenceMode } from "../domain/leadVehicle.types";
import { MockVehicleInferenceEngine } from "./MockVehicleInferenceEngine";
import { OnDeviceVehicleInferenceEngine } from "./OnDeviceVehicleInferenceEngine";
import { RemoteVehicleInferenceEngine } from "./RemoteVehicleInferenceEngine";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";

export function createVehicleInferenceEngine(
  mode: InferenceMode,
): VehicleInferenceEngine {
  switch (mode) {
    case "remote":
      return new RemoteVehicleInferenceEngine();
    case "on_device":
      return new OnDeviceVehicleInferenceEngine();
    case "mock":
    default:
      return new MockVehicleInferenceEngine();
  }
}
