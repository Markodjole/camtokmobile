import type {
  VehicleFrameInput,
  VehicleFrameResult,
  VehicleInferenceStatus,
} from "../domain/leadVehicle.types";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";

/**
 * Stub for remote sampled-frame inference.
 * Not the default. Rate-limited; never uses third-party vision APIs.
 * Backend endpoint is expected later in camtok: POST /api/live/sessions/:id/lead-vehicle/infer
 */
export class RemoteVehicleInferenceEngine implements VehicleInferenceEngine {
  private status: VehicleInferenceStatus = "uninitialized";
  private inFlight = false;
  private lastAcceptedFrameId = -1;
  private minIntervalMs: number;
  private lastSentAt = 0;

  constructor(opts?: { minIntervalMs?: number }) {
    this.minIntervalMs = opts?.minIntervalMs ?? 200;
  }

  async initialize(): Promise<void> {
    // Ready as a client stub; actual HTTP will no-op until backend exists.
    this.status = "ready";
  }

  async processFrame(input: VehicleFrameInput): Promise<VehicleFrameResult> {
    const t0 = Date.now();
    if (this.status !== "ready") {
      return empty(input, 0);
    }
    if (input.frameId < this.lastAcceptedFrameId) {
      // Out-of-order — discard.
      return empty(input, 0);
    }
    if (this.inFlight) {
      return empty(input, 0);
    }
    if (Date.now() - this.lastSentAt < this.minIntervalMs) {
      return empty(input, 0);
    }

    this.inFlight = true;
    this.lastSentAt = Date.now();
    try {
      // Intentionally no network call until camtok backend ships the route.
      // Returning empty keeps tracking stable without corrupting state.
      this.lastAcceptedFrameId = input.frameId;
      return empty(input, Date.now() - t0);
    } finally {
      this.inFlight = false;
    }
  }

  async dispose(): Promise<void> {
    this.status = "disposed";
  }

  getStatus(): VehicleInferenceStatus {
    return this.status;
  }
}

function empty(input: VehicleFrameInput, ms: number): VehicleFrameResult {
  return {
    frameId: input.frameId,
    timestampMs: input.timestampMs,
    inferenceDurationMs: ms,
    detections: [],
  };
}
