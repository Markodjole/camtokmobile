import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import { apiFetch } from "@/lib/api";
import {
  clearLiveTelemetryPending,
  drainLiveTelemetryPending,
  pushLiveTelemetryPoint,
} from "@/lib/liveTelemetryBuffer";
import {
  LIVE_LOCATION_TASK,
  startLiveLocationTask,
  stopLiveLocationTask,
} from "@/tasks/liveLocationTask";
import type { RoutePoint, TransportMode } from "@/types/live";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";

const HEARTBEAT_MS = 600;

/**
 * Owner-side telemetry loop.
 *
 * Uses a background-capable location task (native) so GPS + heartbeats keep
 * running when the app is briefly interrupted (e.g. incoming phone call overlay).
 * Falls back to foreground watchPositionAsync on web.
 */
export function useBroadcasterTelemetry(params: {
  sessionId: string | null;
  transportMode: TransportMode;
  onError?: (message: string) => void;
  active?: boolean;
}) {
  const { sessionId, transportMode, onError, active = true } = params;
  const setSession = useLiveBroadcastStore((s) => s.setSession);
  const setStoreRoutePoints = useLiveBroadcastStore((s) => s.setRoutePoints);
  const setStorePermission = useLiveBroadcastStore((s) => s.setHasLocationPermission);
  const clearStore = useLiveBroadcastStore((s) => s.clear);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const onErrorRef = useRef(onError);
  const lastFixAtRef = useRef(0);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    setSession(sessionId ?? null);
    if (!sessionId) {
      setStoreRoutePoints([]);
      setStorePermission(null);
    }
  }, [sessionId, setSession, setStoreRoutePoints, setStorePermission]);

  useEffect(() => {
    if (!active || !sessionId) return;

    let cancelled = false;

    function ingestPosition(pos: Location.LocationObject) {
      lastFixAtRef.current = Date.now();
      const speedMps =
        pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
          ? pos.coords.speed
          : undefined;
      const heading =
        pos.coords.heading != null &&
        !Number.isNaN(pos.coords.heading) &&
        pos.coords.heading >= 0 &&
        (speedMps ?? 0) >= 0.5
          ? pos.coords.heading
          : undefined;
      const routePoint: RoutePoint = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        heading,
        speedMps,
      };
      pushLiveTelemetryPoint(
        {
          recordedAt: new Date(pos.timestamp ?? Date.now()).toISOString(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speedMps: routePoint.speedMps,
          headingDeg: routePoint.heading,
          accuracyMeters: pos.coords.accuracy ?? undefined,
        },
        routePoint,
      );
    }

    async function ensureNativeLocationTask() {
      if (Platform.OS === "web") return;
      try {
        const result = await startLiveLocationTask();
        if (cancelled) return;
        // Foreground watcher still works when the background task is
        // unavailable / fails — only real FG denial is a hard error.
        if (result === "no_permission") {
          onErrorRef.current?.("Location permission denied");
        } else if (result === "failed" && __DEV__) {
          // eslint-disable-next-line no-console
          console.warn(
            "[mobile-live-telemetry] background location task failed; using foreground watcher",
          );
        }
      } catch (e) {
        if (!cancelled && __DEV__) {
          // eslint-disable-next-line no-console
          console.warn(
            "[mobile-live-telemetry] background location error:",
            e instanceof Error ? e.message : e,
          );
        }
      }
    }

    async function start() {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (cancelled) return;
      const granted = status === "granted";
      setStorePermission(granted);
      if (!granted) {
        onErrorRef.current?.("Location permission denied");
        return;
      }

      try {
        const seed = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) ingestPosition(seed);
      } catch {
        // Non-fatal — watcher/task will deliver fixes.
      }

      if (Platform.OS === "web") {
        try {
          watcherRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Highest,
              timeInterval: 450,
              distanceInterval: 0,
            },
            ingestPosition,
          );
        } catch (e) {
          onErrorRef.current?.(
            e instanceof Error ? e.message : "Location watcher failed",
          );
        }
        return;
      }

      await ensureNativeLocationTask();

      // Foreground watcher keeps UI smooth; background task survives call overlay.
      try {
        watcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Highest,
            timeInterval: 450,
            distanceInterval: 0,
          },
          ingestPosition,
        );
      } catch {
        // Task alone is enough for server telemetry.
      }
    }

    void start();

    const heartbeat = setInterval(async () => {
      if (!sessionId) return;
      const batch = drainLiveTelemetryPending(20);
      if (batch.length > 0) {
        try {
          await apiFetch(`/api/live/sessions/${sessionId}/location`, {
            method: "POST",
            body: { transportMode, points: batch },
          });
        } catch (e) {
          onErrorRef.current?.(
            e instanceof Error ? e.message : "Location sync failed",
          );
        }
      }
      try {
        await apiFetch(`/api/live/sessions/${sessionId}/heartbeat`, {
          method: "POST",
          body: {},
        });
      } catch (e) {
        onErrorRef.current?.(
          e instanceof Error ? e.message : "Heartbeat failed",
        );
      }
    }, HEARTBEAT_MS);

    const resumeCheck = setInterval(() => {
      if (cancelled || Platform.OS === "web") return;
      void ensureNativeLocationTask();
      if (Date.now() - lastFixAtRef.current > 4000) {
        watcherRef.current?.remove();
        watcherRef.current = null;
        void Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Highest,
            timeInterval: 450,
            distanceInterval: 0,
          },
          ingestPosition,
        )
          .then((sub) => {
            if (!cancelled) watcherRef.current = sub;
            else sub.remove();
          })
          .catch(() => undefined);
      }
    }, 3000);

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (cancelled) return;
      if (next === "active" || next === "inactive") {
        void ensureNativeLocationTask();
      }
    });

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      clearInterval(resumeCheck);
      appStateSub.remove();
      watcherRef.current?.remove();
      watcherRef.current = null;
      void stopLiveLocationTask();
      clearLiveTelemetryPending();
      if (!sessionId) clearStore();
    };
  }, [
    active,
    sessionId,
    transportMode,
    clearStore,
    setStorePermission,
    setStoreRoutePoints,
  ]);

  const state = useLiveBroadcastStore.getState();
  return {
    routePoints: state.routePoints,
    hasPermission: state.hasLocationPermission,
  };
}
