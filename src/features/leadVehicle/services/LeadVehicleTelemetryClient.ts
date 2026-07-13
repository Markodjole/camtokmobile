import type {
  InferenceMode,
  LeadVehicleEvent,
  LeadVehicleTelemetryEvent,
} from "../domain/leadVehicle.types";
import { DEFAULT_LEAD_VEHICLE_MODEL_CONFIG } from "../domain/leadVehicle.constants";

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
      inferenceMode: InferenceMode;
      riderId: string;
      modelName?: string;
      modelVersion?: string;
      getPredictionReadiness?: () => {
        ready: boolean;
        confidence: number;
        reasons: string[];
        blockers: string[];
      } | null;
    },
  ) {}

  async publish(event: LeadVehicleEvent): Promise<void> {
    if (!this.opts.enabled) return;
    const mapped = mapEvent(event, this.opts);
    if (!mapped) return;
    const readiness = this.opts.getPredictionReadiness?.() ?? null;
    if (readiness) {
      mapped.payload.predictionReady = readiness.ready;
      mapped.payload.predictionConfidence = readiness.confidence;
      mapped.payload.predictionReasons = readiness.reasons;
      mapped.payload.predictionBlockers = readiness.blockers;
    }
    try {
      const { apiFetch } = await import("@/lib/api");
      await apiFetch(
        `/api/live/sessions/${event.sessionId}/lead-vehicle-events`,
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
        },
        modelMetadata: meta,
      };
    default:
      return null;
  }
}
