import React, { memo, useEffect, useMemo, useRef } from "react";
import { Text, View } from "react-native";
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

  const last = routePoints[routePoints.length - 1];

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

      {last ? (
        <Marker
          coordinate={{ latitude: last.lat, longitude: last.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          centerOffset={{ x: 0, y: 0 }}
          rotation={last.heading ?? 0}
          flat
          zIndex={999}
          tracksViewChanges
        >
          {/* Perfectly centered arrow with text-shadow halo for contrast */}
          <View
            style={{
              width: 40,
              height: 40,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontSize: 32,
                lineHeight: 32,
                color: "#ef4444",
                textAlign: "center",
                includeFontPadding: false,
                textShadowColor: "white",
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 4,
              }}
            >
              ▲
            </Text>
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
