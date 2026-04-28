/**
 * Tiny geo helpers used by the live driver-route layer.
 *
 * Equirectangular approximation — accurate to within ~0.2% for the < 1 km
 * distances we deal with (60 m bet-lock gate, 200–400 m pin spacing).
 * Mirrors `apps/web/src/lib/live/routing/geometry.ts#metersBetween` so
 * both clients and the server agree on the same number.
 */

const EARTH_M_PER_LAT_DEG = 111_320;

function cosLat(latDeg: number): number {
  return Math.cos((latDeg * Math.PI) / 180);
}

export function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const latAvg = (a.lat + b.lat) / 2;
  const dy = (b.lat - a.lat) * EARTH_M_PER_LAT_DEG;
  const dx = (b.lng - a.lng) * EARTH_M_PER_LAT_DEG * cosLat(latAvg);
  return Math.hypot(dx, dy);
}

/** Distance threshold (meters) at which betting locks. Mirrors web/server. */
export const BET_LOCK_DISTANCE_M = 60;
