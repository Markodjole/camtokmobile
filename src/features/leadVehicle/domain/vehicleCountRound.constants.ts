/** Rush Hour–style timed counting window (after bets lock). */
export const VEHICLE_COUNT_ROUND_MS = 30_000;

/** Horizontal count line in normalized crop space (0=top, 1=bottom). */
export const VEHICLE_COUNT_LINE_Y = 0.55;

/** IoU match for round-local tracks. */
export const ROUND_TRACK_MATCH_IOU = 0.2;
export const ROUND_TRACK_MAX_MISSES = 4;

/** Require stable sightings before counting a crossing. */
export const ROUND_MIN_HITS = 2;
export const ROUND_MIN_CONFIDENCE = 0.5;
