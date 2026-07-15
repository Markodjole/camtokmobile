import {
  HYBRID_REMOTE_CACHE_MS,
  HYBRID_REMOTE_INTERVAL_MS,
} from "../domain/leadVehicle.constants";
import { fuseVehicleDetections } from "../domain/leadVehicle.fusion";
import type {
  VehicleFrameInput,
  VehicleFrameResult,
  VehicleInferenceStatus,
} from "../domain/leadVehicle.types";
import {
  OnDeviceVehicleInferenceEngine,
  type OnDeviceFrameHandler,
} from "./OnDeviceVehicleInferenceEngine";
import { RemoteVehicleInferClient } from "./RemoteVehicleInferClient";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";

export type HybridVehicleInferenceEngineOptions = {
  sessionId: string;
  remoteIntervalMs?: number;
};

/**
 * Best of both: on-device for ~real-time boxes, remote refine every ~500ms.
 * If the infer API is missing, behaves as on-device only (no user-visible failure).
 */
export class HybridVehicleInferenceEngine implements VehicleInferenceEngine {
  private onDevice = new OnDeviceVehicleInferenceEngine();
  private remote: RemoteVehicleInferClient;
  private status: VehicleInferenceStatus = "uninitialized";
  private handler: OnDeviceFrameHandler | null = null;
  private remoteTimer: ReturnType<typeof setInterval> | null = null;
  private remoteInFlight = false;
  private remoteIntervalMs: number;
  private lastRemoteDetections: VehicleFrameResult["detections"] = [];
  private lastRemoteAtMs = 0;
  private lastFrameMeta: {
    width?: number;
    height?: number;
    rotationDegrees?: number;
  } = {};

  constructor(opts: HybridVehicleInferenceEngineOptions) {
    this.remote = new RemoteVehicleInferClient(opts.sessionId);
    this.remoteIntervalMs = opts.remoteIntervalMs ?? HYBRID_REMOTE_INTERVAL_MS;
  }

  attachFrameHandler(handler: OnDeviceFrameHandler): void {
    this.handler = handler;
    this.onDevice.attachFrameHandler((local) => {
      if (local.frameWidth) this.lastFrameMeta.width = local.frameWidth;
      if (local.frameHeight) this.lastFrameMeta.height = local.frameHeight;
      if (local.rotationDegrees != null) {
        this.lastFrameMeta.rotationDegrees = local.rotationDegrees;
      }
      const remote = this.freshRemoteDetections();
      const fused = remote.length
        ? fuseVehicleDetections(local.detections, remote)
        : local.detections;
      this.handler?.({
        ...local,
        detections: fused,
      });
    });
  }

  async initialize(): Promise<void> {
    await this.onDevice.initialize();
    if (this.onDevice.getStatus() !== "ready") {
      this.status = "unsupported";
      return;
    }
    this.status = "ready";
    this.startRemotePolling();
  }

  async processFrame(input: VehicleFrameInput): Promise<VehicleFrameResult> {
    this.lastFrameMeta = {
      width: input.width,
      height: input.height,
      rotationDegrees: input.rotationDegrees,
    };
    return this.onDevice.processFrame(input);
  }

  async dispose(): Promise<void> {
    this.stopRemotePolling();
    this.handler = null;
    this.lastRemoteDetections = [];
    await this.onDevice.dispose();
    this.status = "disposed";
  }

  getStatus(): VehicleInferenceStatus {
    return this.status;
  }

  private freshRemoteDetections(): VehicleFrameResult["detections"] {
    if (this.lastRemoteDetections.length === 0) return [];
    if (Date.now() - this.lastRemoteAtMs > HYBRID_REMOTE_CACHE_MS) return [];
    return this.lastRemoteDetections;
  }

  private startRemotePolling(): void {
    this.stopRemotePolling();
    void this.pollRemote();
    this.remoteTimer = setInterval(() => {
      void this.pollRemote();
    }, this.remoteIntervalMs);
  }

  private stopRemotePolling(): void {
    if (this.remoteTimer) {
      clearInterval(this.remoteTimer);
      this.remoteTimer = null;
    }
  }

  private async pollRemote(): Promise<void> {
    if (this.status !== "ready" || this.remoteInFlight) return;
    this.remoteInFlight = true;
    try {
      const result = await this.remote.infer({
        timestampMs: Date.now(),
        frameWidth: this.lastFrameMeta.width,
        frameHeight: this.lastFrameMeta.height,
        rotationDegrees: this.lastFrameMeta.rotationDegrees,
      });
      if (!result || result.detections.length === 0) return;
      this.lastRemoteDetections = result.detections;
      this.lastRemoteAtMs = Date.now();
    } finally {
      this.remoteInFlight = false;
    }
  }
}
