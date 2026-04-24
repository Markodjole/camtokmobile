import React, { memo, useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from "react-native-maps";
import Svg, { Path } from "react-native-svg";
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

// How many metres the driver must move before we animate the camera.
// Eliminates micro-jump noise on stationary GPS signal.
const MOVE_THRESHOLD_M = 3;

function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const sin2 =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(sin2), Math.sqrt(1 - sin2));
}

/**
 * Native live map.
 *
 * Key fixes vs previous version:
 * - `MapView` receives `initialRegion` only. The camera is moved
 *   imperatively via `animateToRegion(region, durationMs)` so iOS/Android
 *   use their native smooth animation instead of React's re-render cycle.
 * - Camera only re-fires when the driver moves more than MOVE_THRESHOLD_M
 *   to avoid micro-jitter on stationary GPS noise.
 * - Wrapped in `memo` so the map subtree doesn't re-render unless props
 *   actually changed.
 */
function LiveMapInner({ routePoints, driverRoute, followDriver = true }: Props) {
  const mapRef = useRef<MapView>(null);
  const lastAnimatedPos = useRef<{ lat: number; lng: number } | null>(null);

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

  // Imperatively smooth-animate the camera as the driver moves
  useEffect(() => {
    if (!last || !followDriver) return;
    const prev = lastAnimatedPos.current;
    if (prev && distanceM(prev, last) < MOVE_THRESHOLD_M) return;

    lastAnimatedPos.current = last;
    mapRef.current?.animateToRegion(
      {
        latitude: last.lat,
        longitude: last.lng,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      },
      800, // ms — smooth glide
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
            strokeColor="rgba(29,78,216,0.35)"
            strokeWidth={14}
          />
          <Polyline
            coordinates={railCoords}
            strokeColor="#3b82f6"
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
          rotation={last.heading ?? 0}
          flat
          zIndex={999}
          tracksViewChanges={false}
        >
          {/* Arrow pointing north — rotated by `rotation` prop above */}
          <View
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.7,
              shadowRadius: 4,
              elevation: 8,
            }}
          >
            <Svg width={32} height={32} viewBox="0 0 32 32">
              <Path
                d="M16 2 L30 30 L16 23 L2 30 Z"
                fill="#ef4444"
                stroke="white"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            </Svg>
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
