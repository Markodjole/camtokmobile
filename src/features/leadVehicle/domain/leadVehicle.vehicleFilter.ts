import { boxArea, boxBottomCenter, boxCenter } from "./leadVehicle.geometry";
import type {
  NormalizedBoundingBox,
  VehicleDetection,
} from "./leadVehicle.types";

/** Per-detection minimum score after native inference. Kept low so the viewer
 *  overlay favors recall (show every vehicle, even a quick glance). */
export const VEHICLE_MIN_CONFIDENCE = 0.4;

/** Reject full-frame road blobs, but keep tiny far vehicles (min-area was
 *  silently dropping every distant car/bike on the full frame). */
export const VEHICLE_MIN_AREA = 0.0005;
export const VEHICLE_MAX_AREA = 0.75;

/** Width/height — vehicles are not road strips or curb lines. */
export const VEHICLE_MIN_ASPECT = 0.25;
export const VEHICLE_MAX_ASPECT = 3.5;

/** Road/curb false positives often span most of the frame width. */
export const VEHICLE_MAX_WIDTH = 0.9;

/** Bottom edge of frame — curbs and road texture sit here. */
export const VEHICLE_MAX_BOTTOM_Y = 0.98;

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
  // Very large low-confidence blobs (barriers/road mislabeled as vehicle).
  if (area > 0.5 && d.confidence < 0.5) {
    return "low_confidence";
  }

  // Posts / people: very tall thin blobs (much taller than wide) with weak
  // scores in the lower frame. Kept narrow so motorcycles/bikes still pass.
  if (
    area < 0.03 &&
    aspect < 0.55 &&
    d.confidence < 0.5 &&
    center.y > 0.6
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
