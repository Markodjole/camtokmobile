import type {
  SupportedVehicleType,
  VehicleDetection,
  VehicleFrameResult,
} from "@/features/leadVehicle/domain/leadVehicle.types";
import { normalizeVehicleType } from "@/features/leadVehicle/domain/leadVehicle.normalize";

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

/** Shared mapper (no React Native imports — safe for vitest). */
export function mapNativeDetections(
  payload: NativeDetectionPayload,
  frameId: number,
): VehicleFrameResult {
  const detections: VehicleDetection[] = (payload.detections ?? []).map(
    (d, i) => ({
      detectionId: `n-${frameId}-${i}`,
      vehicleType: normalizeVehicleType(d.vehicleType),
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
    frameWidth: payload.frameWidth,
    frameHeight: payload.frameHeight,
    rotationDegrees: payload.rotationDegrees,
    detections,
  };
}
