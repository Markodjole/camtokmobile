import { boxCenter } from "./leadVehicle.geometry";
import type {
  NormalizedBoundingBox,
  VehicleDetection,
} from "./leadVehicle.types";

/**
 * Accuracy-first motorcycle pass scorer.
 * Prefer miss over wrong: no evidence → no score.
 */

export const PASS_MIN_CONFIDENCE = 0.5;
export const PASS_MIN_AREA = 0.012;
export const PASS_MATCH_DIST = 0.22;
export const PASS_MAX_MISSES = 2;

/** We-overtake: need a short but real track + clear close-up signature. */
export const WE_MIN_HITS = 4;
export const WE_MIN_GROWTH = 1.25;
export const WE_MIN_DOWN = 0.1;
/** Commit +1 early once the vehicle is clearly under us / leaving bottom. */
export const WE_EARLY_Y = 0.78;

/** They-overtake: longer linger + clear shrink into the distance. */
export const THEY_MIN_HITS = 6;
export const THEY_MIN_MS = 450;
export const THEY_MAX_END_GROWTH = 0.75;
export const THEY_MIN_SHRINK_STEPS = 3;

export const MASS_LOSS_SKIP = 3;
export const AREA_HISTORY = 8;

export type VehiclePassEvent = {
  trackId: string;
  timestampMs: number;
  delta: 1 | -1;
  reason: "we_passed" | "they_passed";
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
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  firstArea: number;
  peakArea: number;
  lastArea: number;
  firstCenterY: number;
  lastCenterY: number;
  peakConfidence: number;
  areas: number[];
  centersY: number[];
  lastBox: NormalizedBoundingBox;
};

let nextPassId = 1;

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
    const usable = detections.filter((d) => {
      const a = d.boundingBox.width * d.boundingBox.height;
      return a >= PASS_MIN_AREA && d.confidence >= PASS_MIN_CONFIDENCE;
    });

    const unmatched = new Set(this.blobs.keys());
    const usedDet = new Set<number>();
    const pairs: { blobId: string; detIdx: number; dist: number }[] = [];

    for (const [blobId, blob] of this.blobs) {
      usable.forEach((det, detIdx) => {
        const c = boxCenter(det.boundingBox);
        const bc = boxCenter(blob.lastBox);
        const dist = Math.hypot(c.x - bc.x, c.y - bc.y);
        if (dist > PASS_MATCH_DIST) return;
        pairs.push({ blobId, detIdx, dist });
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
      this.tryScore(blob, nowMs, massWipe ? "skip" : "lost");
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
        firstSeenAtMs: nowMs,
        lastSeenAtMs: nowMs,
        firstArea: area,
        peakArea: area,
        lastArea: area,
        firstCenterY: c.y,
        lastCenterY: c.y,
        peakConfidence: det.confidence,
        areas: [area],
        centersY: [c.y],
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
    blob.lastBox = box;
    blob.areas.push(area);
    blob.centersY.push(c.y);
    if (blob.areas.length > AREA_HISTORY) blob.areas.shift();
    if (blob.centersY.length > AREA_HISTORY) blob.centersY.shift();

    // Fast, high-confidence we-passed: clearly growing and exiting bottom.
    if (isStrongWePassed(blob) && c.y >= WE_EARLY_Y) {
      this.tryScore(blob, nowMs, "early_we");
      this.blobs.delete(blob.id);
    }
  }

  private tryScore(
    blob: PassBlob,
    nowMs: number,
    mode: "lost" | "early_we" | "skip",
  ): void {
    if (this.finalized.has(blob.id)) return;
    if (mode === "skip") {
      this.finalized.add(blob.id);
      return;
    }
    if (blob.peakConfidence < PASS_MIN_CONFIDENCE) {
      this.finalized.add(blob.id);
      return;
    }

    let delta: 1 | -1 | null = null;
    if (mode === "early_we") {
      delta = isStrongWePassed(blob) ? 1 : null;
    } else {
      delta = decideOnLoss(blob);
    }
    if (delta == null) {
      this.finalized.add(blob.id);
      return;
    }

    this.finalized.add(blob.id);
    this.passed += delta;
    this.lastPass = {
      trackId: blob.id,
      timestampMs: nowMs,
      delta,
      reason: delta === 1 ? "we_passed" : "they_passed",
    };
  }
}

function growthPeak(blob: PassBlob): number {
  return blob.peakArea / Math.max(blob.firstArea, 0.0001);
}

function growthEnd(blob: PassBlob): number {
  return blob.lastArea / Math.max(blob.firstArea, 0.0001);
}

function movedDown(blob: PassBlob): number {
  return blob.lastCenterY - blob.firstCenterY;
}

function shrinkSteps(blob: PassBlob): number {
  let steps = 0;
  for (let i = 1; i < blob.areas.length; i += 1) {
    if (blob.areas[i]! < blob.areas[i - 1]! * 0.97) steps += 1;
  }
  return steps;
}

function isStrongWePassed(blob: PassBlob): boolean {
  if (blob.hits < WE_MIN_HITS) return false;
  const g = growthPeak(blob);
  const down = movedDown(blob);
  return g >= WE_MIN_GROWTH || (g >= 1.12 && down >= WE_MIN_DOWN);
}

function isStrongTheyPassed(blob: PassBlob): boolean {
  const visibleMs = blob.lastSeenAtMs - blob.firstSeenAtMs;
  if (blob.hits < THEY_MIN_HITS && visibleMs < THEY_MIN_MS) return false;
  if (growthEnd(blob) > THEY_MAX_END_GROWTH) return false;
  if (movedDown(blob) >= 0.06) return false; // growing closer = not them pulling away
  if (shrinkSteps(blob) < THEY_MIN_SHRINK_STEPS) return false;
  return true;
}

function decideOnLoss(blob: PassBlob): 1 | -1 | null {
  if (isStrongTheyPassed(blob)) return -1;
  if (isStrongWePassed(blob)) return 1;
  return null;
}
