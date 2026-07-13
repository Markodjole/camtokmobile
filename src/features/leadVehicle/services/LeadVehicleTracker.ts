import { DEFAULT_TRACKER_CONFIG } from "../domain/leadVehicle.constants";
import {
  boxBottomCenter,
  boxCenter,
  iou,
  normalizeBox,
} from "../domain/leadVehicle.geometry";
import type {
  NormalizedBoundingBox,
  TrackedVehicle,
  VehicleDetection,
  VehicleTrackId,
  VehicleTrackerConfig,
} from "../domain/leadVehicle.types";

let nextTrackSeq = 1;

export function resetTrackIdSequence(): void {
  nextTrackSeq = 1;
}

function allocTrackId(): VehicleTrackId {
  const id = `vehicle_${nextTrackSeq}`;
  nextTrackSeq += 1;
  return id;
}

/**
 * Lightweight IoU + class multi-object tracker (ByteTrack-style simplicity).
 */
export class LeadVehicleTracker {
  private tracks = new Map<VehicleTrackId, TrackedVehicle>();
  private config: VehicleTrackerConfig;

  constructor(config: Partial<VehicleTrackerConfig> = {}) {
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
  }

  reset(): void {
    this.tracks.clear();
    resetTrackIdSequence();
  }

  getTracks(): TrackedVehicle[] {
    return [...this.tracks.values()];
  }

  update(
    detections: VehicleDetection[],
    timestampMs: number,
  ): TrackedVehicle[] {
    const unmatchedTracks = new Set(this.tracks.keys());
    const usedDetections = new Set<number>();

    // Greedy IoU association, prefer same class.
    const pairs: { trackId: VehicleTrackId; detIdx: number; score: number }[] =
      [];
    for (const [trackId, track] of this.tracks) {
      detections.forEach((det, detIdx) => {
        const overlap = iou(track.boundingBox, det.boundingBox);
        if (overlap < this.config.minimumIoU) return;
        const classBonus = track.vehicleType === det.vehicleType ? 0.05 : 0;
        pairs.push({ trackId, detIdx, score: overlap + classBonus });
      });
    }
    pairs.sort((a, b) => b.score - a.score);

    for (const pair of pairs) {
      if (!unmatchedTracks.has(pair.trackId) || usedDetections.has(pair.detIdx)) {
        continue;
      }
      unmatchedTracks.delete(pair.trackId);
      usedDetections.add(pair.detIdx);
      const det = detections[pair.detIdx]!;
      this.tracks.set(
        pair.trackId,
        bumpTrack(this.tracks.get(pair.trackId)!, det, timestampMs),
      );
    }

    for (const trackId of unmatchedTracks) {
      const track = this.tracks.get(trackId)!;
      const missed = track.missedFrameCount + 1;
      if (
        missed > this.config.maxMissedFrames ||
        timestampMs - track.lastSeenAtMs > this.config.trackRetentionMs
      ) {
        this.tracks.delete(trackId);
      } else {
        this.tracks.set(trackId, {
          ...track,
          missedFrameCount: missed,
          trackingConfidence: Math.max(0.1, track.trackingConfidence * 0.85),
        });
      }
    }

    detections.forEach((det, idx) => {
      if (usedDetections.has(idx)) return;
      const box = normalizeBox(det.boundingBox);
      const id = allocTrackId();
      const center = boxCenter(box);
      this.tracks.set(id, {
        trackId: id,
        vehicleType: det.vehicleType,
        classConfidence: det.confidence,
        trackingConfidence: det.confidence,
        boundingBox: box,
        bottomCenter: boxBottomCenter(box),
        firstSeenAtMs: timestampMs,
        lastSeenAtMs: timestampMs,
        visibleDurationMs: 0,
        missedFrameCount: 0,
        trajectory: [
          {
            timestampMs,
            centerX: center.x,
            centerY: center.y,
            width: box.width,
            height: box.height,
          },
        ],
      });
    });

    return this.getTracks();
  }

  matureTracks(): TrackedVehicle[] {
    return this.getTracks().filter(
      (t) => t.trajectory.length >= this.config.minimumTrackAgeFrames,
    );
  }
}

function bumpTrack(
  track: TrackedVehicle,
  det: VehicleDetection,
  timestampMs: number,
): TrackedVehicle {
  const box = normalizeBox(det.boundingBox);
  const center = boxCenter(box);
  const trajectory = [
    ...track.trajectory.slice(-24),
    {
      timestampMs,
      centerX: center.x,
      centerY: center.y,
      width: box.width,
      height: box.height,
    },
  ];
  return {
    ...track,
    vehicleType: det.vehicleType,
    classConfidence: det.confidence,
    trackingConfidence: Math.min(
      1,
      track.trackingConfidence * 0.7 + det.confidence * 0.3 + 0.05,
    ),
    boundingBox: box,
    bottomCenter: boxBottomCenter(box),
    lastSeenAtMs: timestampMs,
    visibleDurationMs: timestampMs - track.firstSeenAtMs,
    missedFrameCount: 0,
    trajectory,
  };
}

export function makeBox(
  x: number,
  y: number,
  width: number,
  height: number,
): NormalizedBoundingBox {
  return normalizeBox({ x, y, width, height });
}
