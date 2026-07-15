/** Rush Hour–style timed counting window (after bets lock). */
export const VEHICLE_COUNT_ROUND_MS = 30_000;

/** Count line in normalized road-band space (0=top, 1=bottom). */
export const VEHICLE_COUNT_LINE_Y = 0.55;
/** A track must reach at least this far down to be eligible (ignore far horizon). */
export const VEHICLE_COUNT_MIN_BOTTOM_Y = 0.4;

/** Association: match a detection to a track by IoU OR nearby centroid. */
export const ROUND_TRACK_MATCH_IOU = 0.15;
/** Centroid fallback distance (normalized) — tolerates fast bike-cam motion. */
export const ROUND_TRACK_MATCH_DIST = 0.14;
/** Keep a track alive across brief occlusion/misses (~6 frames ≈ 240ms). */
export const ROUND_TRACK_MAX_MISSES = 6;

/** Temporal stability before a track can ever count. */
export const ROUND_MIN_HITS = 3;
export const ROUND_MIN_CONFIDENCE = 0.5;

/** Server count preferred only when refreshed within this window. */
export const SERVER_COUNT_STALE_MS = 2_500;
