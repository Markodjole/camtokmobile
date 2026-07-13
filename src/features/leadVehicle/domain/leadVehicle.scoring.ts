import {
  DEFAULT_FORWARD_CORRIDOR,
  SCORE_WEIGHTS,
} from "./leadVehicle.constants";
import {
  boxArea,
  boxBottomCenter,
  clamp01,
  corridorCenterlineX,
  corridorHalfWidthAtY,
  pointInTrapezoid,
} from "./leadVehicle.geometry";
import type {
  ForwardCorridor,
  LeadVehicleScoreBreakdown,
  RiderTelemetrySnapshot,
  TrackedVehicle,
} from "./leadVehicle.types";

export function corridorScoreForTrack(
  track: TrackedVehicle,
  corridor: ForwardCorridor = DEFAULT_FORWARD_CORRIDOR,
): number {
  const bc = track.bottomCenter;
  const inside = pointInTrapezoid(bc, corridor);
  if (!inside) {
    const cx = corridorCenterlineX(bc.y, corridor);
    const half = corridorHalfWidthAtY(bc.y, corridor);
    const dist = Math.abs(bc.x - cx) / half;
    return clamp01(1 - dist * 0.85) * 0.25;
  }
  const cx = corridorCenterlineX(bc.y, corridor);
  const half = corridorHalfWidthAtY(bc.y, corridor);
  const lateral = 1 - Math.min(1, Math.abs(bc.x - cx) / half);
  const depth = clamp01(
    (bc.y - corridor.topY) / Math.max(0.001, corridor.bottomY - corridor.topY),
  );
  // Prefer mid-corridor depth (ahead but not under camera).
  const depthScore = 1 - Math.abs(depth - 0.55) * 1.2;
  return clamp01(0.55 * lateral + 0.45 * clamp01(depthScore));
}

export function persistenceScoreForTrack(track: TrackedVehicle): number {
  const ageSec = track.visibleDurationMs / 1000;
  const ageScore = clamp01(ageSec / 2.5);
  const missPenalty = clamp01(1 - track.missedFrameCount / 6);
  return clamp01(0.7 * ageScore + 0.3 * missPenalty);
}

export function centralityScoreForTrack(
  track: TrackedVehicle,
  corridor: ForwardCorridor = DEFAULT_FORWARD_CORRIDOR,
): number {
  const cx = corridorCenterlineX(track.bottomCenter.y, corridor);
  const half = corridorHalfWidthAtY(track.bottomCenter.y, corridor);
  return clamp01(1 - Math.abs(track.bottomCenter.x - cx) / half);
}

export function sizeRelevanceScoreForTrack(track: TrackedVehicle): number {
  const area = boxArea(track.boundingBox);
  // Too tiny = far / noise; too huge = beside / under camera.
  if (area < 0.01) return clamp01(area / 0.01) * 0.4;
  if (area > 0.35) return clamp01(1 - (area - 0.35) / 0.4);
  // Sweet spot roughly 0.03–0.18
  if (area < 0.03) return 0.5 + ((area - 0.01) / 0.02) * 0.3;
  if (area > 0.18) return 0.9 - ((area - 0.18) / 0.17) * 0.3;
  return 1;
}

export function relativeMotionScoreForTrack(track: TrackedVehicle): number {
  if (track.trajectory.length < 3) return 0.45;
  const pts = track.trajectory.slice(-8);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const dx = Math.abs(last.centerX - first.centerX);
  const dy = last.centerY - first.centerY;
  // Same-direction-ish: limited lateral, mild vertical change.
  const lateralPenalty = clamp01(dx / 0.35);
  const verticalOk = clamp01(1 - Math.abs(dy) / 0.4);
  return clamp01(0.65 * (1 - lateralPenalty) + 0.35 * verticalOk);
}

export function estimateSameDirectionConfidence(
  track: TrackedVehicle,
  telemetry?: RiderTelemetrySnapshot,
): number {
  const corridor = DEFAULT_FORWARD_CORRIDOR;
  const inCorridor = pointInTrapezoid(track.bottomCenter, corridor) ? 1 : 0.2;
  const persistence = persistenceScoreForTrack(track);
  const motion = relativeMotionScoreForTrack(track);

  let speedBoost = 0.5;
  if (telemetry?.speedMetersPerSecond != null) {
    speedBoost =
      telemetry.speedMetersPerSecond >= 0.8
        ? 0.85
        : telemetry.speedMetersPerSecond >= 0.3
          ? 0.6
          : 0.35;
  }

  // Strong lateral crossing → opposing / crossing traffic.
  let lateralPenalty = 0;
  if (track.trajectory.length >= 4) {
    const pts = track.trajectory.slice(-6);
    const dx = Math.abs(pts[pts.length - 1]!.centerX - pts[0]!.centerX);
    if (dx > 0.28) lateralPenalty = 0.35;
    if (dx > 0.45) lateralPenalty = 0.55;
  }

  return clamp01(
    0.3 * inCorridor +
      0.25 * persistence +
      0.25 * motion +
      0.2 * speedBoost -
      lateralPenalty,
  );
}

export function scoreLeadVehicle(
  track: TrackedVehicle,
  opts?: {
    corridor?: ForwardCorridor;
    telemetry?: RiderTelemetrySnapshot;
  },
): LeadVehicleScoreBreakdown {
  const corridor = opts?.corridor ?? DEFAULT_FORWARD_CORRIDOR;
  const corridorScore = corridorScoreForTrack(track, corridor);
  const persistenceScore = persistenceScoreForTrack(track);
  const centralityScore = centralityScoreForTrack(track, corridor);
  const relativeMotionScore = relativeMotionScoreForTrack(track);
  const detectionConfidenceScore = clamp01(track.classConfidence);
  const sizeRelevanceScore = sizeRelevanceScoreForTrack(track);

  const sameDir = estimateSameDirectionConfidence(track, opts?.telemetry);
  const opposingMotion = sameDir < 0.4 ? (0.4 - sameDir) * 0.8 : 0;
  const lateralExit = pointInTrapezoid(track.bottomCenter, corridor)
    ? 0
    : 0.25;
  const unstableTrack =
    track.trackingConfidence < 0.45 || track.missedFrameCount >= 3
      ? 0.2
      : 0;

  const totalScore = clamp01(
    corridorScore * SCORE_WEIGHTS.corridor +
      persistenceScore * SCORE_WEIGHTS.persistence +
      centralityScore * SCORE_WEIGHTS.centrality +
      relativeMotionScore * SCORE_WEIGHTS.relativeMotion +
      detectionConfidenceScore * SCORE_WEIGHTS.confidence +
      sizeRelevanceScore * SCORE_WEIGHTS.size -
      lateralExit -
      unstableTrack -
      opposingMotion,
  );

  return {
    corridorScore,
    persistenceScore,
    centralityScore,
    relativeMotionScore,
    detectionConfidenceScore,
    sizeRelevanceScore,
    penalties: {
      lateralExit,
      unstableTrack,
      opposingMotion,
    },
    totalScore,
  };
}

export function refreshBottomCenter(track: TrackedVehicle): TrackedVehicle {
  return {
    ...track,
    bottomCenter: boxBottomCenter(track.boundingBox),
  };
}
