import { boxCenter } from "./leadVehicle.geometry";
import type {
  NormalizedBoundingBox,
  VehicleDetection,
} from "./leadVehicle.types";

/** Count after this many sightings — 1 = split-second roadside flybys. */
export const PASS_MIN_HITS = 1;
/** How far (normalized) a box center can move and still be the same vehicle. */
export const PASS_MATCH_DIST = 0.36;
/** Finalize after this many missed frames (1 = next blank frame counts it). */
export const PASS_MAX_MISSES = 1;
/** Tiny boxes are usually noise. */
export const PASS_MIN_AREA = 0.0035;
/** Single-frame flybys need at least this size to count (reduces noise). */
export const PASS_SINGLE_HIT_MIN_AREA = 0.008;

export type VehiclePassEvent = {
  trackId: string;
  timestampMs: number;
  /** +1 we passed them, -1 they passed us */
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
  lastBox: NormalizedBoundingBox;
};

let nextPassId = 1;

/**
 * Standalone pass counter from raw detections (not the sticky lead tracker).
 * Loose center matching → each brief flyby gets its own life → +1/−1 on exit.
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

  /**
   * Feed every vehicle detection this frame (car/bike/bus/… — all types).
   */
  observeDetections(
    detections: VehicleDetection[],
    nowMs: number,
  ): VehiclePassCounterSnapshot {
    const usable = detections.filter((d) => {
      const a = d.boundingBox.width * d.boundingBox.height;
      return a >= PASS_MIN_AREA && d.confidence >= 0.2;
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

    for (const blobId of unmatchedBlobs) {
      const blob = this.blobs.get(blobId)!;
      blob.misses += 1;
      if (blob.misses > PASS_MAX_MISSES) {
        this.finalize(blob, nowMs);
        this.blobs.delete(blobId);
      }
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

  /** @deprecated lead-tracker path — prefer observeDetections */
  observe(
    _tracks: unknown,
    _removed: unknown,
    nowMs: number,
  ): VehiclePassCounterSnapshot {
    return {
      vehiclesOnScreen: [...this.blobs.values()].filter((b) => b.misses === 0)
        .length,
      vehiclesPassed: this.passed,
      lastPass: this.lastPass,
    };
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
    blob.lastBox = box;

    // Early pass: blew past us toward the bottom of the frame.
    if (
      blob.hits >= 1 &&
      c.y > 0.82 &&
      blob.peakArea >= PASS_SINGLE_HIT_MIN_AREA &&
      (area > blob.firstArea * 1.08 || blob.hits >= 2)
    ) {
      this.finalize(blob, nowMs, 1);
      this.blobs.delete(blob.id);
    }
  }

  private finalize(
    blob: PassBlob,
    nowMs: number,
    forcedDelta?: 1 | -1,
  ): void {
    if (this.finalized.has(blob.id)) return;
    if (blob.hits < PASS_MIN_HITS) return;
    // One-glance flyby: require a real-sized box so 1px flicker is ignored.
    if (blob.hits === 1 && blob.peakArea < PASS_SINGLE_HIT_MIN_AREA) return;
    this.finalized.add(blob.id);

    const delta = forcedDelta ?? resolveDelta(blob);
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

function resolveDelta(blob: PassBlob): 1 | -1 {
  const growth = blob.lastArea / Math.max(blob.firstArea, 0.0001);
  const movedDown = blob.lastCenterY - blob.firstCenterY;

  // Pulling ahead / shrinking in distance → they passed us.
  if (growth <= 0.85 && movedDown < 0.05) return -1;

  // Default: any other disappearance counts as we cleared/passed them.
  // Fast roadside flybys barely grow; still +1 so we stop under-counting.
  return 1;
}
