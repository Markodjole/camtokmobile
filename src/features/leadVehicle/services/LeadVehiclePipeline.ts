import {
  DEFAULT_FORWARD_CORRIDOR,
  DEFAULT_INFERENCE_FPS,
  DEFAULT_LEAD_VEHICLE_MODEL_CONFIG,
} from "../domain/leadVehicle.constants";
import { lateralPositionFromX } from "../domain/leadVehicle.geometry";
import { classifyRelativeMovement } from "../domain/leadVehicle.motion";
import { computePredictionReadiness } from "../domain/leadVehicle.prediction";
import {
  estimateSameDirectionConfidence,
  scoreLeadVehicle,
} from "../domain/leadVehicle.scoring";
import { advanceLeadStateMachine } from "../domain/leadVehicle.stateMachine";
import type {
  ForwardCorridor,
  InferenceMode,
  LeadVehicleEvent,
  LeadVehiclePredictionReadiness,
  LeadVehicleRuntimeMetrics,
  LeadVehicleSnapshot,
  LeadVehicleTrackingState,
  RiderTelemetrySnapshot,
  TrackedVehicle,
  VehicleDetection,
  VehicleFrameInput,
} from "../domain/leadVehicle.types";
import type { VehicleInferenceEngine } from "./VehicleInferenceEngine";
import { createVehicleInferenceEngine } from "./createVehicleInferenceEngine";
import { LeadVehicleEventEmitter } from "./LeadVehicleEventEmitter";
import { LeadVehicleTelemetryClient } from "./LeadVehicleTelemetryClient";
import { LeadVehicleTracker } from "./LeadVehicleTracker";
import { OnDeviceVehicleInferenceEngine } from "./OnDeviceVehicleInferenceEngine";

export type LeadVehiclePipelineOptions = {
  rideId: string;
  sessionId: string;
  riderId: string;
  inferenceMode: InferenceMode;
  inferenceFps?: number;
  telemetryEnabled?: boolean;
  includeBoundingBoxes?: boolean;
  corridor?: ForwardCorridor;
  engine?: VehicleInferenceEngine;
};

export type LeadVehiclePipelineSnapshot = {
  status: LeadVehicleTrackingState;
  leadVehicle: LeadVehicleSnapshot | null;
  tracks: TrackedVehicle[];
  detections: VehicleDetection[];
  predictionReadiness: LeadVehiclePredictionReadiness;
  metrics: LeadVehicleRuntimeMetrics;
  scoreBreakdown: ReturnType<typeof scoreLeadVehicle> | null;
  corridor: ForwardCorridor;
  error: Error | null;
};

/**
 * Owns inference backpressure, tracking, lead selection, and events.
 * Frame source can be mock timer or future native VideoFrameProcessor.
 */
export class LeadVehiclePipeline {
  private engine: VehicleInferenceEngine;
  private tracker = new LeadVehicleTracker();
  private events = new LeadVehicleEventEmitter();
  private telemetry: LeadVehicleTelemetryClient;
  private status: LeadVehicleTrackingState = "idle";
  private leadTrackId: string | null = null;
  private previousLead: TrackedVehicle | null = null;
  private candidateSinceMs: number | null = null;
  private switchChallengerId: string | null = null;
  private switchChallengerSinceMs: number | null = null;
  private lostSinceMs: number | null = null;
  private frameId = 0;
  private busy = false;
  private pending: VehicleFrameInput | null = null;
  private dropped = 0;
  private inferenceDurations: number[] = [];
  private inferenceTimes: number[] = [];
  private lastDetections: VehicleDetection[] = [];
  private lastScore: ReturnType<typeof scoreLeadVehicle> | null = null;
  private error: Error | null = null;
  private telemetrySnap: RiderTelemetrySnapshot | undefined;
  private corridor: ForwardCorridor;
  private inferenceFps: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: LeadVehiclePipelineOptions;
  private listeners = new Set<() => void>();

  constructor(opts: LeadVehiclePipelineOptions) {
    this.opts = opts;
    this.corridor = opts.corridor ?? DEFAULT_FORWARD_CORRIDOR;
    this.inferenceFps = opts.inferenceFps ?? DEFAULT_INFERENCE_FPS;
    this.engine = opts.engine ?? createVehicleInferenceEngine(opts.inferenceMode);
    this.telemetry = new LeadVehicleTelemetryClient({
      enabled: opts.telemetryEnabled === true,
      includeBoundingBoxes: opts.includeBoundingBoxes !== false,
      inferenceMode: () => this.opts.inferenceMode,
      riderId: opts.riderId,
      getPredictionReadiness: () => {
        const snap = this.getSnapshot();
        return snap.predictionReadiness;
      },
    });
    this.events.subscribe((ev) => {
      void this.telemetry.publish(ev);
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (event: LeadVehicleEvent) => void): () => void {
    return this.events.subscribe(listener);
  }

  setRiderTelemetry(snap: RiderTelemetrySnapshot | undefined): void {
    this.telemetrySnap = snap;
  }

  private effectiveTelemetry(): RiderTelemetrySnapshot | undefined {
    const t = this.telemetrySnap;
    // Mock demos often have 0 GPS speed while stationary — seed a cruise
    // speed so prediction readiness can clear "rider_too_slow".
    if (this.opts.inferenceMode === "mock") {
      const speed = t?.speedMetersPerSecond;
      if (speed == null || speed < 1) {
        return { ...t, speedMetersPerSecond: 5.5 };
      }
    }
    return t;
  }

  async start(): Promise<void> {
    if (this.status !== "idle" && this.status !== "stopped" && this.status !== "error") {
      return;
    }
    this.error = null;
    this.tracker.reset();
    this.events.reset();
    this.leadTrackId = null;
    this.previousLead = null;
    this.candidateSinceMs = null;
    this.switchChallengerId = null;
    this.switchChallengerSinceMs = null;
    this.lostSinceMs = null;
    this.dropped = 0;
    this.frameId = 0;
    try {
      await this.engine.initialize();
      const st = this.engine.getStatus();
      if (st === "unsupported") {
        if (this.opts.inferenceMode === "on_device") {
          // Dev client / iOS without linked TFLite → keep UX working via mock.
          console.warn(
            "[leadVehicle] on_device unavailable in this build; falling back to mock",
          );
          this.engine = createVehicleInferenceEngine("mock");
          await this.engine.initialize();
          this.opts = { ...this.opts, inferenceMode: "mock" };
          this.status = "warming_up";
          this.notify();
          this.status = "searching";
          this.notify();
          this.startMockPump();
          return;
        }
        this.status = "error";
        this.error = new Error(
          "On-device vehicle inference is not available on this build yet",
        );
        this.notify();
        return;
      }
      this.status = "warming_up";
      this.notify();
      // Warm-up → searching
      this.status = "searching";
      this.notify();

      if (this.engine instanceof OnDeviceVehicleInferenceEngine) {
        this.engine.attachFrameHandler((result) => {
          this.inferenceDurations.push(result.inferenceDurationMs);
          if (this.inferenceDurations.length > 30) this.inferenceDurations.shift();
          this.inferenceTimes.push(result.timestampMs);
          if (this.inferenceTimes.length > 30) this.inferenceTimes.shift();
          void this.applyDetections(
            result.detections,
            result.timestampMs,
            result.inferenceDurationMs,
          );
        });
      }

      if (this.opts.inferenceMode === "mock") {
        this.startMockPump();
      }
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? e : new Error(String(e));
      this.events.emitError(
        this.opts.rideId,
        this.opts.sessionId,
        Date.now(),
        this.error.message,
      );
      this.notify();
    }
  }

  async stop(): Promise<void> {
    this.stopMockPump();
    this.pending = null;
    this.busy = false;
    try {
      await this.engine.dispose();
    } catch {
      // ignore
    }
    this.status = "stopped";
    this.notify();
  }

  reset(): void {
    this.tracker.reset();
    this.events.reset();
    this.leadTrackId = null;
    this.previousLead = null;
    this.candidateSinceMs = null;
    this.lostSinceMs = null;
    this.lastDetections = [];
    this.lastScore = null;
    if (this.status !== "stopped" && this.status !== "idle") {
      this.status = "searching";
    }
    this.notify();
  }

  /**
   * Ingest a frame from native processor or tests.
   * Applies newest-frame-wins backpressure.
   */
  ingestFrame(partial?: Partial<VehicleFrameInput>): void {
    if (this.status === "idle" || this.status === "stopped") return;
    this.frameId += 1;
    const input: VehicleFrameInput = {
      frameId: this.frameId,
      timestampMs: Date.now(),
      width: DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.inputWidth,
      height: DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.inputHeight,
      rotationDegrees: 0,
      riderTelemetry: this.effectiveTelemetry(),
      ...partial,
    };
    if (this.busy) {
      this.pending = input;
      this.dropped += 1;
      return;
    }
    void this.runFrame(input);
  }

  getSnapshot(): LeadVehiclePipelineSnapshot {
    const tracks = this.tracker.getTracks();
    const leadTrack = this.leadTrackId
      ? tracks.find((t) => t.trackId === this.leadTrackId) ?? this.previousLead
      : null;
    const leadVehicle = leadTrack
      ? this.toSnapshot(leadTrack, Date.now())
      : null;
    return {
      status: this.status,
      leadVehicle,
      tracks,
      detections: this.lastDetections,
      predictionReadiness: computePredictionReadiness(
        leadVehicle,
        this.status,
        this.effectiveTelemetry(),
      ),
      metrics: this.metrics(),
      scoreBreakdown: this.lastScore,
      corridor: this.corridor,
      error: this.error,
    };
  }

  /** Test / integration: push detections without an engine. */
  async processDetectionsForTest(
    detections: VehicleDetection[],
    timestampMs: number,
  ): Promise<void> {
    await this.applyDetections(detections, timestampMs, 1);
  }

  private startMockPump(): void {
    this.stopMockPump();
    const interval = Math.max(50, Math.round(1000 / this.inferenceFps));
    this.timer = setInterval(() => {
      this.ingestFrame({ timestampMs: Date.now() });
    }, interval);
  }

  private stopMockPump(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runFrame(input: VehicleFrameInput): Promise<void> {
    this.busy = true;
    try {
      const result = await this.engine.processFrame(input);
      this.inferenceDurations.push(result.inferenceDurationMs);
      if (this.inferenceDurations.length > 30) this.inferenceDurations.shift();
      this.inferenceTimes.push(result.timestampMs);
      if (this.inferenceTimes.length > 30) this.inferenceTimes.shift();
      await this.applyDetections(
        result.detections,
        result.timestampMs,
        result.inferenceDurationMs,
      );
    } catch (e) {
      this.error = e instanceof Error ? e : new Error(String(e));
      this.events.emitError(
        this.opts.rideId,
        this.opts.sessionId,
        Date.now(),
        this.error.message,
      );
      // Soft-disable analysis; keep stream alive.
      this.status = "error";
    } finally {
      this.busy = false;
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        void this.runFrame(next);
      }
    }
  }

  private async applyDetections(
    detections: VehicleDetection[],
    timestampMs: number,
    _inferenceMs: number,
  ): Promise<void> {
    this.lastDetections = detections;
    const tracks = this.tracker.update(detections, timestampMs);
    const mature = this.tracker.matureTracks();

    let best: TrackedVehicle | null = null;
    let bestScore = -1;
    let bestBreakdown: ReturnType<typeof scoreLeadVehicle> | null = null;
    for (const track of mature) {
      const breakdown = scoreLeadVehicle(track, {
        corridor: this.corridor,
        telemetry: this.effectiveTelemetry(),
      });
      if (breakdown.totalScore > bestScore) {
        bestScore = breakdown.totalScore;
        best = track;
        bestBreakdown = breakdown;
      }
    }
    this.lastScore = bestBreakdown;

    const currentLead =
      (this.leadTrackId
        ? tracks.find((t) => t.trackId === this.leadTrackId)
        : null) ?? null;
    const currentLeadScore = currentLead
      ? scoreLeadVehicle(currentLead, {
          corridor: this.corridor,
          telemetry: this.effectiveTelemetry(),
        }).totalScore
      : 0;

    const sm = advanceLeadStateMachine(this.status, {
      nowMs: timestampMs,
      bestTrackId: best?.trackId ?? null,
      bestScore,
      currentLeadTrackId: this.leadTrackId,
      currentLeadScore,
      leadStillVisible: !!currentLead && currentLead.missedFrameCount === 0,
      candidateSinceMs: this.candidateSinceMs,
      switchChallengerId: this.switchChallengerId,
      switchChallengerSinceMs: this.switchChallengerSinceMs,
      lostSinceMs: this.lostSinceMs,
    });

    const prevLeadId = this.leadTrackId;
    const prevLeadType = this.previousLead?.vehicleType;
    this.status = sm.state;
    this.leadTrackId = sm.leadTrackId;
    this.candidateSinceMs = sm.candidateSinceMs;
    this.switchChallengerId = sm.switchChallengerId;
    this.switchChallengerSinceMs = sm.switchChallengerSinceMs;
    this.lostSinceMs = sm.lostSinceMs;

    const leadTrack =
      (this.leadTrackId
        ? tracks.find((t) => t.trackId === this.leadTrackId)
        : null) ?? null;
    if (leadTrack) this.previousLead = leadTrack;

    if (sm.transition === "acquired" && leadTrack) {
      const snap = this.toSnapshot(leadTrack, timestampMs);
      this.events.emitAcquired(this.opts.rideId, this.opts.sessionId, snap);
    } else if (sm.transition === "lost" && prevLeadId && prevLeadType) {
      this.events.emitLost(this.opts.rideId, this.opts.sessionId, {
        timestampMs,
        trackId: prevLeadId,
        lastKnownVehicleType: prevLeadType,
        trackedDurationMs: this.previousLead?.visibleDurationMs ?? 0,
      });
    } else if (sm.transition === "temporarily_lost" && prevLeadId && prevLeadType) {
      this.events.emitTemporarilyLost(this.opts.rideId, this.opts.sessionId, {
        timestampMs,
        trackId: prevLeadId,
        vehicleType: prevLeadType,
      });
    } else if (
      sm.transition === "switched" &&
      prevLeadId &&
      leadTrack &&
      prevLeadType
    ) {
      const snap = this.toSnapshot(leadTrack, timestampMs);
      this.events.emitChanged(this.opts.rideId, this.opts.sessionId, {
        timestampMs,
        previousTrackId: prevLeadId,
        nextTrackId: leadTrack.trackId,
        previousVehicleType: prevLeadType,
        nextVehicleType: leadTrack.vehicleType,
        reason: sm.switchReason ?? "challenger_more_relevant",
        vehicle: snap,
      });
    } else if (leadTrack && this.status === "tracking") {
      this.events.maybeEmitUpdate(
        this.opts.rideId,
        this.opts.sessionId,
        this.toSnapshot(leadTrack, timestampMs, currentLead?.missedFrameCount !== 0),
      );
    }

    this.notify();
  }

  private toSnapshot(
    track: TrackedVehicle,
    timestampMs: number,
    occluded = false,
  ): LeadVehicleSnapshot {
    const sameDirectionConfidence = estimateSameDirectionConfidence(
      track,
      this.effectiveTelemetry(),
    );
    const corridorConfidence = scoreLeadVehicle(track, {
      corridor: this.corridor,
      telemetry: this.effectiveTelemetry(),
    }).corridorScore;
    const relativeState = classifyRelativeMovement(track, {
      nowMs: timestampMs,
      occluded: occluded || track.missedFrameCount > 0,
    });
    return {
      timestampMs,
      sessionId: this.opts.sessionId,
      trackId: track.trackId,
      vehicleType: track.vehicleType,
      boundingBox: track.boundingBox,
      confidence: track.trackingConfidence,
      sameDirectionConfidence,
      corridorConfidence,
      relativeState,
      visibleDurationMs: track.visibleDurationMs,
      lateralPosition: lateralPositionFromX(track.bottomCenter.x),
    };
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
    // Adaptive throttle hint
    if (avg > 120 && this.inferenceFps > 4) {
      this.inferenceFps = Math.max(4, this.inferenceFps - 1);
      if (this.opts.inferenceMode === "mock" && this.timer) {
        this.startMockPump();
      }
    }
    return {
      inferenceFps: fps,
      averageInferenceDurationMs: avg,
      droppedAnalysisFrames: this.dropped,
      trackerCount: this.tracker.getTracks().length,
      lastInferenceAtMs:
        this.inferenceTimes[this.inferenceTimes.length - 1] ?? null,
      thermalWarning: avg > 150,
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
