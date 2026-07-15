import {
  FUSION_MATCH_IOU,
  REMOTE_ONLY_MIN_CONFIDENCE,
} from "./leadVehicle.constants";
import { iou } from "./leadVehicle.geometry";
import { normalizeVehicleDetection } from "./leadVehicle.normalize";
import type { VehicleDetection } from "./leadVehicle.types";

/**
 * Merge on-device (fast) and remote (accurate) detections.
 * Local boxes drive responsiveness; remote boosts confidence and fills gaps.
 */
export function fuseVehicleDetections(
  local: VehicleDetection[],
  remote: VehicleDetection[],
): VehicleDetection[] {
  const merged: VehicleDetection[] = local.map((d) =>
    normalizeVehicleDetection(d),
  );
  const usedRemote = new Set<number>();

  for (let li = 0; li < merged.length; li += 1) {
    let bestRi = -1;
    let bestOverlap = 0;
    for (let ri = 0; ri < remote.length; ri += 1) {
      if (usedRemote.has(ri)) continue;
      const overlap = iou(
        merged[li]!.boundingBox,
        remote[ri]!.boundingBox,
      );
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestRi = ri;
      }
    }
    if (bestRi < 0 || bestOverlap < FUSION_MATCH_IOU) continue;

    usedRemote.add(bestRi);
    const localDet = merged[li]!;
    const remoteDet = normalizeVehicleDetection(remote[bestRi]!);
    const preferRemoteBox = remoteDet.confidence >= localDet.confidence;
    merged[li] = {
      vehicleType: "vehicle",
      confidence: Math.max(localDet.confidence, remoteDet.confidence),
      boundingBox: preferRemoteBox
        ? remoteDet.boundingBox
        : localDet.boundingBox,
    };
  }

  for (let ri = 0; ri < remote.length; ri += 1) {
    if (usedRemote.has(ri)) continue;
    const remoteDet = normalizeVehicleDetection(remote[ri]!);
    if (remoteDet.confidence < REMOTE_ONLY_MIN_CONFIDENCE) continue;
    merged.push(remoteDet);
  }

  return nmsVehicleDetections(merged);
}

function nmsVehicleDetections(detections: VehicleDetection[]): VehicleDetection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: VehicleDetection[] = [];

  for (const candidate of sorted) {
    let overlaps = false;
    for (const existing of kept) {
      if (iou(candidate.boundingBox, existing.boundingBox) > FUSION_MATCH_IOU) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) kept.push(candidate);
  }

  return kept;
}
