import type { TrackedVehicle } from "./leadVehicle.types";

/**
 * Ignore one-frame flicker. Anything seen longer and then gone = passed.
 * No vehicle-type / grow / approach filters — count every vehicle.
 */
export const PASS_MIN_VISIBLE_MS = 120;

export type VehiclePassMemory = {
  trackId: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
};

export type VehiclePassEvent = {
  trackId: string;
  timestampMs: number;
  reason: "vehicle_lost";
};

export type VehiclePassCounterSnapshot = {
  vehiclesOnScreen: number;
  vehiclesPassed: number;
  lastPass: VehiclePassEvent | null;
};

/**
 * Session counter: vehicles on screen + passed total.
 * Pass = track was visible, then dropped by the tracker (left the frame).
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

  observe(
    tracks: TrackedVehicle[],
    removed: TrackedVehicle[],
    nowMs: number,
  ): VehiclePassCounterSnapshot {
    for (const track of tracks) {
      this.touch(track);
    }

    for (const track of removed) {
      this.touch(track);
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

  private touch(track: TrackedVehicle): void {
    const existing = this.memory.get(track.trackId);
    if (!existing) {
      this.memory.set(track.trackId, {
        trackId: track.trackId,
        firstSeenAtMs: track.firstSeenAtMs,
        lastSeenAtMs: track.lastSeenAtMs,
      });
      return;
    }
    existing.lastSeenAtMs = Math.max(existing.lastSeenAtMs, track.lastSeenAtMs);
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

    const event: VehiclePassEvent = {
      trackId,
      timestampMs: nowMs,
      reason: "vehicle_lost",
    };
    this.countedPassIds.add(trackId);
    this.passed += 1;
    this.lastPass = event;
    return event;
  }
}
