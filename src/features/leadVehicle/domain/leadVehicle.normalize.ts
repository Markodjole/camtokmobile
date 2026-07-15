import type { SupportedVehicleType, VehicleDetection } from "./leadVehicle.types";

/** COCO / legacy labels we treat as the same thing: a vehicle. */
const LEGACY_VEHICLE_LABELS = new Set([
  "vehicle",
  "car",
  "motorcycle",
  "bus",
  "truck",
  "bicycle",
]);

export function normalizeVehicleType(raw: string): SupportedVehicleType {
  if (LEGACY_VEHICLE_LABELS.has(raw.toLowerCase())) return "vehicle";
  return "unknown_vehicle";
}

export function isVehicleLabel(raw: string): boolean {
  return LEGACY_VEHICLE_LABELS.has(raw.toLowerCase());
}

export function normalizeVehicleDetection(
  detection: VehicleDetection,
): VehicleDetection {
  return {
    ...detection,
    vehicleType: normalizeVehicleType(detection.vehicleType),
  };
}

export function normalizeVehicleDetections(
  detections: VehicleDetection[],
): VehicleDetection[] {
  return detections.map(normalizeVehicleDetection);
}
