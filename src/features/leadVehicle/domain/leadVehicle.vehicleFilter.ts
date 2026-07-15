import { boxArea, boxBottomCenter, boxCenter } from "./leadVehicle.geometry";
import type {
  NormalizedBoundingBox,
  VehicleDetection,
} from "./leadVehicle.types";

/** Per-detection minimum score after native inference. */
export const VEHICLE_MIN_CONFIDENCE = 0.46;

/** Reject tiny far noise and full-frame road blobs. */
export const VEHICLE_MIN_AREA = 0.008;
export const VEHICLE_MAX_AREA = 0.42;

/** Width/height — vehicles are not road strips or curb lines. */
export const VEHICLE_MIN_ASPECT = 0.32;
export const VEHICLE_MAX_ASPECT = 2.75;

/** Road/curb false positives often span most of the frame width. */
export const VEHICLE_MAX_WIDTH = 0.68;

/** Bottom edge of crop — curbs and road texture sit here. */
export const VEHICLE_MAX_BOTTOM_Y = 0.9;

export type VehicleRejectReason =
  | "not_vehicle_class"
  | "low_confidence"
  | "too_small"
  | "too_large"
  | "bad_aspect"
  | "too_wide"
  | "road_strip"
  | "curb_band"
  | "bottom_texture";

export function vehicleRejectReason(
  d: VehicleDetection,
): VehicleRejectReason | null {
  if (d.vehicleType !== "vehicle") {
    return "not_vehicle_class";
  }

  if (d.confidence < VEHICLE_MIN_CONFIDENCE) return "low_confidence";

  const box = d.boundingBox;
  const area = boxArea(box);
  if (area < VEHICLE_MIN_AREA) return "too_small";
  if (area > VEHICLE_MAX_AREA) return "too_large";

  const aspect = box.width / Math.max(box.height, 0.0001);

  // Curb / pavement lip along the bottom of the crop (check before generic
  // aspect/width rules so the specific reason wins and it is still rejected).
  if (
    box.y + box.height > 0.94 &&
    box.height < 0.11 &&
    box.width > 0.28
  ) {
    return "curb_band";
  }

  // Horizontal road / asphalt band (very wide + short).
  if (aspect > 2.2 && box.height < 0.14) return "road_strip";

  // Full-width boxes are almost never a single vehicle.
  if (box.width > VEHICLE_MAX_WIDTH) return "too_wide";

  if (aspect < VEHICLE_MIN_ASPECT || aspect > VEHICLE_MAX_ASPECT) {
    return "bad_aspect";
  }

  const bottom = boxBottomCenter(box);
  if (bottom.y > VEHICLE_MAX_BOTTOM_Y) return "bottom_texture";

  const center = boxCenter(box);
  // Large low-confidence blobs (pots, barriers mislabeled as vehicle).
  if (area > 0.12 && d.confidence < 0.58) {
    return "low_confidence";
  }

  // Pots / posts / people: small upright blobs (taller than wide) with modest
  // scores in the lower frame — real vehicles are wider than tall up close.
  if (
    area < 0.045 &&
    aspect < 0.85 &&
    d.confidence < 0.6 &&
    center.y > 0.55
  ) {
    return "low_confidence";
  }

  return null;
}

export function isLikelyVehicleDetection(d: VehicleDetection): boolean {
  return vehicleRejectReason(d) === null;
}

export function filterVehicleDetections(
  detections: VehicleDetection[],
): VehicleDetection[] {
  return detections.filter(isLikelyVehicleDetection);
}
