import { boxBottomCenter, boxCenter, iou } from "./leadVehicle.geometry";
import { isLikelyVehicleDetection } from "./leadVehicle.vehicleFilter";
import {
  ROUND_MIN_CONFIDENCE,
  ROUND_MIN_HITS,
  ROUND_TRACK_MATCH_DIST,
  ROUND_TRACK_MATCH_IOU,
  ROUND_TRACK_MAX_MISSES,
  VEHICLE_COUNT_MIN_DOWNWARD_TRAVEL,
  VEHICLE_COUNT_NEAR_FIELD_Y,
} from "./vehicleCountRound.constants";
import type { NormalizedBoundingBox, VehicleDetection } from "./leadVehicle.types";

export type VehicleCountRoundSnapshot = {
  roundId: string | null;
  count: number;
  vehiclesOnScreen: number;
  counting: boolean;
};

type RoundTrack = {
  id: string;
  hits: number;
  misses: number;
  peakConfidence: number;
  lastBox: NormalizedBoundingBox;
  minBottomY: number;
  maxBottomY: number;
  counted: boolean;
};

let nextRoundTrackId = 1;

function centerDistance(
  a: NormalizedBoundingBox,
  b: NormalizedBoundingBox,
): number {
  const ca = boxCenter(a);
  const cb = boxCenter(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/**
 * Association score: prefer IoU, fall back to centroid proximity.
 * Motion-tolerant so a fast car on a shaky cam stays one track (no overcount).
 */
function associationScore(
  track: RoundTrack,
  det: VehicleDetection,
): number {
  const overlap = iou(track.lastBox, det.boundingBox);
  if (overlap >= ROUND_TRACK_MATCH_IOU) return 1 + overlap;
  const dist = centerDistance(track.lastBox, det.boundingBox);
  if (dist <= ROUND_TRACK_MATCH_DIST) return 1 - dist / ROUND_TRACK_MATCH_DIST;
  return 0;
}

/**
 * Rush Hour–style counter. Robust tracking makes one physical vehicle exactly
 * one track; a track counts once when it clearly approaches the camera (reaches
 * the near field after travelling downward). Higher recall than a single
 * line-cross while still rejecting far flicker and static false positives.
 */
export class VehicleCountRoundCounter {
  private roundId: string | null = null;
  private counting = false;
  private count = 0;
  private tracks = new Map<string, RoundTrack>();

  reset(): void {
    this.roundId = null;
    this.counting = false;
    this.count = 0;
    this.tracks.clear();
    nextRoundTrackId = 1;
  }

  beginRound(roundId: string): void {
    if (this.roundId === roundId && this.counting) return;
    this.roundId = roundId;
    this.counting = true;
    this.count = 0;
    this.tracks.clear();
    nextRoundTrackId = 1;
  }

  endRound(): void {
    this.counting = false;
  }

  observeDetections(
    detections: VehicleDetection[],
    nowMs: number,
  ): VehicleCountRoundSnapshot {
    void nowMs;
    if (!this.counting || !this.roundId) {
      return this.snapshot();
    }

    const usable = detections.filter(
      (d) => isLikelyVehicleDetection(d) && d.confidence >= ROUND_MIN_CONFIDENCE,
    );

    const unmatched = new Set(this.tracks.keys());
    const used = new Set<number>();
    const pairs: { trackId: string; detIdx: number; score: number }[] = [];

    for (const [trackId, track] of this.tracks) {
      usable.forEach((det, detIdx) => {
        const score = associationScore(track, det);
        if (score > 0) pairs.push({ trackId, detIdx, score });
      });
    }
    pairs.sort((a, b) => b.score - a.score);

    for (const pair of pairs) {
      if (!unmatched.has(pair.trackId) || used.has(pair.detIdx)) continue;
      unmatched.delete(pair.trackId);
      used.add(pair.detIdx);
      this.bump(this.tracks.get(pair.trackId)!, usable[pair.detIdx]!);
    }

    for (const trackId of unmatched) {
      const track = this.tracks.get(trackId)!;
      track.misses += 1;
      if (track.misses >= ROUND_TRACK_MAX_MISSES) {
        this.tracks.delete(trackId);
      }
    }

    usable.forEach((det, idx) => {
      if (used.has(idx)) return;
      const bottom = boxBottomCenter(det.boundingBox);
      const id = `round_${nextRoundTrackId++}`;
      const track: RoundTrack = {
        id,
        hits: 1,
        misses: 0,
        peakConfidence: det.confidence,
        lastBox: det.boundingBox,
        minBottomY: bottom.y,
        maxBottomY: bottom.y,
        counted: false,
      };
      this.tracks.set(id, track);
      this.tryCount(track);
    });

    return this.snapshot();
  }

  snapshot(): VehicleCountRoundSnapshot {
    return {
      roundId: this.roundId,
      count: this.count,
      vehiclesOnScreen: [...this.tracks.values()].filter((t) => t.misses === 0)
        .length,
      counting: this.counting,
    };
  }

  private bump(track: RoundTrack, det: VehicleDetection): void {
    const bottom = boxBottomCenter(det.boundingBox);
    track.hits += 1;
    track.misses = 0;
    track.peakConfidence = Math.max(track.peakConfidence, det.confidence);
    track.lastBox = det.boundingBox;
    track.minBottomY = Math.min(track.minBottomY, bottom.y);
    track.maxBottomY = Math.max(track.maxBottomY, bottom.y);
    this.tryCount(track);
  }

  private tryCount(track: RoundTrack): void {
    if (track.counted) return;
    if (track.hits < ROUND_MIN_HITS) return;
    if (track.peakConfidence < ROUND_MIN_CONFIDENCE) return;
    // Must reach the near field (a real vehicle you approached/passed)…
    if (track.maxBottomY < VEHICLE_COUNT_NEAR_FIELD_Y) return;
    // …and have travelled downward (rejects static false positives).
    if (track.maxBottomY - track.minBottomY < VEHICLE_COUNT_MIN_DOWNWARD_TRAVEL) {
      return;
    }
    track.counted = true;
    this.count += 1;
  }
}
