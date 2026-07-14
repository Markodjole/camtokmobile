import { boxCenter } from "./leadVehicle.geometry";
import type {
  NormalizedBoundingBox,
  VehicleDetection,
} from "./leadVehicle.types";

/** Need a short track — kills single-frame noise / covered-camera flashes. */
export const PASS_MIN_HITS = 3;
export const PASS_MATCH_DIST = 0.25;
export const PASS_MAX_MISSES = 2;
export const PASS_MIN_AREA = 0.01;
export const PASS_MIN_CONFIDENCE = 0.45;
/** Must grow at least this much vs first sighting to count as we-passed. */
export const WE_PASSED_MIN_GROWTH = 1.2;
/** Or move downward in frame at least this much (closer / under us). */
export const WE_PASSED_MIN_DOWN = 0.08;
export const THEY_PASSED_MIN_HITS = 5;
export const THEY_PASSED_MIN_MS = 400;
export const THEY_PASSED_MAX_GROWTH = 0.82;
/**
 * If this many blobs die in one empty frame, treat as camera cover / wipe —
 * do not score them (avoids +10 when you palm the lens).
 */
export const MASS_LOSS_SKIP = 3;

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
  lastBox: NormalizedBoundingBox;
};

let nextPassId = 1;

/**
 * Conservative motorcycle POV counter.
 * Only scores tracks with clear grow/down (+1) or linger+shrink (−1).
 * Mass simultaneous loss (cover camera) is ignored.
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
    const usable = detections.filter((d) => {
      const a = d.boundingBox.width * d.boundingBox.height;
      return a >= PASS_MIN_AREA && d.confidence >= PASS_MIN_CONFIDENCE;
    });

    const unmatchedBlobs = new Set(this.blobs.keys());
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
      if (!unmatchedBlobs.has(pair.blobId) || usedDet.has(pair.detIdx)) continue;
      unmatchedBlobs.delete(pair.blobId);
      usedDet.add(pair.detIdx);
      this.bump(this.blobs.get(pair.blobId)!, usable[pair.detIdx]!, nowMs);
    }

    const dying: PassBlob[] = [];
    for (const blobId of unmatchedBlobs) {
      const blob = this.blobs.get(blobId)!;
      blob.misses += 1;
      if (blob.misses >= PASS_MAX_MISSES) {
        dying.push(blob);
        this.blobs.delete(blobId);
      }
    }

    // Camera covered / all vehicles wiped at once → don't score the pile-on.
    const massWipe = usable.length === 0 && dying.length >= MASS_LOSS_SKIP;
    for (const blob of dying) {
      this.finalize(blob, nowMs, massWipe ? "skip" : undefined);
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
        lastBox: box,
      });
    });

    return {
      vehiclesOnScreen: [...this.blobs.values()].filter((b) => b.misses === 0)
        .length,
      vehiclesPassed: this.passed,
      lastPass: this.lastPass,
    };
  }

  observe(
    _tracks: unknown,
    _removed: unknown,
    _nowMs: number,
  ): VehiclePassCounterSnapshot {
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

    // Confirmed overtake through bottom of frame + growth.
    if (
      blob.hits >= PASS_MIN_HITS &&
      c.y > 0.85 &&
      blob.peakArea / blob.firstArea >= WE_PASSED_MIN_GROWTH
    ) {
      this.finalize(blob, nowMs, 1);
      this.blobs.delete(blob.id);
    }
  }

  private finalize(
    blob: PassBlob,
    nowMs: number,
    forced: 1 | -1 | "skip" | undefined = undefined,
  ): void {
    if (this.finalized.has(blob.id)) return;
    if (forced === "skip") {
      this.finalized.add(blob.id);
      return;
    }
    if (blob.hits < PASS_MIN_HITS) return;
    if (blob.peakConfidence < PASS_MIN_CONFIDENCE) return;

    const delta = forced === 1 || forced === -1 ? forced : resolveDelta(blob);
    if (delta == null) {
      this.finalized.add(blob.id);
      return;
    }

    this.finalized.add(blob.id);
    const event: VehiclePassEvent = {
      trackId: blob.id,
      timestampMs: nowMs,
      delta,
      reason: delta === 1 ? "we_passed" : "they_passed",
    };
    this.passed += delta;
    this.lastPass = event;
  }
}

/** null = not enough evidence → do not count */
function resolveDelta(blob: PassBlob): 1 | -1 | null {
  const growth = blob.peakArea / Math.max(blob.firstArea, 0.0001);
  const endGrowth = blob.lastArea / Math.max(blob.firstArea, 0.0001);
  const visibleMs = Math.max(0, blob.lastSeenAtMs - blob.firstSeenAtMs);
  const movedDown = blob.lastCenterY - blob.firstCenterY;

  const lingered =
    blob.hits >= THEY_PASSED_MIN_HITS || visibleMs >= THEY_PASSED_MIN_MS;
  if (lingered && endGrowth <= THEY_PASSED_MAX_GROWTH && movedDown < 0.06) {
    return -1;
  }

  // We passed them: box got bigger and/or slid down the frame (closer).
  if (growth >= WE_PASSED_MIN_GROWTH || movedDown >= WE_PASSED_MIN_DOWN) {
    return 1;
  }

  return null;
}
