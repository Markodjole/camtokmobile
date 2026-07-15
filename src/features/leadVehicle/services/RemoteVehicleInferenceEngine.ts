import type {
  VehicleFrameInput,
  VehicleFrameResult,
  VehicleInferenceStatus,
} from "../domain/leadVehicle.types";
import { RemoteVehicleInferClient } from "./RemoteVehicleInferClient";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";

export type RemoteVehicleInferenceEngineOptions = {
  sessionId?: string;
  minIntervalMs?: number;
};

/**
 * Remote-only sampled-frame inference (~5 FPS).
 * Prefer `hybrid` in production — this mode skips on-device boxes entirely.
 */
export class RemoteVehicleInferenceEngine implements VehicleInferenceEngine {
  private status: VehicleInferenceStatus = "uninitialized";
  private inFlight = false;
  private lastAcceptedFrameId = -1;
  private minIntervalMs: number;
  private lastSentAt = 0;
  private remote: RemoteVehicleInferClient | null;

  constructor(opts: RemoteVehicleInferenceEngineOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 200;
    this.remote = opts.sessionId
      ? new RemoteVehicleInferClient(opts.sessionId)
      : null;
  }

  async initialize(): Promise<void> {
    this.status = "ready";
  }

  async processFrame(input: VehicleFrameInput): Promise<VehicleFrameResult> {
    const t0 = Date.now();
    if (this.status !== "ready") {
      return empty(input, 0);
    }
    if (input.frameId < this.lastAcceptedFrameId) {
      return empty(input, 0);
    }
    if (this.inFlight) {
      return empty(input, 0);
    }
    if (Date.now() - this.lastSentAt < this.minIntervalMs) {
      return empty(input, 0);
    }
    if (!this.remote) {
      return empty(input, 0);
    }

    this.inFlight = true;
    this.lastSentAt = Date.now();
    try {
      const result = await this.remote.infer({
        timestampMs: input.timestampMs,
        frameWidth: input.width,
        frameHeight: input.height,
        rotationDegrees: input.rotationDegrees,
        imageBase64:
          typeof input.imageData === "string" ? input.imageData : undefined,
      });
      this.lastAcceptedFrameId = input.frameId;
      if (!result) {
        return empty(input, Date.now() - t0);
      }
      return {
        frameId: input.frameId,
        timestampMs: input.timestampMs,
        inferenceDurationMs: result.inferenceDurationMs || Date.now() - t0,
        detections: result.detections,
      };
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
