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
 * Best of both: on-device for ~real-time boxes, server refine every ~500ms with JPEG.
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
  private lastServerRoundCount: number | null = null;
  private lastServerRoundCountAtMs = 0;
  private lastImageBase64: string | null = null;
  private roundId: string | null = null;
  private lastFrameMeta: {
    width?: number;
    height?: number;
    rotationDegrees?: number;
  } = {};

  constructor(opts: HybridVehicleInferenceEngineOptions) {
    this.remote = new RemoteVehicleInferClient(opts.sessionId);
    this.remoteIntervalMs = opts.remoteIntervalMs ?? HYBRID_REMOTE_INTERVAL_MS;
  }

  setRoundId(roundId: string | null): void {
    this.roundId = roundId;
  }

  attachFrameHandler(handler: OnDeviceFrameHandler): void {
    this.handler = handler;
    this.onDevice.attachFrameHandler((local) => {
      if (local.frameWidth) this.lastFrameMeta.width = local.frameWidth;
      if (local.frameHeight) this.lastFrameMeta.height = local.frameHeight;
      if (local.rotationDegrees != null) {
        this.lastFrameMeta.rotationDegrees = local.rotationDegrees;
      }
      if (local.imageBase64) {
        this.lastImageBase64 = local.imageBase64;
      }
      const remote = this.freshRemoteDetections();
      const fused = remote.length
        ? fuseVehicleDetections(local.detections, remote)
        : local.detections;
      this.handler?.({
        ...local,
        detections: fused,
        serverRoundCount: this.freshServerRoundCount(),
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
    this.lastImageBase64 = null;
    this.roundId = null;
    await this.onDevice.dispose();
    this.status = "disposed";
  }

  getStatus(): VehicleInferenceStatus {
    return this.status;
  }

  /**
   * The JPEG sent to the server is the native 320×320 letterboxed model input
   * (aspect-preserved with gray padding). Server boxes come back normalized to
   * that padded image, so map them back into 0-1 frame space to align with the
   * on-device boxes and the viewer's full-frame video.
   */
  private unletterboxRemote(
    dets: VehicleFrameResult["detections"],
  ): VehicleFrameResult["detections"] {
    const w = this.lastFrameMeta.width;
    const h = this.lastFrameMeta.height;
    if (!w || !h) return dets;
    const INPUT = 320;
    const scale = Math.min(INPUT / w, INPUT / h);
    const scaledW = w * scale;
    const scaledH = h * scale;
    const padX = (INPUT - scaledW) / 2;
    const padY = (INPUT - scaledH) / 2;
    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    return dets.map((d) => {
      const b = d.boundingBox;
      const x0 = clamp01((b.x * INPUT - padX) / scaledW);
      const y0 = clamp01((b.y * INPUT - padY) / scaledH);
      const x1 = clamp01(((b.x + b.width) * INPUT - padX) / scaledW);
      const y1 = clamp01(((b.y + b.height) * INPUT - padY) / scaledH);
      return {
        ...d,
        boundingBox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      };
    });
  }

  private freshRemoteDetections(): VehicleFrameResult["detections"] {
    if (this.lastRemoteDetections.length === 0) return [];
    if (Date.now() - this.lastRemoteAtMs > HYBRID_REMOTE_CACHE_MS) return [];
    return this.lastRemoteDetections;
  }

  private freshServerRoundCount(): number | undefined {
    if (this.lastServerRoundCount == null) return undefined;
    if (Date.now() - this.lastServerRoundCountAtMs > HYBRID_REMOTE_CACHE_MS) {
      return undefined;
    }
    return this.lastServerRoundCount;
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
    if (!this.lastImageBase64) return;
    this.remoteInFlight = true;
    try {
      const result = await this.remote.infer({
        timestampMs: Date.now(),
        frameWidth: this.lastFrameMeta.width,
        frameHeight: this.lastFrameMeta.height,
        rotationDegrees: this.lastFrameMeta.rotationDegrees,
        imageBase64: this.lastImageBase64,
        roundId: this.roundId ?? undefined,
      });
      if (!result) return;
      if (result.detections.length > 0) {
        this.lastRemoteDetections = this.unletterboxRemote(result.detections);
        this.lastRemoteAtMs = Date.now();
      }
      if (typeof result.roundCount === "number") {
        this.lastServerRoundCount = result.roundCount;
        this.lastServerRoundCountAtMs = Date.now();
      }
    } finally {
      this.remoteInFlight = false;
    }
  }
}
