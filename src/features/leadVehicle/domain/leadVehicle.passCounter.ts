import { boxCenter } from "./leadVehicle.geometry";
import type {
  NormalizedBoundingBox,
  SupportedVehicleType,
  VehicleDetection,
} from "./leadVehicle.types";

/**
 * Accuracy gate = "is this a real vehicle?", not box-growth theatre.
 * Growth/shrink only separates +1 (we passed) vs −1 (they passed).
 */

const VEHICLE_TYPES = new Set<SupportedVehicleType>([
  "car",
  "motorcycle",
  "bus",
  "truck",
  "bicycle",
]);

/** Detector must be sure it's a vehicle. */
export const PASS_MIN_CONFIDENCE = 0.55;
/** Fast motorcycle cut: shorter track OK if confidence is higher. */
export const PASS_FAST_CONFIDENCE = 0.65;
export const PASS_MIN_AREA = 0.01;
export const PASS_MATCH_DIST = 0.24;
export const PASS_MAX_MISSES = 2;

export const WE_MIN_HITS = 3;
export const WE_FAST_MIN_HITS = 2;

export const THEY_MIN_HITS = 6;
export const THEY_MIN_MS = 450;
export const THEY_MAX_END_GROWTH = 0.78;
export const THEY_MIN_SHRINK_STEPS = 3;

export const MASS_LOSS_SKIP = 3;
export const AREA_HISTORY = 8;

export type VehiclePassEvent = {
  trackId: string;
  timestampMs: number;
  delta: 1 | -1;
  reason: "we_passed" | "they_passed";
  vehicleType: SupportedVehicleType;
};

export type VehiclePassCounterSnapshot = {
  vehiclesOnScreen: number;
  vehiclesPassed: number;
  lastPass: VehiclePassEvent | null;
};

type PassBlob = {
  id: string;
  hits: number;
  misses: number;
  vehicleType: SupportedVehicleType;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  firstArea: number;
  peakArea: number;
  lastArea: number;
  firstCenterY: number;
  lastCenterY: number;
  peakConfidence: number;
  areas: number[];
  lastBox: NormalizedBoundingBox;
};

let nextPassId = 1;

function isSureVehicle(d: VehicleDetection): boolean {
  if (!VEHICLE_TYPES.has(d.vehicleType)) return false;
  if (d.vehicleType === "unknown_vehicle") return false;
  if (d.confidence < PASS_MIN_CONFIDENCE) return false;
  const a = d.boundingBox.width * d.boundingBox.height;
  return a >= PASS_MIN_AREA;
}

/**
 * Count every sure vehicle in the column (not just lead).
 * +1: vehicle left and was not a clear overtake-us pattern (incl. fast cuts).
 * −1: sure vehicle lingered and shrunk ahead.
 */
export class VehiclePassCounter {
  private blobs = new Map<string, PassBlob>();
  private passed = 0;
  private lastPass: VehiclePassEvent | null = null;
  private finalized = new Set<string>();

  reset(): void {
    this.blobs.clear();
    this.passed = 0;
    this.lastPass = null;
    this.finalized.clear();
    nextPassId = 1;
  }

  observeDetections(
    detections: VehicleDetection[],
    nowMs: number,
  ): VehiclePassCounterSnapshot {
    const usable = detections.filter(isSureVehicle);

    const unmatched = new Set(this.blobs.keys());
    const usedDet = new Set<number>();
    const pairs: { blobId: string; detIdx: number; dist: number }[] = [];

    for (const [blobId, blob] of this.blobs) {
      usable.forEach((det, detIdx) => {
        const c = boxCenter(det.boundingBox);
        const bc = boxCenter(blob.lastBox);
        const dist = Math.hypot(c.x - bc.x, c.y - bc.y);
        if (dist > PASS_MATCH_DIST) return;
        // Prefer same class continuity.
        const classPenalty = det.vehicleType === blob.vehicleType ? 0 : 0.06;
        pairs.push({ blobId, detIdx, dist: dist + classPenalty });
      });
    }
    pairs.sort((a, b) => a.dist - b.dist);

    for (const pair of pairs) {
      if (!unmatched.has(pair.blobId) || usedDet.has(pair.detIdx)) continue;
      unmatched.delete(pair.blobId);
      usedDet.add(pair.detIdx);
      this.bump(this.blobs.get(pair.blobId)!, usable[pair.detIdx]!, nowMs);
    }

    const dying: PassBlob[] = [];
    for (const id of unmatched) {
      const blob = this.blobs.get(id)!;
      blob.misses += 1;
      if (blob.misses >= PASS_MAX_MISSES) {
        dying.push(blob);
        this.blobs.delete(id);
      }
    }

    const massWipe = usable.length === 0 && dying.length >= MASS_LOSS_SKIP;
    for (const blob of dying) {
      this.tryScore(blob, nowMs, massWipe);
    }

    usable.forEach((det, idx) => {
      if (usedDet.has(idx)) return;
      const box = det.boundingBox;
      const c = boxCenter(box);
      const area = Math.max(0.0001, box.width * box.height);
      const id = `pass_${nextPassId++}`;
      this.blobs.set(id, {
        id,
        hits: 1,
        misses: 0,
        vehicleType: det.vehicleType,
        firstSeenAtMs: nowMs,
        lastSeenAtMs: nowMs,
        firstArea: area,
        peakArea: area,
        lastArea: area,
        firstCenterY: c.y,
        lastCenterY: c.y,
        peakConfidence: det.confidence,
        areas: [area],
        lastBox: box,
      });
    });

    return this.snapshot();
  }

  observe(): VehiclePassCounterSnapshot {
    return this.snapshot();
  }

  snapshot(): VehiclePassCounterSnapshot {
    return {
      vehiclesOnScreen: [...this.blobs.values()].filter((b) => b.misses === 0)
        .length,
      vehiclesPassed: this.passed,
      lastPass: this.lastPass,
    };
  }

  private bump(blob: PassBlob, det: VehicleDetection, nowMs: number): void {
    const box = det.boundingBox;
    const c = boxCenter(box);
    const area = Math.max(0.0001, box.width * box.height);
    blob.hits += 1;
    blob.misses = 0;
    blob.lastSeenAtMs = nowMs;
    blob.peakArea = Math.max(blob.peakArea, area);
    blob.lastArea = area;
    blob.lastCenterY = c.y;
    blob.peakConfidence = Math.max(blob.peakConfidence, det.confidence);
    // Keep first class unless new one is much more confident.
    if (
      det.vehicleType !== blob.vehicleType &&
      det.confidence >= blob.peakConfidence
    ) {
      blob.vehicleType = det.vehicleType;
    }
    blob.lastBox = box;
    blob.areas.push(area);
    if (blob.areas.length > AREA_HISTORY) blob.areas.shift();
  }

  private tryScore(blob: PassBlob, nowMs: number, massWipe: boolean): void {
    if (this.finalized.has(blob.id)) return;
    if (massWipe) {
      this.finalized.add(blob.id);
      return;
    }
    if (!VEHICLE_TYPES.has(blob.vehicleType)) {
      this.finalized.add(blob.id);
      return;
    }
    if (blob.peakConfidence < PASS_MIN_CONFIDENCE) {
      this.finalized.add(blob.id);
      return;
    }
    if (!hasEnoughSightings(blob)) {
      this.finalized.add(blob.id);
      return;
    }

    const delta = isStrongTheyPassed(blob) ? -1 : 1;

    this.finalized.add(blob.id);
    this.passed += delta;
    this.lastPass = {
      trackId: blob.id,
      timestampMs: nowMs,
      delta,
      reason: delta === 1 ? "we_passed" : "they_passed",
      vehicleType: blob.vehicleType,
    };
  }
}

function hasEnoughSightings(blob: PassBlob): boolean {
  if (blob.peakConfidence >= PASS_FAST_CONFIDENCE) {
    return blob.hits >= WE_FAST_MIN_HITS;
  }
  return blob.hits >= WE_MIN_HITS;
}

function shrinkSteps(blob: PassBlob): number {
  let steps = 0;
  for (let i = 1; i < blob.areas.length; i += 1) {
    if (blob.areas[i]! < blob.areas[i - 1]! * 0.97) steps += 1;
  }
  return steps;
}

function isStrongTheyPassed(blob: PassBlob): boolean {
  const visibleMs = blob.lastSeenAtMs - blob.firstSeenAtMs;
  if (blob.hits < THEY_MIN_HITS && visibleMs < THEY_MIN_MS) return false;
  const endGrowth = blob.lastArea / Math.max(blob.firstArea, 0.0001);
  if (endGrowth > THEY_MAX_END_GROWTH) return false;
  if (blob.lastCenterY - blob.firstCenterY >= 0.08) return false;
  if (shrinkSteps(blob) < THEY_MIN_SHRINK_STEPS) return false;
  return true;
}
