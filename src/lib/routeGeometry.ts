/**
 * Polyline geometry for driver committed-route rendering.
 * Mirrors `apps/web/src/lib/live/routing/geometry.ts`.
 */

const EARTH_M_PER_LAT_DEG = 111_320;

function cosLat(latDeg: number): number {
  return Math.cos((latDeg * Math.PI) / 180);
}

export type LatLng = { lat: number; lng: number };

export function projectOntoPolyline(
  polyline: LatLng[],
  point: LatLng,
): {
  segmentIndex: number;
  t: number;
  projection: LatLng;
  distanceMeters: number;
} | null {
  if (polyline.length < 2) return null;
  let best: {
    segmentIndex: number;
    t: number;
    projection: LatLng;
    distanceMeters: number;
  } | null = null;

  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1]!;
    const b = polyline[i]!;
    const latAvg = (a.lat + b.lat) / 2;
    const cosA = cosLat(latAvg);
    const ax = a.lng * cosA * EARTH_M_PER_LAT_DEG;
    const ay = a.lat * EARTH_M_PER_LAT_DEG;
    const bx = b.lng * cosA * EARTH_M_PER_LAT_DEG;
    const by = b.lat * EARTH_M_PER_LAT_DEG;
    const px = point.lng * cosA * EARTH_M_PER_LAT_DEG;
    const py = point.lat * EARTH_M_PER_LAT_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const segLenSq = dx * dx + dy * dy;
    if (segLenSq === 0) continue;
    let t = ((px - ax) * dx + (py - ay) * dy) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const distMeters = Math.hypot(px - projX, py - projY);
    if (!best || distMeters < best.distanceMeters) {
      const projLat = projY / EARTH_M_PER_LAT_DEG;
      const projLng = projX / (EARTH_M_PER_LAT_DEG * cosA);
      best = {
        segmentIndex: i - 1,
        t,
        projection: { lat: projLat, lng: projLng },
        distanceMeters: distMeters,
      };
    }
  }
  return best;
}

export function cumulativeMetersAt(
  polyline: LatLng[],
  segmentIndex: number,
  t: number,
): number {
  if (polyline.length < 2 || segmentIndex < 0) return 0;
  let total = 0;
  const lastIdx = Math.min(segmentIndex, polyline.length - 2);
  for (let i = 1; i <= lastIdx; i += 1) {
    total += metersBetween(polyline[i - 1]!, polyline[i]!);
  }
  const a = polyline[lastIdx]!;
  const b = polyline[lastIdx + 1]!;
  total += metersBetween(a, b) * Math.max(0, Math.min(1, t));
  return total;
}

export function metersBetween(a: LatLng, b: LatLng): number {
  const latAvg = (a.lat + b.lat) / 2;
  const dy = (b.lat - a.lat) * EARTH_M_PER_LAT_DEG;
  const dx = (b.lng - a.lng) * EARTH_M_PER_LAT_DEG * cosLat(latAvg);
  return Math.hypot(dx, dy);
}

/** Compass bearing from `a` → `b` in degrees (0 = north, clockwise). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const latAvg = (a.lat + b.lat) / 2;
  const dy = (b.lat - a.lat) * EARTH_M_PER_LAT_DEG;
  const dx = (b.lng - a.lng) * EARTH_M_PER_LAT_DEG * cosLat(latAvg);
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Infer turn direction from an approach polyline around the turn pin. */
export function inferTurnDirectionFromApproach(
  approachLine: LatLng[],
  turnPoint: LatLng,
): "left" | "right" | null {
  if (approachLine.length < 3) return null;

  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < approachLine.length; i += 1) {
    const d = metersBetween(approachLine[i]!, turnPoint);
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }
  if (closestIdx < 1 || closestIdx >= approachLine.length - 1) return null;

  const before = approachLine[closestIdx - 1]!;
  const at = approachLine[closestIdx]!;
  const after = approachLine[closestIdx + 1]!;
  const bearingIn = bearingDegrees(before, at);
  const bearingOut = bearingDegrees(at, after);
  let delta = bearingOut - bearingIn;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  if (Math.abs(delta) < 15) return null;
  return delta < 0 ? "left" : "right";
}

export function inferTurnDirectionFromRoute(
  route: LatLng[],
  turnPoint: LatLng,
): "left" | "right" | null {
  if (route.length < 3) return null;
  return inferTurnDirectionFromApproach(route, turnPoint);
}

export function slicePolylineByDistance(
  polyline: LatLng[],
  startMeters: number,
  endMeters: number,
): LatLng[] {
  if (polyline.length < 2) return [];
  const start = Math.max(0, Math.min(startMeters, endMeters));
  const end = Math.max(start, endMeters);
  const out: LatLng[] = [];
  let acc = 0;
  let started = false;
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1]!;
    const b = polyline[i]!;
    const segLen = metersBetween(a, b);
    if (segLen === 0) continue;
    const segStart = acc;
    const segEnd = acc + segLen;
    if (segEnd >= start && !started) {
      const t = (start - segStart) / segLen;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
      started = true;
    }
    if (started) {
      if (end <= segEnd) {
        const t = (end - segStart) / segLen;
        out.push({
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
        });
        return out;
      }
      out.push(b);
    }
    acc = segEnd;
  }
  return out;
}

export function trimPolylineAhead(
  polyline: LatLng[],
  driver: LatLng,
  opts: { doneMeters?: number; maxOffRouteMeters?: number } = {},
): LatLng[] {
  const { doneMeters = 6, maxOffRouteMeters = 40 } = opts;
  if (polyline.length < 2) return [];
  const proj = projectOntoPolyline(polyline, driver);
  if (!proj) return [];
  if (proj.distanceMeters > maxOffRouteMeters) return polyline;
  const end = polyline[polyline.length - 1]!;
  if (metersBetween(proj.projection, end) < doneMeters) return [];
  const rest = polyline.slice(proj.segmentIndex + 1);
  return [proj.projection, ...rest];
}

/** Slice planning polyline from driver position to the turn pin. */
export function buildRouteToPinPolyline(
  planningPolyline: LatLng[],
  driver: LatLng,
  stepTarget: LatLng,
): LatLng[] {
  if (planningPolyline.length < 2) {
    return [driver, stepTarget];
  }

  const driverProj = projectOntoPolyline(planningPolyline, driver);
  if (!driverProj) return [driver, stepTarget];

  const targetProj = projectOntoPolyline(planningPolyline, stepTarget);
  if (!targetProj) return [driver, stepTarget];

  const driverAlong = cumulativeMetersAt(
    planningPolyline,
    driverProj.segmentIndex,
    driverProj.t,
  );
  const targetAlong = cumulativeMetersAt(
    planningPolyline,
    targetProj.segmentIndex,
    targetProj.t,
  );
  const start = Math.max(0, driverAlong);
  const end = Math.max(start, targetAlong);
  const slice = slicePolylineByDistance(planningPolyline, start, end);
  if (slice.length < 2) return [driver, stepTarget];
  return slice;
}
