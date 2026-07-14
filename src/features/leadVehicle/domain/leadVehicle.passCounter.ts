import { classifyRelativeMovement } from "./leadVehicle.motion";
import type { TrackedVehicle } from "./leadVehicle.types";

/** Ignore sub-3-frame flicker at ~15 FPS. */
export const PASS_MIN_VISIBLE_MS = 200;
/** How long a nearly-static sighting counts as "red light / waiting". */
export const STABLE_RED_LIGHT_MS = 800;

export type VehiclePassMemory = {
  trackId: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  firstArea: number;
  peakArea: number;
  lastArea: number;
  lastRelative: string;
  /** Accumulated ms spent looking motionless relative to us (red light queues). */
  stableMs: number;
  lastTouchAtMs: number;
};

export type VehiclePassEvent = {
  trackId: string;
  timestampMs: number;
  /** +1 we passed them, -1 they passed us */
  delta: 1 | -1;
  reason: "we_passed" | "they_passed";
};

export type VehiclePassCounterSnapshot = {
  vehiclesOnScreen: number;
  /** Net score: +1 per vehicle we pass, -1 when they pass us. */
  vehiclesPassed: number;
  lastPass: VehiclePassEvent | null;
};

/**
 * Net pass counter from vision tracks (type-agnostic).
 * Bigger then gone → we passed them (+1).
 * Smaller then gone → they pulled ahead / passed us (-1).
 * Sat still with us (red light) then left frame → still counted (+1 when we clear them).
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
    const relative = classifyRelativeMovement(track, { nowMs });
    const existing = this.memory.get(track.trackId);
    if (!existing) {
      this.memory.set(track.trackId, {
        trackId: track.trackId,
        firstSeenAtMs: track.firstSeenAtMs,
        lastSeenAtMs: track.lastSeenAtMs,
        firstArea: area || 0.0001,
        peakArea: area,
        lastArea: area,
        lastRelative: relative,
        stableMs: isStillRelative(relative) ? 0 : 0,
        lastTouchAtMs: nowMs,
      });
      return;
    }

    const dt = Math.max(0, nowMs - existing.lastTouchAtMs);
    if (isStillRelative(relative) || isStillRelative(existing.lastRelative)) {
      // Sitting in traffic / red light — relative box barely changes.
      const areaDelta =
        Math.abs(area - existing.lastArea) / Math.max(existing.lastArea, 0.0001);
      if (areaDelta < 0.12) {
        existing.stableMs += dt;
      }
    }

    existing.lastSeenAtMs = Math.max(existing.lastSeenAtMs, track.lastSeenAtMs);
    existing.peakArea = Math.max(existing.peakArea, area);
    existing.lastArea = area;
    existing.lastRelative = relative;
    existing.lastTouchAtMs = nowMs;
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

    const delta = resolvePassDelta(mem);
    const event: VehiclePassEvent = {
      trackId,
      timestampMs: nowMs,
      delta,
      reason: delta === 1 ? "we_passed" : "they_passed",
    };
    this.countedPassIds.add(trackId);
    this.passed += delta;
    this.lastPass = event;
    return event;
  }
}

function isStillRelative(rel: string): boolean {
  return (
    rel === "stable_ahead" ||
    rel === "uncertain" ||
    rel === "temporarily_occluded"
  );
}

function resolvePassDelta(mem: VehiclePassMemory): 1 | -1 {
  const rel = mem.lastRelative;
  if (
    rel === "approaching" ||
    rel === "slowing_or_rider_approaching"
  ) {
    return 1;
  }
  if (rel === "moving_away") {
    return -1;
  }

  const growth = mem.lastArea / Math.max(mem.firstArea, 0.0001);
  if (growth >= 1.08 || mem.peakArea >= mem.firstArea * 1.2) {
    return 1;
  }
  if (growth <= 0.92) {
    return -1;
  }

  // Red light / stopped traffic: sat still with us, then left the frame
  // (you rolled past the queue, or they peeled off after the light).
  if (
    mem.stableMs >= STABLE_RED_LIGHT_MS ||
    rel === "stable_ahead" ||
    isStillRelative(rel)
  ) {
    return 1;
  }

  if (mem.lastArea >= 0.04 || mem.peakArea >= 0.05) return 1;
  return -1;
}
