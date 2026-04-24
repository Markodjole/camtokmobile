import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { apiFetch } from "@/lib/api";
import type { RoutePoint, TransportMode } from "@/types/live";

type TelemetryPoint = {
  recordedAt: string;
  lat: number;
  lng: number;
  speedMps?: number;
  headingDeg?: number;
  accuracyMeters?: number;
};

const HEARTBEAT_MS = 600;

/**
 * Owner-side telemetry loop.
 *
 * 1. Starts a foreground GPS watcher (expo-location) and buffers points.
 * 2. Every 1 second:
 *      - flushes up to 10 points to `/api/live/sessions/:id/location`
 *      - pings `/api/live/sessions/:id/heartbeat`
 * 3. Exposes `routePoints` (last 200) for the local preview.
 *
 * Mirrors the web OwnerLiveControlPanel telemetry loop.
 */
export function useBroadcasterTelemetry(params: {
  sessionId: string | null;
  transportMode: TransportMode;
  onError?: (message: string) => void;
}) {
  const { sessionId, transportMode, onError } = params;
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const pendingRef = useRef<TelemetryPoint[]>([]);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    async function start() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      const granted = status === "granted";
      setHasPermission(granted);
      if (!granted) {
        onError?.("Location permission denied");
        return;
      }
      try {
        watcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1_000,
            distanceInterval: 1,
          },
          (pos) => {
            const point: RoutePoint = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading:
                pos.coords.heading != null && !Number.isNaN(pos.coords.heading)
                  ? pos.coords.heading
                  : undefined,
              speedMps:
                pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
                  ? pos.coords.speed
                  : undefined,
            };
            setRoutePoints((prev) => [...prev.slice(-199), point]);
            pendingRef.current.push({
              recordedAt: new Date(pos.timestamp ?? Date.now()).toISOString(),
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              speedMps: point.speedMps,
              headingDeg: point.heading,
              accuracyMeters: pos.coords.accuracy ?? undefined,
            });
          },
        );
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Location error");
      }
    }

    void start();

    const heartbeat = setInterval(async () => {
      if (!sessionId) return;
      const batch = pendingRef.current.splice(0, 20);
      if (batch.length > 0) {
        try {
          await apiFetch(`/api/live/sessions/${sessionId}/location`, {
            method: "POST",
            body: { transportMode, points: batch },
          });
        } catch (e) {
          onError?.(e instanceof Error ? e.message : "Location sync failed");
        }
      }
      try {
        await apiFetch(`/api/live/sessions/${sessionId}/heartbeat`, {
          method: "POST",
          body: {},
        });
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Heartbeat failed");
      }
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
  }, [sessionId, transportMode, onError]);

  return { routePoints, hasPermission };
}
