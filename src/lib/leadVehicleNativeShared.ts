import type {
  SupportedVehicleType,
  VehicleDetection,
  VehicleFrameResult,
} from "@/features/leadVehicle/domain/leadVehicle.types";

export type NativeDetectionPayload = {
  timestampMs: number;
  inferenceDurationMs: number;
  frameWidth?: number;
  frameHeight?: number;
  rotationDegrees?: number;
  detections: Array<{
    vehicleType: string;
    confidence: number;
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
};

const VEHICLE_TYPES = new Set<SupportedVehicleType>([
  "car",
  "motorcycle",
  "bus",
  "truck",
  "bicycle",
  "unknown_vehicle",
]);

function asVehicleType(raw: string): SupportedVehicleType {
  if (VEHICLE_TYPES.has(raw as SupportedVehicleType)) {
    return raw as SupportedVehicleType;
  }
  return "unknown_vehicle";
}

/** Shared mapper (no React Native imports — safe for vitest). */
export function mapNativeDetections(
  payload: NativeDetectionPayload,
  frameId: number,
): VehicleFrameResult {
  const detections: VehicleDetection[] = (payload.detections ?? []).map(
    (d, i) => ({
      detectionId: `n-${frameId}-${i}`,
      vehicleType: asVehicleType(d.vehicleType),
      confidence: d.confidence,
      boundingBox: {
        x: d.boundingBox.x,
        y: d.boundingBox.y,
        width: d.boundingBox.width,
        height: d.boundingBox.height,
      },
    }),
  );
  return {
    frameId,
    timestampMs: payload.timestampMs || Date.now(),
    inferenceDurationMs: payload.inferenceDurationMs || 0,
    detections,
  };
}
