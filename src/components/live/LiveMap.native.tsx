import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
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
const MARKER_SMOOTH_MS = 500;

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

  // Imperatively smooth-animate the camera on every new GPS point
  useEffect(() => {
    if (!last || !followDriver) return;
    mapRef.current?.animateCamera(
      {
        center: { latitude: last.lat, longitude: last.lng },
      },
      { duration: CAMERA_ANIM_MS },
    );
  }, [last, followDriver]);

  // "Fake smoothness": interpolate marker position between network/GPS points
  useEffect(() => {
    if (!last) {
      smoothedRef.current = null;
      setSmoothedLast(null);
      return;
    }

    if (markerRafRef.current != null) {
      cancelAnimationFrame(markerRafRef.current);
      markerRafRef.current = null;
    }

    const from = smoothedRef.current ?? last;
    const to = last;
    const start = Date.now();

    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / MARKER_SMOOTH_MS);
      const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
      const next: RoutePoint = {
        lat: from.lat + (to.lat - from.lat) * eased,
        lng: from.lng + (to.lng - from.lng) * eased,
        heading:
          (from.heading ?? to.heading ?? 0) +
          ((to.heading ?? from.heading ?? 0) - (from.heading ?? to.heading ?? 0)) *
            eased,
        speedMps: to.speedMps,
      };
      smoothedRef.current = next;
      setSmoothedLast(next);

      if (t < 1) {
        markerRafRef.current = requestAnimationFrame(tick);
      } else {
        markerRafRef.current = null;
      }
    };

    markerRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (markerRafRef.current != null) {
        cancelAnimationFrame(markerRafRef.current);
        markerRafRef.current = null;
      }
    };
  }, [last?.lat, last?.lng, last?.heading, last?.speedMps]);

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
    latitudeDelta: last ? 0.005 : 0.5,
    longitudeDelta: last ? 0.005 : 0.5,
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
        <>
          <Polyline
            coordinates={railCoords}
            strokeColor="rgba(29,78,216,0.4)"
            strokeWidth={14}
          />
          <Polyline
            coordinates={railCoords}
            strokeColor="rgba(59,130,246,0.85)"
            strokeWidth={7}
          />
        </>
      ) : null}

      {driverRoute?.turnPoint ? (
        <>
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
          <Marker
            coordinate={{
              latitude: driverRoute.turnPoint.lat,
              longitude: driverRoute.turnPoint.lng,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 2,
                borderColor: "white",
                backgroundColor: "#6366f1",
              }}
            />
          </Marker>
        </>
      ) : null}

      {smoothedLast ? (
        <Marker
          coordinate={{ latitude: smoothedLast.lat, longitude: smoothedLast.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          centerOffset={{ x: 0, y: 0 }}
          rotation={smoothedLast.heading ?? 0}
          flat
          zIndex={999}
          tracksViewChanges
        >
          {/* Geometric arrow (not font glyph) keeps center alignment precise */}
          <View
            style={{
              width: 40,
              height: 40,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                borderLeftWidth: 12,
                borderRightWidth: 12,
                borderBottomWidth: 24,
                borderLeftColor: "transparent",
                borderRightColor: "transparent",
                borderBottomColor: "white",
              }}
            />
            <View
              style={{
                width: 0,
                height: 0,
                borderLeftWidth: 9,
                borderRightWidth: 9,
                borderBottomWidth: 18,
                borderLeftColor: "transparent",
                borderRightColor: "transparent",
                borderBottomColor: "#ef4444",
              }}
            />
          </View>
        </Marker>
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
