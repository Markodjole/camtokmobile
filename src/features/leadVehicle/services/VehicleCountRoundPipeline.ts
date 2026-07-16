import {
  DEFAULT_FORWARD_CORRIDOR,
  DEFAULT_INFERENCE_FPS,
  EVENT_HEARTBEAT_MS,
} from "../domain/leadVehicle.constants";
import { filterVehicleDetections } from "../domain/leadVehicle.vehicleFilter";
import { normalizeVehicleDetections } from "../domain/leadVehicle.normalize";
import { LeadVehicleFollower } from "../domain/leadVehicle.follower";
import {
  VehicleCountRoundCounter,
  type VehicleCountRoundSnapshot,
} from "../domain/vehicleCountRound.counter";
import {
  SERVER_COUNT_STALE_MS,
  VEHICLE_COUNT_LINE_Y,
} from "../domain/vehicleCountRound.constants";
import type {
  ForwardCorridor,
  InferenceMode,
  LeadVehicleRuntimeMetrics,
  RiderTelemetrySnapshot,
  VehicleDetection,
  VehicleFrameInput,
} from "../domain/leadVehicle.types";
import {
  createVehicleInferenceEngine,
  engineSupportsPushFrames,
} from "./createVehicleInferenceEngine";
import { HybridVehicleInferenceEngine } from "./HybridVehicleInferenceEngine";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";
import { LeadVehicleTelemetryClient } from "./LeadVehicleTelemetryClient";
import type { LeadVehicleOverlayDetection } from "./LeadVehicleTelemetryClient";
import {
  leadVehicleNativePresent,
  leadVehicleNativeSetEnabled,
  leadVehicleNativeSetSamplingEnabled,
} from "@/lib/leadVehicleNative";

export type VehicleCountRoundPipelineOptions = {
  rideId: string;
  sessionId: string;
  riderId: string;
  inferenceMode: InferenceMode;
  telemetryEnabled?: boolean;
  corridor?: ForwardCorridor;
  engine?: VehicleInferenceEngine;
};

export type VehicleCountRoundPipelineSnapshot = {
  round: VehicleCountRoundSnapshot;
  detections: VehicleDetection[];
  metrics: LeadVehicleRuntimeMetrics;
  corridor: ForwardCorridor;
  countLineY: number;
  error: Error | null;
};

/**
 * Rush Hour–style pipeline: inference runs only during active count windows.
 * No continuous lead tracking.
 */
export class VehicleCountRoundPipeline {
  private engine: VehicleInferenceEngine;
  private roundCounter = new VehicleCountRoundCounter();
  private telemetry: LeadVehicleTelemetryClient;
  private corridor: ForwardCorridor;
  private inferenceFps: number;
  private opts: VehicleCountRoundPipelineOptions;
  private listeners = new Set<() => void>();
  private engineStarted = false;
  private counting = false;
  /** When true, detection + boxes run continuously (no counting) so the rider
   *  can see that vehicles are being recognized even outside a count window. */
  private preview = false;
  private busy = false;
  private dropped = 0;
  private inferenceDurations: number[] = [];
  private inferenceTimes: number[] = [];
  private lastDetections: VehicleDetection[] = [];
  private lastRound: VehicleCountRoundSnapshot = {
    roundId: null,
    count: 0,
    vehiclesOnScreen: 0,
    counting: false,
  };
  private error: Error | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private overlayTimer: ReturnType<typeof setInterval> | null = null;
  private lastOverlayMs = 0;
  private frameId = 0;
  private lastServerRoundCount: number | null = null;
  private lastServerRoundCountAtMs = 0;
  private activeRoundId: string | null = null;
  /** Preview mode: follow a single lead vehicle instead of boxing all. */
  private leadFollower = new LeadVehicleFollower();
  private previewLead: LeadVehicleOverlayDetection | null = null;
  /** Vehicles we've overtaken while following ("+1 passed" on the viewer). */
  private previewPasses = 0;
  private previewLastPass: {
    trackId: string;
    timestampMs: number;
    delta: 1 | -1;
  } | null = null;

  constructor(opts: VehicleCountRoundPipelineOptions) {
    this.opts = opts;
    this.corridor = opts.corridor ?? DEFAULT_FORWARD_CORRIDOR;
    this.inferenceFps = DEFAULT_INFERENCE_FPS;
    this.engine =
      opts.engine ??
      createVehicleInferenceEngine(opts.inferenceMode, {
        sessionId: opts.sessionId,
      });
    this.telemetry = new LeadVehicleTelemetryClient({
      enabled: opts.telemetryEnabled === true,
      includeBoundingBoxes: true,
      inferenceMode: () => this.opts.inferenceMode,
      riderId: opts.riderId,
      getOverlayDetections: () => this.buildOverlayDetections(),
      getPassCounts: () => ({
        vehiclesOnScreen: this.lastRound.vehiclesOnScreen,
        vehiclesPassed: this.counting ? this.lastRound.count : this.previewPasses,
        lastPass: this.previewLastPass,
      }),
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Live detection preview: keeps native inference + overlay boxes running even
   * when no count round is active, so the rider can confirm vehicles are seen.
   * Counting still only happens inside an active round.
   */
  async setPreviewEnabled(on: boolean): Promise<void> {
    if (this.preview === on) return;
    this.preview = on;
    if (on && !this.engineStarted) {
      await this.ensureEngine();
    }
    await this.syncNative();
    if (on && this.opts.inferenceMode === "mock") {
      this.startMockPump();
    } else if (!on && !this.counting) {
      this.stopMockPump();
    }
    this.notify();
  }

  async setRoundPhase(roundId: string | null, counting: boolean): Promise<void> {
    if (counting && roundId) {
      if (!this.engineStarted) {
        await this.ensureEngine();
      }
      this.activeRoundId = roundId;
      this.lastServerRoundCount = null;
      this.lastServerRoundCountAtMs = 0;
      if (this.engine instanceof HybridVehicleInferenceEngine) {
        this.engine.setRoundId(roundId);
      }
      this.roundCounter.beginRound(roundId);
      this.counting = true;
      await this.syncNative();
      if (this.opts.inferenceMode === "mock") {
        this.startMockPump();
      }
      this.startOverlayPump();
    } else {
      const wasCounting = this.counting;
      const finalRound = this.lastRound;
      this.counting = false;
      this.roundCounter.endRound();
      this.stopOverlayPump();
      await this.syncNative();
      if (!this.preview) {
        this.stopMockPump();
      }
      if (this.engine instanceof HybridVehicleInferenceEngine) {
        this.engine.setRoundId(null);
      }
      if (wasCounting && finalRound.roundId) {
        await this.pushRoundTelemetry(Date.now(), true);
      }
      this.activeRoundId = null;
    }
    this.notify();
  }

  async ensureEngine(): Promise<void> {
    if (this.engineStarted) return;
    await this.engine.initialize();
    if (this.engine.getStatus() === "unsupported") {
      if (this.opts.inferenceMode === "on_device" || this.opts.inferenceMode === "hybrid") {
        this.engine = createVehicleInferenceEngine("mock");
        this.opts = { ...this.opts, inferenceMode: "mock" };
        await this.engine.initialize();
      } else {
        this.error = new Error("Vehicle inference unavailable on this build");
        this.notify();
        return;
      }
    }
    // JPEG frame sampling is pure extra CPU work meant only for hybrid
    // (server-refine) mode — leave it off for on-device-only tracking so it
    // doesn't compete with the video encoder.
    void this.setNativeSamplingEnabled(this.opts.inferenceMode === "hybrid");
    if (engineSupportsPushFrames(this.engine)) {
      this.engine.attachFrameHandler((result) => {
        this.inferenceDurations.push(result.inferenceDurationMs);
        if (this.inferenceDurations.length > 30) this.inferenceDurations.shift();
        this.inferenceTimes.push(result.timestampMs);
        if (this.inferenceTimes.length > 30) this.inferenceTimes.shift();
        if (typeof result.serverRoundCount === "number") {
          this.lastServerRoundCount = result.serverRoundCount;
          this.lastServerRoundCountAtMs = Date.now();
        }
        void this.applyDetections(
          result.detections,
          result.timestampMs,
          result.serverRoundCount,
        ).catch((e) => {
          console.warn(
            "[vehicleCountRound] applyDetections failed",
            e instanceof Error ? e.message : e,
          );
        });
      });
    }
    this.engineStarted = true;
  }

  async stop(): Promise<void> {
    this.counting = false;
    this.preview = false;
    this.stopMockPump();
    this.stopOverlayPump();
    await this.setNativeEnabled(false);
    try {
      await this.engine.dispose();
    } catch {
      // ignore
    }
    this.engineStarted = false;
    this.roundCounter.reset();
    this.notify();
  }

  getSnapshot(): VehicleCountRoundPipelineSnapshot {
    return {
      round: this.lastRound,
      detections: this.lastDetections,
      metrics: this.metrics(),
      corridor: this.corridor,
      countLineY: VEHICLE_COUNT_LINE_Y,
      error: this.error,
    };
  }

  private async applyDetections(
    detections: VehicleDetection[],
    timestampMs: number,
    serverRoundCount?: number,
  ): Promise<void> {
    if (!this.counting && !this.preview) return;
    const vehicles = filterVehicleDetections(
      normalizeVehicleDetections(detections),
    );
    this.lastDetections = vehicles;

    // Always follow a single lead vehicle (the one ahead, moving with us) and
    // stream just that one box + status — regardless of betting-round state.
    // When it's passed, the follower lets go and picks up the next one.
    const lead = this.leadFollower.observe(vehicles, timestampMs);
    this.previewLead = lead
      ? {
          trackId: lead.trackId,
          vehicleType: lead.vehicleLabel,
          confidence: 1,
          isLead: true,
          status: lead.status,
          normalizedBoundingBox: lead.boundingBox,
        }
      : null;
    const pass = this.leadFollower.takePassEvent();
    if (pass) {
      this.previewPasses += 1;
      this.previewLastPass = {
        trackId: pass.trackId,
        timestampMs: pass.timestampMs,
        delta: 1,
      };
    }

    if (!this.counting) {
      this.lastRound = {
        ...this.lastRound,
        vehiclesOnScreen: lead ? 1 : 0,
      };
      this.notify();
      const nowWall = Date.now();
      if (nowWall - this.lastOverlayMs >= EVENT_HEARTBEAT_MS || pass) {
        this.lastOverlayMs = nowWall;
        void this.pushOverlayFrame(timestampMs);
      }
      return;
    }

    this.lastRound = this.roundCounter.observeDetections(vehicles, timestampMs);
    if (typeof serverRoundCount === "number") {
      this.lastServerRoundCount = serverRoundCount;
      this.lastServerRoundCountAtMs = Date.now();
    }
    this.lastRound = {
      ...this.lastRound,
      count: this.effectiveCount(this.lastRound.count),
    };
    this.notify();

    const nowWall = Date.now();
    if (nowWall - this.lastOverlayMs >= EVENT_HEARTBEAT_MS) {
      this.lastOverlayMs = nowWall;
      void this.pushRoundTelemetry(timestampMs);
    }
  }

  private effectiveCount(localCount: number): number {
    if (this.lastServerRoundCount == null) return localCount;
    if (Date.now() - this.lastServerRoundCountAtMs > SERVER_COUNT_STALE_MS) {
      return localCount;
    }
    return Math.max(localCount, this.lastServerRoundCount);
  }

  private async pushRoundTelemetry(
    timestampMs: number,
    final = false,
  ): Promise<void> {
    const count = this.effectiveCount(this.lastRound.count);
    await this.telemetry.publishRoundCount({
      rideId: this.opts.rideId,
      sessionId: this.opts.sessionId,
      timestampMs,
      roundId: this.lastRound.roundId,
      roundCount: count,
      vehiclesOnScreen: this.lastRound.vehiclesOnScreen,
      counting: final ? false : this.lastRound.counting,
      final,
      detections: this.buildOverlayDetections(),
    });
  }

  /** Viewer overlay frame outside count rounds — boxes only, no counting. */
  private async pushOverlayFrame(timestampMs: number): Promise<void> {
    await this.telemetry.publishOverlayFrame({
      rideId: this.opts.rideId,
      sessionId: this.opts.sessionId,
      timestampMs,
      lead: null,
    });
  }

  private buildOverlayDetections(): LeadVehicleOverlayDetection[] {
    // Always exactly one followed lead vehicle — never box every vehicle.
    return this.previewLead ? [this.previewLead] : [];
  }

  private startMockPump(): void {
    this.stopMockPump();
    const interval = Math.max(50, Math.round(1000 / this.inferenceFps));
    this.timer = setInterval(() => {
      if (!this.counting && !this.preview) return;
      this.frameId += 1;
      void this.runMockFrame({
        frameId: this.frameId,
        timestampMs: Date.now(),
        width: 320,
        height: 320,
        rotationDegrees: 0,
      });
    }, interval);
  }

  private stopMockPump(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runMockFrame(input: VehicleFrameInput): Promise<void> {
    if (this.busy) {
      this.dropped += 1;
      return;
    }
    this.busy = true;
    try {
      const result = await this.engine.processFrame(input);
      await this.applyDetections(result.detections, result.timestampMs);
    } finally {
      this.busy = false;
    }
  }

  private startOverlayPump(): void {
    this.stopOverlayPump();
    this.overlayTimer = setInterval(() => {
      if (!this.counting) return;
      const now = Date.now();
      if (now - this.lastOverlayMs < EVENT_HEARTBEAT_MS) return;
      this.lastOverlayMs = now;
      void this.pushRoundTelemetry(now);
    }, EVENT_HEARTBEAT_MS);
  }

  private stopOverlayPump(): void {
    if (this.overlayTimer) {
      clearInterval(this.overlayTimer);
      this.overlayTimer = null;
    }
  }

  /** Native detection stays on while counting OR previewing. */
  private async syncNative(): Promise<void> {
    await this.setNativeEnabled(this.counting || this.preview);
  }

  private async setNativeEnabled(enabled: boolean): Promise<void> {
    if (!leadVehicleNativePresent()) return;
    try {
      await leadVehicleNativeSetEnabled(enabled);
    } catch {
      // ignore
    }
  }

  private async setNativeSamplingEnabled(enabled: boolean): Promise<void> {
    if (!leadVehicleNativePresent()) return;
    try {
      await leadVehicleNativeSetSamplingEnabled(enabled);
    } catch {
      // ignore
    }
  }

  private metrics(): LeadVehicleRuntimeMetrics {
    const avg =
      this.inferenceDurations.length === 0
        ? 0
        : this.inferenceDurations.reduce((a, b) => a + b, 0) /
          this.inferenceDurations.length;
    let fps = 0;
    if (this.inferenceTimes.length >= 2) {
      const first = this.inferenceTimes[0]!;
      const last = this.inferenceTimes[this.inferenceTimes.length - 1]!;
      const dt = (last - first) / 1000;
      if (dt > 0) fps = (this.inferenceTimes.length - 1) / dt;
    }
    return {
      inferenceFps: fps,
      averageInferenceDurationMs: avg,
      droppedAnalysisFrames: this.dropped,
      trackerCount: this.lastRound.vehiclesOnScreen,
      lastInferenceAtMs:
        this.inferenceTimes[this.inferenceTimes.length - 1] ?? null,
      thermalWarning: avg > 150,
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
