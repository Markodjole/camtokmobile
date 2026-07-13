import { DEFAULT_LEAD_VEHICLE_MODEL_CONFIG } from "../domain/leadVehicle.constants";
import type {
  VehicleDetection,
  VehicleFrameInput,
  VehicleFrameResult,
  VehicleInferenceStatus,
} from "../domain/leadVehicle.types";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";

type MockPhase =
  | "empty"
  | "car_enter"
  | "car_stable"
  | "car_left"
  | "car_occluded"
  | "car_return"
  | "moto_takeover"
  | "moto_lost";

/**
 * Deterministic mock detector for UI / event / backend integration without
 * a native model. Scenario advances on wall-clock time from initialize().
 */
export class MockVehicleInferenceEngine implements VehicleInferenceEngine {
  private status: VehicleInferenceStatus = "uninitialized";
  private startedAtMs = 0;
  private scenarioMs = 0;

  async initialize(): Promise<void> {
    this.startedAtMs = Date.now();
    this.scenarioMs = 0;
    this.status = "ready";
  }

  async processFrame(input: VehicleFrameInput): Promise<VehicleFrameResult> {
    const t0 = Date.now();
    if (this.status !== "ready") {
      return {
        frameId: input.frameId,
        timestampMs: input.timestampMs,
        inferenceDurationMs: 0,
        detections: [],
      };
    }

    this.scenarioMs = input.timestampMs - this.startedAtMs;
    if (this.scenarioMs < 0) this.scenarioMs = Date.now() - this.startedAtMs;

    const phase = phaseAt(this.scenarioMs);
    const detections = detectionsForPhase(phase, this.scenarioMs);

    return {
      frameId: input.frameId,
      timestampMs: input.timestampMs,
      inferenceDurationMs: Math.max(1, Date.now() - t0),
      detections,
    };
  }

  async dispose(): Promise<void> {
    this.status = "disposed";
  }

  getStatus(): VehicleInferenceStatus {
    return this.status;
  }

  /** Test helper: force scenario clock. */
  setScenarioElapsedMs(ms: number): void {
    this.scenarioMs = ms;
    this.startedAtMs = Date.now() - ms;
  }
}

function phaseAt(ms: number): MockPhase {
  if (ms < 800) return "empty";
  if (ms < 1800) return "car_enter";
  if (ms < 4500) return "car_stable";
  if (ms < 5500) return "car_left";
  if (ms < 6200) return "car_occluded";
  if (ms < 8500) return "car_return";
  if (ms < 12000) return "moto_takeover";
  return "moto_lost";
}

function detectionsForPhase(phase: MockPhase, ms: number): VehicleDetection[] {
  switch (phase) {
    case "empty":
    case "car_occluded":
    case "moto_lost":
      return [];
    case "car_enter": {
      const t = (ms - 800) / 1000;
      return [
        {
          vehicleType: "car",
          confidence: 0.55 + t * 0.2,
          boundingBox: {
            x: 0.46,
            y: 0.42 - t * 0.02,
            width: 0.12 + t * 0.02,
            height: 0.15 + t * 0.02,
          },
        },
      ];
    }
    case "car_stable":
      return [
        {
          vehicleType: "car",
          confidence: 0.88,
          boundingBox: { x: 0.44, y: 0.4, width: 0.14, height: 0.18 },
        },
      ];
    case "car_left": {
      const t = (ms - 4500) / 1000;
      return [
        {
          vehicleType: "car",
          confidence: 0.8,
          boundingBox: {
            x: 0.44 - t * 0.12,
            y: 0.4,
            width: 0.14,
            height: 0.18,
          },
        },
      ];
    }
    case "car_return":
      return [
        {
          vehicleType: "car",
          confidence: 0.82,
          boundingBox: { x: 0.45, y: 0.41, width: 0.13, height: 0.17 },
        },
      ];
    case "moto_takeover":
      return [
        {
          vehicleType: "car",
          confidence: 0.5,
          boundingBox: { x: 0.72, y: 0.55, width: 0.2, height: 0.22 },
        },
        {
          vehicleType: "motorcycle",
          confidence: 0.86,
          boundingBox: { x: 0.46, y: 0.38, width: 0.1, height: 0.16 },
        },
      ];
    default:
      return [];
  }
}

export const MOCK_MODEL_META = {
  modelName: DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.modelName,
  modelVersion: DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.modelVersion,
};
