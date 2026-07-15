import { boxBottomCenter, boxCenter, iou } from "./leadVehicle.geometry";
import { isLikelyVehicleDetection } from "./leadVehicle.vehicleFilter";
import {
  ROUND_HIGH_CONFIDENCE,
  ROUND_MIN_CONFIDENCE,
  ROUND_MIN_HITS,
  ROUND_MIN_HITS_LOW_CONF,
  ROUND_TRACK_MATCH_IOU,
  ROUND_TRACK_MAX_MISSES,
  VEHICLE_COUNT_LINE_Y,
  VEHICLE_COUNT_ZONE_BOTTOM,
  VEHICLE_COUNT_ZONE_TOP,
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
  lastCenterY: number;
  wasAboveLine: boolean;
  crossed: boolean;
  inZone: boolean;
  peakConfidence: number;
  lastBox: NormalizedBoundingBox;
};

let nextRoundTrackId = 1;

function minHitsFor(confidence: number): number {
  return confidence >= ROUND_HIGH_CONFIDENCE
    ? ROUND_MIN_HITS
    : ROUND_MIN_HITS_LOW_CONF;
}

function centerInCountZone(centerY: number): boolean {
  return centerY >= VEHICLE_COUNT_ZONE_TOP && centerY <= VEHICLE_COUNT_ZONE_BOTTOM;
}

/**
 * Rush Hour–style counter: unique vehicles in the counting zone once per round.
 * Tolerates bike-camera motion better than strict downward line-cross only.
 */
export class VehicleCountRoundCounter {
  private roundId: string | null = null;
  private counting = false;
  private count = 0;
  private tracks = new Map<string, RoundTrack>();
  private countedIds = new Set<string>();

  reset(): void {
    this.roundId = null;
    this.counting = false;
    this.count = 0;
    this.tracks.clear();
    this.countedIds.clear();
    nextRoundTrackId = 1;
  }

  beginRound(roundId: string): void {
    if (this.roundId === roundId && this.counting) return;
    this.roundId = roundId;
    this.counting = true;
    this.count = 0;
    this.tracks.clear();
    this.countedIds.clear();
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
        const score = iou(track.lastBox, det.boundingBox);
        if (score >= ROUND_TRACK_MATCH_IOU) {
          pairs.push({ trackId, detIdx, score });
        }
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
      const center = boxCenter(det.boundingBox);
      const id = `round_${nextRoundTrackId++}`;
      this.tracks.set(id, {
        id,
        hits: 1,
        misses: 0,
        lastCenterY: center.y,
        wasAboveLine: center.y < VEHICLE_COUNT_LINE_Y,
        crossed: false,
        inZone: centerInCountZone(center.y),
        peakConfidence: det.confidence,
        lastBox: det.boundingBox,
      });
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
    const center = boxCenter(det.boundingBox);
    const bottom = boxBottomCenter(det.boundingBox);
    track.hits += 1;
    track.misses = 0;
    track.peakConfidence = Math.max(track.peakConfidence, det.confidence);
    track.lastBox = det.boundingBox;
    track.inZone = centerInCountZone(center.y);

    const aboveNow = bottom.y < VEHICLE_COUNT_LINE_Y;
    if (track.wasAboveLine && !aboveNow && bottom.y >= VEHICLE_COUNT_LINE_Y) {
      this.tryCount(track);
    }

    if (!track.crossed && track.inZone) {
      this.tryCount(track);
    }

    track.wasAboveLine = aboveNow || center.y < VEHICLE_COUNT_LINE_Y;
    track.lastCenterY = center.y;
  }

  private tryCount(track: RoundTrack): void {
    if (track.crossed || this.countedIds.has(track.id)) return;
    if (track.hits < minHitsFor(track.peakConfidence)) return;
    if (track.peakConfidence < ROUND_MIN_CONFIDENCE) return;
    if (!track.inZone && track.hits < ROUND_MIN_HITS_LOW_CONF) return;
    track.crossed = true;
    this.countedIds.add(track.id);
    this.count += 1;
  }
}
