import { MOTION_WINDOW_MS } from "./leadVehicle.constants";
import { boxArea } from "./leadVehicle.geometry";
import type {
  LeadVehicleRelativeState,
  TrackedVehicle,
} from "./leadVehicle.types";

/**
 * Classify relative lead-vehicle motion from a rolling trajectory window.
 */
export function classifyRelativeMovement(
  track: TrackedVehicle,
  opts?: { windowMs?: number; nowMs?: number; occluded?: boolean },
): LeadVehicleRelativeState {
  if (opts?.occluded) return "temporarily_occluded";
  if (track.missedFrameCount > 0 && track.trajectory.length === 0) {
    return "lost";
  }

  const windowMs = opts?.windowMs ?? MOTION_WINDOW_MS;
  const now = opts?.nowMs ?? track.lastSeenAtMs;
  const pts = track.trajectory.filter((p) => now - p.timestampMs <= windowMs);
  if (pts.length < 3) return "uncertain";

  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const dt = Math.max(1, last.timestampMs - first.timestampMs);
  const dx = last.centerX - first.centerX;
  const areaFirst = first.width * first.height;
  const areaLast = last.width * last.height;
  const areaDelta = areaLast - areaFirst;
  const areaRate = areaDelta / (dt / 1000);

  const absDx = Math.abs(dx);
  if (absDx > 0.08 && absDx > Math.abs(areaDelta) * 2) {
    return dx < 0 ? "moving_left" : "moving_right";
  }

  if (areaRate > 0.04) return "approaching";
  if (areaRate < -0.035) return "moving_away";

  // Mild growth + rider catching up pattern.
  if (areaRate > 0.015 && absDx < 0.05) {
    return "slowing_or_rider_approaching";
  }

  if (absDx < 0.04 && Math.abs(areaDelta) < 0.03) {
    return "stable_ahead";
  }

  return "uncertain";
}

export function areaTrend(
  track: TrackedVehicle,
  windowMs = MOTION_WINDOW_MS,
): number {
  const now = track.lastSeenAtMs;
  const pts = track.trajectory.filter((p) => now - p.timestampMs <= windowMs);
  if (pts.length < 2) return 0;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return boxArea({
    x: 0,
    y: 0,
    width: last.width,
    height: last.height,
  }) -
    boxArea({
      x: 0,
      y: 0,
      width: first.width,
      height: first.height,
    });
}
