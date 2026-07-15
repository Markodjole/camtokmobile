import type {
  InferenceMode,
  LeadVehicleEvent,
  LeadVehicleTelemetryEvent,
  NormalizedBoundingBox,
  SupportedVehicleType,
} from "../domain/leadVehicle.types";
import { DEFAULT_LEAD_VEHICLE_MODEL_CONFIG } from "../domain/leadVehicle.constants";
import type { VehiclePassCounterSnapshot } from "../domain/leadVehicle.passCounter";

export type LeadVehicleOverlayDetection = {
  trackId?: string;
  vehicleType?: SupportedVehicleType;
  confidence?: number;
  isLead?: boolean;
  normalizedBoundingBox: NormalizedBoundingBox;
};

/**
 * Posts lead-vehicle telemetry onto the existing REST session channel.
 * Soft-fails if the camtok route is missing so streaming never breaks.
 *   POST /api/live/sessions/:sessionId/lead-vehicle-events
 */
export class LeadVehicleTelemetryClient {
  constructor(
    private opts: {
      enabled: boolean;
      includeBoundingBoxes: boolean;
      inferenceMode: InferenceMode | (() => InferenceMode);
      riderId: string;
      modelName?: string;
      modelVersion?: string;
      getPredictionReadiness?: () => {
        ready: boolean;
        confidence: number;
        reasons: string[];
        blockers: string[];
      } | null;
      getOverlayDetections?: () => LeadVehicleOverlayDetection[];
      getPassCounts?: () => Pick<
        VehiclePassCounterSnapshot,
        "vehiclesOnScreen" | "vehiclesPassed"
      > & {
        lastPass: {
          trackId: string;
          timestampMs: number;
          delta: 1 | -1;
        } | null;
      };
    },
  ) {}

  private inferenceMode(): InferenceMode {
    const m = this.opts.inferenceMode;
    return typeof m === "function" ? m() : m;
  }

  async publish(event: LeadVehicleEvent): Promise<void> {
    if (!this.opts.enabled) return;
    const mapped = mapEvent(event, {
      ...this.opts,
      inferenceMode: this.inferenceMode(),
    });
    if (!mapped) return;
    this.attachPassCounts(mapped);
    await this.send(mapped);
  }

  /** Rush Hour–style timed count round telemetry. */
  async publishRoundCount(args: {
    rideId: string;
    sessionId: string;
    timestampMs: number;
    roundId: string | null;
    roundCount: number;
    vehiclesOnScreen: number;
    counting: boolean;
    final?: boolean;
    detections?: LeadVehicleOverlayDetection[];
  }): Promise<void> {
    if (!this.opts.enabled) return;
    const mapped: LeadVehicleTelemetryEvent = {
      eventType: "vehicle_count_round",
      rideId: args.rideId,
      riderId: this.opts.riderId,
      sessionId: args.sessionId,
      timestampMs: args.timestampMs,
      payload: {
        roundId: args.roundId ?? undefined,
        roundCount: args.roundCount,
        vehiclesOnScreen: args.vehiclesOnScreen,
        roundCounting: args.counting,
        roundFinal: args.final === true,
        detections: args.detections,
        vehiclesPassed: args.roundCount,
      },
      modelMetadata: {
        modelName:
          this.opts.modelName ?? DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.modelName,
        modelVersion:
          this.opts.modelVersion ??
          DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.modelVersion,
        inferenceMode: this.inferenceMode(),
      },
    };
    await this.send(mapped);
  }

  /** Viewer overlay frame — works even with no locked lead. */
  async publishOverlayFrame(args: {
    rideId: string;
    sessionId: string;
    timestampMs: number;
    vehiclesOnScreen?: number;
    vehiclesPassed?: number;
    lastPass?: {
      trackId: string;
      timestampMs: number;
      delta: 1 | -1;
    } | null;
    lead: {
      trackId: string;
      vehicleType: SupportedVehicleType;
      confidence: number;
      sameDirectionConfidence: number;
      relativeState: string;
      visibleDurationMs: number;
      lateralPosition: "left" | "center" | "right";
      boundingBox: NormalizedBoundingBox;
    } | null;
  }): Promise<void> {
    if (!this.opts.enabled) return;
    const detections = this.opts.getOverlayDetections?.() ?? [];
    this.hadDetections = detections.length > 0 || !!args.lead;

    const mapped: LeadVehicleTelemetryEvent = {
      eventType: "lead_vehicle_updated",
      rideId: args.rideId,
      riderId: this.opts.riderId,
      sessionId: args.sessionId,
      timestampMs: args.timestampMs,
      payload: {
        ...(args.lead
          ? {
              trackId: args.lead.trackId,
              vehicleType: args.lead.vehicleType,
              confidence: args.lead.confidence,
              sameDirectionConfidence: args.lead.sameDirectionConfidence,
              relativeState:
                args.lead
                  .relativeState as LeadVehicleTelemetryEvent["payload"]["relativeState"],
              visibleDurationMs: args.lead.visibleDurationMs,
              lateralPosition: args.lead.lateralPosition,
              normalizedBoundingBox: args.lead.boundingBox,
            }
          : {}),
        detections,
        vehiclesOnScreen: args.vehiclesOnScreen,
        vehiclesPassed: args.vehiclesPassed,
        lastPass: args.lastPass
          ? {
              trackId: args.lastPass.trackId,
              timestampMs: args.lastPass.timestampMs,
              delta: args.lastPass.delta,
            }
          : undefined,
      },
      modelMetadata: {
        modelName:
          this.opts.modelName ?? DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.modelName,
        modelVersion:
          this.opts.modelVersion ??
          DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.modelVersion,
        inferenceMode: this.inferenceMode(),
      },
    };
    const readiness = this.opts.getPredictionReadiness?.() ?? null;
    if (readiness) {
      mapped.payload.predictionReady = readiness.ready;
      mapped.payload.predictionConfidence = readiness.confidence;
      mapped.payload.predictionReasons = readiness.reasons;
      mapped.payload.predictionBlockers = readiness.blockers;
    }
    await this.send(mapped);
  }

  private hadDetections = false;

  private attachPassCounts(mapped: LeadVehicleTelemetryEvent): void {
    const counts = this.opts.getPassCounts?.();
    if (!counts) return;
    mapped.payload.vehiclesOnScreen = counts.vehiclesOnScreen;
    mapped.payload.vehiclesPassed = counts.vehiclesPassed;
    if (counts.lastPass) {
      mapped.payload.lastPass = {
        trackId: counts.lastPass.trackId,
        timestampMs: counts.lastPass.timestampMs,
        delta: counts.lastPass.delta,
      };
    }
  }

  private async send(mapped: LeadVehicleTelemetryEvent): Promise<void> {
    const readiness = this.opts.getPredictionReadiness?.() ?? null;
    if (readiness && mapped.payload.predictionReady == null) {
      mapped.payload.predictionReady = readiness.ready;
      mapped.payload.predictionConfidence = readiness.confidence;
      mapped.payload.predictionReasons = readiness.reasons;
      mapped.payload.predictionBlockers = readiness.blockers;
    }
    this.attachPassCounts(mapped);
    if (this.opts.includeBoundingBoxes) {
      const dets = this.opts.getOverlayDetections?.() ?? [];
      if (dets.length > 0) {
        mapped.payload.detections = dets;
      } else if (mapped.eventType === "lead_vehicle_lost") {
        mapped.payload.detections = [];
      }
    }
    try {
      const { apiFetch } = await import("@/lib/api");
      await apiFetch(
        `/api/live/sessions/${mapped.sessionId}/lead-vehicle-events`,
        {
          method: "POST",
          body: mapped as unknown as Record<string, unknown>,
        },
      );
    } catch {
      // Soft-fail: engine/backend may not be deployed yet.
    }
  }
}

function mapEvent(
  event: LeadVehicleEvent,
  opts: {
    includeBoundingBoxes: boolean;
    inferenceMode: InferenceMode;
    riderId: string;
    modelName?: string;
    modelVersion?: string;
  },
): LeadVehicleTelemetryEvent | null {
  const meta = {
    modelName: opts.modelName ?? DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.modelName,
    modelVersion:
      opts.modelVersion ?? DEFAULT_LEAD_VEHICLE_MODEL_CONFIG.modelVersion,
    inferenceMode: opts.inferenceMode,
  };

  switch (event.type) {
    case "lead_vehicle_acquired":
    case "lead_vehicle_updated":
      return {
        eventType:
          event.type === "lead_vehicle_acquired"
            ? "lead_vehicle_acquired"
            : "lead_vehicle_updated",
        rideId: event.rideId,
        riderId: opts.riderId,
        sessionId: event.sessionId,
        timestampMs: event.timestampMs,
        payload: {
          trackId: event.vehicle.trackId,
          vehicleType: event.vehicle.vehicleType,
          confidence: event.vehicle.confidence,
          sameDirectionConfidence: event.vehicle.sameDirectionConfidence,
          relativeState: event.vehicle.relativeState,
          visibleDurationMs: event.vehicle.visibleDurationMs,
          lateralPosition: event.vehicle.lateralPosition,
          normalizedBoundingBox: opts.includeBoundingBoxes
            ? event.vehicle.boundingBox
            : undefined,
        },
        modelMetadata: meta,
      };
    case "lead_vehicle_movement_changed":
      return {
        eventType: "lead_vehicle_state_changed",
        rideId: event.rideId,
        riderId: opts.riderId,
        sessionId: event.sessionId,
        timestampMs: event.timestampMs,
        payload: {
          trackId: event.trackId,
          vehicleType: event.vehicle.vehicleType,
          relativeState: event.nextState,
          confidence: event.vehicle.confidence,
          sameDirectionConfidence: event.vehicle.sameDirectionConfidence,
          visibleDurationMs: event.vehicle.visibleDurationMs,
          lateralPosition: event.vehicle.lateralPosition,
          normalizedBoundingBox: opts.includeBoundingBoxes
            ? event.vehicle.boundingBox
            : undefined,
        },
        modelMetadata: meta,
      };
    case "lead_vehicle_changed":
      return {
        eventType: "lead_vehicle_changed",
        rideId: event.rideId,
        riderId: opts.riderId,
        sessionId: event.sessionId,
        timestampMs: event.timestampMs,
        payload: {
          trackId: event.nextTrackId,
          vehicleType: event.nextVehicleType,
        },
        modelMetadata: meta,
      };
    case "lead_vehicle_lost":
      return {
        eventType: "lead_vehicle_lost",
        rideId: event.rideId,
        riderId: opts.riderId,
        sessionId: event.sessionId,
        timestampMs: event.timestampMs,
        payload: {
          trackId: event.trackId,
          vehicleType: event.lastKnownVehicleType,
          visibleDurationMs: event.trackedDurationMs,
          detections: [],
        },
        modelMetadata: meta,
      };
    default:
      return null;
  }
}
