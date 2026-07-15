/** Rush Hour–style timed counting window (after bets lock). */
export const VEHICLE_COUNT_ROUND_MS = 30_000;

/** Counting zone in normalized road-band space (0=top, 1=bottom). */
export const VEHICLE_COUNT_ZONE_TOP = 0.22;
export const VEHICLE_COUNT_ZONE_BOTTOM = 0.9;

/** Legacy line — still used as secondary crossing signal. */
export const VEHICLE_COUNT_LINE_Y = 0.55;

/** IoU match for round-local tracks. */
export const ROUND_TRACK_MATCH_IOU = 0.18;
export const ROUND_TRACK_MAX_MISSES = 6;

/** Stable sightings before counting (1 if very confident). */
export const ROUND_MIN_HITS = 1;
export const ROUND_MIN_HITS_LOW_CONF = 2;
export const ROUND_MIN_CONFIDENCE = 0.42;
export const ROUND_HIGH_CONFIDENCE = 0.62;

/** Server count preferred when refreshed within this window. */
export const SERVER_COUNT_STALE_MS = 2_500;
