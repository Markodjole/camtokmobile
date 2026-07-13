import {
  PREDICTION_MIN_RIDER_SPEED_MPS,
  PREDICTION_MIN_VISIBLE_MS,
  SAME_DIRECTION_THRESHOLD,
} from "./leadVehicle.constants";
import { pointInTrapezoid } from "./leadVehicle.geometry";
import { DEFAULT_FORWARD_CORRIDOR } from "./leadVehicle.constants";
import type {
  LeadVehiclePredictionReadiness,
  LeadVehicleSnapshot,
  LeadVehicleTrackingState,
  RiderTelemetrySnapshot,
} from "./leadVehicle.types";

export function computePredictionReadiness(
  lead: LeadVehicleSnapshot | null,
  trackingState: LeadVehicleTrackingState,
  telemetry?: RiderTelemetrySnapshot,
): LeadVehiclePredictionReadiness {
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (!lead) {
    return {
      ready: false,
      confidence: 0,
      reasons: [],
      blockers: ["no_lead_vehicle"],
    };
  }

  if (trackingState !== "tracking") {
    blockers.push(`state_${trackingState}`);
  } else {
    reasons.push("stable_track");
  }

  if (lead.visibleDurationMs >= PREDICTION_MIN_VISIBLE_MS) {
    reasons.push("vehicle_persistent");
  } else {
    blockers.push("insufficient_visibility");
  }

  if (lead.sameDirectionConfidence >= SAME_DIRECTION_THRESHOLD) {
    reasons.push("same_direction_likely");
  } else {
    blockers.push("same_direction_uncertain");
  }

  if (pointInTrapezoid(
    {
      x: lead.boundingBox.x + lead.boundingBox.width / 2,
      y: lead.boundingBox.y + lead.boundingBox.height,
    },
    DEFAULT_FORWARD_CORRIDOR,
  )) {
    reasons.push("inside_forward_corridor");
  } else {
    blockers.push("outside_forward_corridor");
  }

  if (lead.confidence < 0.55) {
    blockers.push("low_lead_confidence");
  }

  if (
    telemetry?.speedMetersPerSecond != null &&
    telemetry.speedMetersPerSecond < PREDICTION_MIN_RIDER_SPEED_MPS
  ) {
    blockers.push("rider_too_slow");
  } else if (telemetry?.speedMetersPerSecond != null) {
    reasons.push("rider_moving");
  }

  const ready = blockers.length === 0;
  const confidence = ready
    ? Math.min(
        1,
        0.35 * lead.confidence +
          0.35 * lead.sameDirectionConfidence +
          0.3 * Math.min(1, lead.visibleDurationMs / 3000),
      )
    : Math.max(0, 0.4 * lead.confidence - 0.1 * blockers.length);

  return { ready, confidence, reasons, blockers };
}
