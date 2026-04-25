import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from "react-native-maps";
import type { RoutePoint } from "@/types/live";

type DriverRouteOverlay = {
  turnPoint: { lat: number; lng: number };
  checkpoint: { lat: number; lng: number };
  routePolyline: Array<{ lat: number; lng: number }>;
};

type Props = {
  routePoints: RoutePoint[];
  driverRoute?: DriverRouteOverlay | null;
  followDriver?: boolean;
};

// Camera animation duration — short enough to keep up with ~1 Hz GPS.
const CAMERA_ANIM_MS = 450;
const MARKER_PREDICT_MAX_MS = 1200;
const NAV_ZOOM_DELTA = 0.0012;

/**
 * Native live map.
 *
 * - `MapView` receives `initialRegion` only. Camera is moved imperatively via
 *   `animateCamera` so native smooth animation is used instead of React render.
 * - Camera animates every GPS tick (no distance threshold) with a short
 *   duration so it never lags behind the marker.
 * - Wrapped in `memo` so the map subtree doesn't re-render unless props
 *   actually changed.
 */
function LiveMapInner({ routePoints, driverRoute, followDriver = true }: Props) {
  const mapRef = useRef<MapView>(null);
  const markerRafRef = useRef<number | null>(null);
  const smoothedRef = useRef<RoutePoint | null>(null);
  const lastRawRef = useRef<RoutePoint | null>(null);
  const velocityRef = useRef<{ latPerMs: number; lngPerMs: number }>({
    latPerMs: 0,
    lngPerMs: 0,
  });
  const lastFrameTsRef = useRef<number | null>(null);
  const lastCameraTsRef = useRef<number>(0);
  const lastRawTsRef = useRef<number>(0);
  const targetRef = useRef<RoutePoint | null>(null);

  const last = routePoints[routePoints.length - 1];
  const [smoothedLast, setSmoothedLast] = useState<RoutePoint | null>(last ?? null);

  const initialRegion = useMemo<Region | undefined>(() => {
    if (!last) return undefined;
    return {
      latitude: last.lat,
      longitude: last.lng,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump camera to the first known point quickly.
  useEffect(() => {
    if (!last || !followDriver) return;
    mapRef.current?.animateCamera(
      {
        center: { latitude: last.lat, longitude: last.lng },
        heading: last.heading ?? 0,
        pitch: 50,
      },
      { duration: CAMERA_ANIM_MS / 2 },
    );
  }, [last, followDriver]);

  // Receive real GPS ticks and update target + velocity model
  useEffect(() => {
    if (!last) {
      smoothedRef.current = null;
      lastRawRef.current = null;
      targetRef.current = null;
      setSmoothedLast(null);
      return;
    }
    const now = Date.now();
    const prevRaw = lastRawRef.current;
    const prevRawTs = lastRawTsRef.current;
    if (prevRaw && prevRawTs > 0) {
      const dt = Math.max(1, now - prevRawTs);
      velocityRef.current = {
        latPerMs: (last.lat - prevRaw.lat) / dt,
        lngPerMs: (last.lng - prevRaw.lng) / dt,
      };
    }
    lastRawRef.current = last;
    lastRawTsRef.current = now;
    targetRef.current = last;

    if (!smoothedRef.current) {
      smoothedRef.current = last;
      setSmoothedLast(last);
    }
  }, [last?.lat, last?.lng, last?.heading, last?.speedMps]);

  // Continuous forward motion between ticks: predict forward and blend to target
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const target = targetRef.current;
      const current = smoothedRef.current;
      const lastFrameTs = lastFrameTsRef.current ?? now;
      const dt = Math.max(1, now - lastFrameTs);
      lastFrameTsRef.current = now;

      if (target && current) {
        const sinceRaw = now - lastRawTsRef.current;
        const predictFactor =
          sinceRaw < MARKER_PREDICT_MAX_MS
            ? 1 - sinceRaw / MARKER_PREDICT_MAX_MS
            : 0;
        const predictedLat =
          target.lat + velocityRef.current.latPerMs * sinceRaw * predictFactor;
        const predictedLng =
          target.lng + velocityRef.current.lngPerMs * sinceRaw * predictFactor;

        // Critically damped blend toward predicted point (fake smooth driving)
        const blend = 0.18;
        const next: RoutePoint = {
          lat: current.lat + (predictedLat - current.lat) * blend,
          lng: current.lng + (predictedLng - current.lng) * blend,
          heading: target.heading,
          speedMps: target.speedMps,
        };
        smoothedRef.current = next;
        setSmoothedLast(next);

        // Navigation mode camera: follow smoothed position, keep driving direction up.
        if (followDriver && now - lastCameraTsRef.current > 80) {
          const lookHeading = next.heading ?? target.heading ?? 0;
          mapRef.current?.setCamera({
            center: { latitude: next.lat, longitude: next.lng },
            heading: lookHeading,
            pitch: 50,
            altitude: 250,
            zoom: 18,
          });
          lastCameraTsRef.current = now;
        }
      }

      markerRafRef.current = requestAnimationFrame(tick);
    };

    markerRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (markerRafRef.current != null) {
        cancelAnimationFrame(markerRafRef.current);
        markerRafRef.current = null;
      }
      lastFrameTsRef.current = null;
    };
  }, []);

  const historyCoords = useMemo(
    () => routePoints.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [routePoints],
  );

  const railCoords = useMemo(
    () =>
      (driverRoute?.routePolyline ?? []).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [driverRoute],
  );

  const region: Region = {
    latitude: last?.lat ?? 44.0,
    longitude: last?.lng ?? 20.9,
    latitudeDelta: last ? NAV_ZOOM_DELTA : 0.5,
    longitudeDelta: last ? NAV_ZOOM_DELTA : 0.5,
  };

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={{ flex: 1 }}
      // initialRegion only — camera is driven imperatively via animateToRegion
      initialRegion={initialRegion ?? region}
      showsUserLocation={false}
      showsCompass={false}
      toolbarEnabled={false}
      // Keep tile cache between renders
      moveOnMarkerPress={false}
      rotateEnabled={false}
      pitchEnabled={false}
    >
      {historyCoords.length > 1 ? (
        <Polyline
          coordinates={historyCoords}
          strokeColor="#10b981"
          strokeWidth={5}
          lineDashPattern={undefined}
        />
      ) : null}

      {railCoords.length > 1 ? (
        <Polyline
          coordinates={railCoords}
          strokeColor="rgba(29,78,216,0.4)"
          strokeWidth={14}
        />
      ) : null}
      {railCoords.length > 1 ? (
        <Polyline
          coordinates={railCoords}
          strokeColor="rgba(59,130,246,0.85)"
          strokeWidth={7}
        />
      ) : null}

      {driverRoute?.turnPoint ? (
        <Circle
          center={{
            latitude: driverRoute.turnPoint.lat,
            longitude: driverRoute.turnPoint.lng,
          }}
          radius={16}
          strokeColor="#2563eb"
          strokeWidth={2}
          fillColor="rgba(59,130,246,0.22)"
        />
      ) : null}
      {driverRoute?.turnPoint ? (
        <Marker
          coordinate={{
            latitude: driverRoute.turnPoint.lat,
            longitude: driverRoute.turnPoint.lng,
          }}
          pinColor="#6366f1"
        />
      ) : null}

      {smoothedLast ? (
        <Marker
          coordinate={{ latitude: smoothedLast.lat, longitude: smoothedLast.lng }}
          pinColor="#ef4444"
          zIndex={999}
        />
      ) : null}
    </MapView>
  );
}

// Only re-render when the last GPS point or driver route meaningfully changes
export const LiveMap = memo(LiveMapInner, (prev, next) => {
  const prevLast = prev.routePoints[prev.routePoints.length - 1];
  const nextLast = next.routePoints[next.routePoints.length - 1];

  // Re-render if last point changed
  if (
    prevLast?.lat !== nextLast?.lat ||
    prevLast?.lng !== nextLast?.lng ||
    prevLast?.heading !== nextLast?.heading
  )
    return false;

  // Re-render if polyline gained new points
  if (prev.routePoints.length !== next.routePoints.length) return false;

  // Re-render if driver route changed
  if (
    prev.driverRoute?.turnPoint?.lat !== next.driverRoute?.turnPoint?.lat ||
    prev.driverRoute?.routePolyline?.length !==
      next.driverRoute?.routePolyline?.length
  )
    return false;

  return true; // identical — skip re-render
});
