import { useEffect, useRef, useState } from "react";

type Params = {
  lat: number | undefined;
  lng: number | undefined;
  /** When true, only flag "stale" if speed indicates movement and coords stopped updating. */
  requireMovement: boolean;
  speedMps: number | undefined;
  /** Speed above this (m/s) counts as "moving" for requireMovement. */
  movingSpeedThreshold?: number;
  /** Time without a new lat/lng before we flag stale. */
  staleAfterMs: number;
  enabled?: boolean;
};

/**
 * Detects when live map input froze: same coordinates for too long.
 * For drivers, optional `requireMovement` avoids a banner while parked.
 */
export function useLiveMapStale({
  lat,
  lng,
  requireMovement,
  speedMps,
  movingSpeedThreshold = 0.7,
  staleAfterMs,
  enabled = true,
}: Params) {
  const [stale, setStale] = useState(false);
  const lastKeyRef = useRef<string | null>(null);
  const lastChangeAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || lat === undefined || lng === undefined) {
      setStale(false);
      return;
    }
    const key = `${lat.toFixed(6)}_${lng.toFixed(6)}`;
    const now = Date.now();
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
      lastChangeAtRef.current = now;
      setStale(false);
    } else if (lastChangeAtRef.current == null) {
      lastChangeAtRef.current = now;
    }
  }, [lat, lng, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (lat === undefined || lng === undefined) {
        setStale(false);
        return;
      }
      const t0 = lastChangeAtRef.current;
      if (t0 == null) return;
      const age = Date.now() - t0;
      if (age < staleAfterMs) {
        setStale(false);
        return;
      }
      if (requireMovement) {
        const moving = (speedMps ?? 0) > movingSpeedThreshold;
        setStale(moving);
      } else {
        setStale(true);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [enabled, requireMovement, speedMps, movingSpeedThreshold, staleAfterMs, lat, lng]);

  return stale;
}
