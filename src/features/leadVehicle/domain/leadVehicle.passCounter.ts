import { classifyRelativeMovement } from "./leadVehicle.motion";
import type { TrackedVehicle } from "./leadVehicle.types";

const APPROACHING = new Set([
  "approaching",
  "slowing_or_rider_approaching",
]);

/** Min visible time before a disappearance can count as a pass. */
export const PASS_MIN_VISIBLE_MS = 600;
/** Peak area must grow vs first-seen area by at least this ratio. */
export const PASS_MIN_AREA_GROWTH = 1.35;
/** Peak box area floor — avoids tiny/noisy far detections. */
export const PASS_MIN_PEAK_AREA = 0.012;

export type VehiclePassMemory = {
  trackId: string;
  vehicleType: string;
  firstArea: number;
  peakArea: number;
  sawApproaching: boolean;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
};

export type VehiclePassEvent = {
  trackId: string;
  vehicleType: string;
  timestampMs: number;
  peakArea: number;
  reason: "grew_then_lost" | "approaching_then_lost";
};

export type VehiclePassCounterSnapshot = {
  vehiclesOnScreen: number;
  vehiclesPassed: number;
  lastPass: VehiclePassEvent | null;
};

/**
 * Session counter: every visible vehicle ahead counts toward "on screen".
 * A pass fires when a track disappears after getting meaningfully bigger
 * (or after an approaching motion state) — grow → vanish ≈ we overtook it.
 */
export class VehiclePassCounter {
  private memory = new Map<string, VehiclePassMemory>();
  private passed = 0;
  private lastPass: VehiclePassEvent | null = null;
  private countedPassIds = new Set<string>();

  reset(): void {
    this.memory.clear();
    this.passed = 0;
    this.lastPass = null;
    this.countedPassIds.clear();
  }

  /**
   * @param tracks current tracker tracks (including briefly missed)
   * @param removed tracks hard-deleted this frame
   */
  observe(
    tracks: TrackedVehicle[],
    removed: TrackedVehicle[],
    nowMs: number,
  ): VehiclePassCounterSnapshot {
    for (const track of tracks) {
      this.touch(track, nowMs);
    }

    for (const track of removed) {
      this.touch(track, nowMs);
      this.finalizeLost(track.trackId, nowMs);
    }

    const onScreen = tracks.filter((t) => t.missedFrameCount === 0).length;
    return {
      vehiclesOnScreen: onScreen,
      vehiclesPassed: this.passed,
      lastPass: this.lastPass,
    };
  }

  snapshot(): VehiclePassCounterSnapshot {
    return {
      vehiclesOnScreen: [...this.memory.values()].length,
      vehiclesPassed: this.passed,
      lastPass: this.lastPass,
    };
  }

  private touch(track: TrackedVehicle, nowMs: number): void {
    const area = Math.max(
      0,
      track.boundingBox.width * track.boundingBox.height,
    );
    const existing = this.memory.get(track.trackId);
    const relative = classifyRelativeMovement(track, { nowMs });
    const approaching = APPROACHING.has(relative);

    if (!existing) {
      this.memory.set(track.trackId, {
        trackId: track.trackId,
        vehicleType: track.vehicleType,
        firstArea: area || 0.0001,
        peakArea: area,
        sawApproaching: approaching,
        firstSeenAtMs: track.firstSeenAtMs,
        lastSeenAtMs: track.lastSeenAtMs,
      });
      return;
    }

    existing.vehicleType = track.vehicleType;
    existing.peakArea = Math.max(existing.peakArea, area);
    existing.lastSeenAtMs = track.lastSeenAtMs;
    if (approaching) existing.sawApproaching = true;
  }

  private finalizeLost(
    trackId: string,
    nowMs: number,
  ): VehiclePassEvent | null {
    if (this.countedPassIds.has(trackId)) {
      this.memory.delete(trackId);
      return null;
    }
    const mem = this.memory.get(trackId);
    this.memory.delete(trackId);
    if (!mem) return null;

    const visibleMs = Math.max(0, mem.lastSeenAtMs - mem.firstSeenAtMs);
    if (visibleMs < PASS_MIN_VISIBLE_MS) return null;
    if (mem.peakArea < PASS_MIN_PEAK_AREA) return null;

    const growth = mem.peakArea / Math.max(mem.firstArea, 0.0001);
    const grew = growth >= PASS_MIN_AREA_GROWTH;
    if (!mem.sawApproaching && !grew) return null;

    const event: VehiclePassEvent = {
      trackId,
      vehicleType: mem.vehicleType,
      timestampMs: nowMs,
      peakArea: mem.peakArea,
      reason: mem.sawApproaching ? "approaching_then_lost" : "grew_then_lost",
    };
    this.countedPassIds.add(trackId);
    this.passed += 1;
    this.lastPass = event;
    return event;
  }
}
