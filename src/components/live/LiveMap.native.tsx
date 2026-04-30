import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import MapView, {
  Marker,
  Polygon,
  Polyline,
  PROVIDER_GOOGLE,
  type Region,
} from "react-native-maps";
import { Text, View } from "react-native";
import type { RoutePoint } from "@/types/live";

/**
 * Driver-route overlay passed to the map. Mirrors the new API shape:
 *   - `pin`: the next blue dot (the closest of the AI-decided 3 pins
 *     ahead). Stays visible from the moment it appears until the
 *     vehicle physically passes it.
 *   - `approachLine`: turn guidance around the pin
 *     (~50 m before + up to ~20 m after). We render it as-is.
 */
type DriverRouteOverlay = {
  pin: { lat: number; lng: number; distanceMeters?: number } | null;
  approachLine: Array<{ lat: number; lng: number }>;
};

type Props = {
  routePoints: RoutePoint[];
  driverRoute?: DriverRouteOverlay | null;
  destination?: { lat: number; lng: number; label?: string } | null;
  destinationRoute?: Array<{ lat: number; lng: number }> | null;
  zones?: Array<{
    id: string;
    name: string;
    color: string;
    polygon: Array<{ lat: number; lng: number }>;
    isActive?: boolean;
  }>;
  checkpoints?: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    isActive?: boolean;
  }>;
  /** Highlighted zone id (for city grid: the selected cell). */
  selectedZoneId?: string | null;
  /** Called when user taps a zone polygon. */
  onZoneSelect?: (id: string | null) => void;
  followDriver?: boolean;
  /** Higher zoom = closer view. Default 17. Pass 19 for driver close-up. */
  followZoom?: number;
  /** Increment to clear smoothing/camera state and re-seed from the latest point (recovery when stuck). */
  mapResetKey?: number;
  /** Draw blue 50m line only for driver mode. */
  showGuidanceLine?: boolean;
  /** Called when user manually pans/zooms map. */
  onUserInteract?: () => void;
};

const NAV_ZOOM_DELTA = 0.0012;

// ── Smoothing tuning ─────────────────────────────────────────────────────────
//
// The marker is animated as a critically-damped 2nd-order system:
//   acceleration = STIFFNESS * (target - position) - DAMPING * velocity
//
// Critically-damped requires DAMPING ≈ 2 * sqrt(STIFFNESS).
//
// Target is *projected forward* using a smoothed velocity, so the marker is
// always moving toward where the driver "should be" right now, not where
// they were when the last GPS poll arrived. This eliminates the per-poll
// "step" feel.

// Spring stiffness (1/s²). Slightly lower than before for smoother easing.
const SPRING_STIFFNESS = 11;
// Critical damping coefficient (1/s).
const SPRING_DAMPING = 2 * Math.sqrt(SPRING_STIFFNESS);
// Velocity EMA factor (per GPS sample). Smooths jitter in instantaneous speed.
const VELOCITY_EMA = 0.24;
// Heading EMA (per GPS sample, applied via sin/cos for circular continuity).
const HEADING_EMA = 0.24;
// Cap how far ahead we project (ms). Prevents rocketing forward if GPS pauses.
const MAX_PROJECT_MS = 1500;
// If packets are late, keep coasting for a few seconds with exponential decay.
const COAST_MAX_MS = 6000;
const COAST_DECAY_PER_SEC = 0.72;
// Camera tick gate (ms). Prevents starving the JS thread.
const CAMERA_MIN_INTERVAL_MS = 70;
// Camera heading smoothing. Lower values = more stable, less twitch.
const CAMERA_HEADING_BLEND = 0.16;
// Maximum camera heading rotation speed (deg/sec) to avoid snap turns.
const CAMERA_MAX_TURN_RATE_DPS = 90;
// Limit React-state updates from the RAF loop; marker/camera motion stays
// smooth in refs while UI reconciliation is throttled.
const POSE_STATE_MIN_INTERVAL_MS = 55;
const FORWARD_EPS = 0;
const MOVEMENT_EPS2 = 1e-10;

function shortestAngle(prev: number, next: number): number {
  let d = ((next - prev + 540) % 360) - 180;
  return prev + d;
}

function inferMovementHeading(routePoints: RoutePoint[]): number | null {
  if (routePoints.length < 2) return null;
  const a = routePoints[routePoints.length - 2]!;
  const b = routePoints[routePoints.length - 1]!;
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const mag2 = dLat * dLat + dLng * dLng;
  if (mag2 <= MOVEMENT_EPS2) return null;
  const rad = Math.atan2(dLng, dLat);
  const deg = (rad * 180) / Math.PI;
  return (deg + 360) % 360;
}

function isPointBehindVehicle(
  vehicle: { lat: number; lng: number },
  headingDeg: number,
  point: { lat: number; lng: number },
) {
  const headingRad = (headingDeg * Math.PI) / 180;
  const hLat = Math.cos(headingRad);
  const hLng = Math.sin(headingRad);
  const dLat = point.lat - vehicle.lat;
  const dLng = point.lng - vehicle.lng;
  const forwardness = dLat * hLat + dLng * hLng;
  return forwardness < FORWARD_EPS;
}

/**
 * Native live map.
 *
 * Smoothing strategy:
 * 1. EMA-smoothed velocity from raw GPS samples.
 * 2. Target = lastRaw + smoothedVelocity * timeSinceLastRaw  (capped).
 * 3. Marker position is integrated with a critically-damped spring toward
 *    that target, on every frame (~60Hz).
 * 4. Heading is EMA'd on the unit circle so it doesn't snap on poll.
 * 5. Camera follows the smoothed marker every ~60ms.
 */
function LiveMapInner({
  routePoints,
  driverRoute,
  destination,
  destinationRoute,
  zones = [],
  checkpoints = [],
  selectedZoneId = null,
  onZoneSelect,
  followDriver = true,
  followZoom = 17,
  mapResetKey = 0,
  showGuidanceLine = false,
  onUserInteract,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const rafRef = useRef<number | null>(null);

  // Smoothed marker pose (what we render).
  const poseRef = useRef<{
    lat: number;
    lng: number;
    heading: number;
    vLat: number; // d(lat)/d(s)
    vLng: number; // d(lng)/d(s)
  } | null>(null);

  // Last raw GPS sample we received.
  const rawRef = useRef<{
    lat: number;
    lng: number;
    heading: number;
    ts: number;
  } | null>(null);

  // Smoothed velocity in lat/lng units per second.
  const velRef = useRef<{ vLat: number; vLng: number }>({
    vLat: 0,
    vLng: 0,
  });
  // Smoothed heading on the unit circle.
  const headingTrigRef = useRef<{ s: number; c: number }>({ s: 0, c: 1 });

  const lastFrameTsRef = useRef<number | null>(null);
  const lastCameraTsRef = useRef<number>(0);
  const cameraHeadingRef = useRef<number>(0);
  const lastPoseStateTsRef = useRef<number>(0);
  const hasSmoothedPoseRef = useRef(false);
  const routePointsRef = useRef(routePoints);
  routePointsRef.current = routePoints;

  const last = routePoints[routePoints.length - 1];
  const [smoothedLast, setSmoothedLast] = useState<RoutePoint | null>(
    last ?? null,
  );

  const initialRegion = useMemo<Region | undefined>(() => {
    if (!last) return undefined;
    return {
      latitude: last.lat,
      longitude: last.lng,
      latitudeDelta: NAV_ZOOM_DELTA,
      longitudeDelta: NAV_ZOOM_DELTA,
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Full reset of physics + camera (user refresh or parent recovery)
  useEffect(() => {
    if (mapResetKey < 1) return;
    const pts = routePointsRef.current;
    const pt = pts[pts.length - 1];
    poseRef.current = null;
    rawRef.current = null;
    velRef.current = { vLat: 0, vLng: 0 };
    headingTrigRef.current = { s: 0, c: 1 };
    lastFrameTsRef.current = null;
    lastCameraTsRef.current = 0;
    lastPoseStateTsRef.current = 0;
    hasSmoothedPoseRef.current = false;
    setSmoothedLast(null);
    if (!pt) return;
    const now = Date.now();
    const rawHeading =
      typeof pt.heading === "number" && !Number.isNaN(pt.heading) ? pt.heading : 0;
    const headingRad = (rawHeading * Math.PI) / 180;
    headingTrigRef.current = { s: Math.sin(headingRad), c: Math.cos(headingRad) };
    rawRef.current = { lat: pt.lat, lng: pt.lng, heading: rawHeading, ts: now };
    poseRef.current = {
      lat: pt.lat,
      lng: pt.lng,
      heading: rawHeading,
      vLat: 0,
      vLng: 0,
    };
    cameraHeadingRef.current = rawHeading;
    setSmoothedLast({ lat: pt.lat, lng: pt.lng, heading: rawHeading });
    if (followDriver) {
      mapRef.current?.setCamera({
        center: { latitude: pt.lat, longitude: pt.lng },
        heading: ((rawHeading % 360) + 360) % 360,
        pitch: 50,
        altitude: 250,
        zoom: 18,
      });
    }
  }, [mapResetKey, followDriver]);

  // ── On every new raw GPS point: update velocity + heading EMAs ────────────
  useEffect(() => {
    if (!last) {
      poseRef.current = null;
      rawRef.current = null;
      velRef.current = { vLat: 0, vLng: 0 };
      headingTrigRef.current = { s: 0, c: 1 };
      hasSmoothedPoseRef.current = false;
      setSmoothedLast(null);
      return;
    }

    const now = Date.now();
    const prev = rawRef.current;

    if (prev) {
      const dtSec = Math.max(0.05, (now - prev.ts) / 1000);
      const instantVLat = (last.lat - prev.lat) / dtSec;
      const instantVLng = (last.lng - prev.lng) / dtSec;
      velRef.current = {
        vLat:
          velRef.current.vLat * (1 - VELOCITY_EMA) +
          instantVLat * VELOCITY_EMA,
        vLng:
          velRef.current.vLng * (1 - VELOCITY_EMA) +
          instantVLng * VELOCITY_EMA,
      };
    }

    // Heading EMA on the unit circle (so 359° -> 1° doesn't sweep back).
    const rawHeading =
      typeof last.heading === "number" && !Number.isNaN(last.heading)
        ? last.heading
        : prev?.heading ?? 0;
    const headingRad = (rawHeading * Math.PI) / 180;
    const targetSin = Math.sin(headingRad);
    const targetCos = Math.cos(headingRad);
    headingTrigRef.current = {
      s:
        headingTrigRef.current.s * (1 - HEADING_EMA) + targetSin * HEADING_EMA,
      c:
        headingTrigRef.current.c * (1 - HEADING_EMA) + targetCos * HEADING_EMA,
    };

    rawRef.current = { lat: last.lat, lng: last.lng, heading: rawHeading, ts: now };

    if (!poseRef.current) {
      poseRef.current = {
        lat: last.lat,
        lng: last.lng,
        heading: rawHeading,
        vLat: 0,
        vLng: 0,
      };
      setSmoothedLast({ lat: last.lat, lng: last.lng, heading: rawHeading });
    }

  }, [last?.lat, last?.lng, last?.heading, last?.speedMps]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 60Hz physics loop ────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const lastTs = lastFrameTsRef.current ?? now;
      // Clamp to avoid huge jumps after backgrounding.
      const dtSec = Math.min(0.05, Math.max(1 / 240, (now - lastTs) / 1000));
      lastFrameTsRef.current = now;

      const pose = poseRef.current;
      const raw = rawRef.current;

      if (pose && raw) {
        // Project the GPS forward by the smoothed velocity, but clamp how far.
        const sinceRawSec = (now - raw.ts) / 1000;
        const projectedWindowSec = Math.min(MAX_PROJECT_MS / 1000, sinceRawSec);
        let projectedLat = raw.lat + velRef.current.vLat * projectedWindowSec;
        let projectedLng = raw.lng + velRef.current.vLng * projectedWindowSec;

        // After the normal prediction window, keep moving with decayed velocity
        // so missed packets don't look like a hard freeze.
        if (sinceRawSec > projectedWindowSec) {
          const extraSec = Math.min(
            COAST_MAX_MS / 1000,
            sinceRawSec - projectedWindowSec,
          );
          const decay = Math.pow(COAST_DECAY_PER_SEC, extraSec);
          const coastVLat = velRef.current.vLat * decay;
          const coastVLng = velRef.current.vLng * decay;
          projectedLat += coastVLat * extraSec;
          projectedLng += coastVLng * extraSec;
        }

        // Spring-damper integration toward the projected target.
        const aLat =
          SPRING_STIFFNESS * (projectedLat - pose.lat) -
          SPRING_DAMPING * pose.vLat;
        const aLng =
          SPRING_STIFFNESS * (projectedLng - pose.lng) -
          SPRING_DAMPING * pose.vLng;
        const newVLat = pose.vLat + aLat * dtSec;
        const newVLng = pose.vLng + aLng * dtSec;
        const newLat = pose.lat + newVLat * dtSec;
        const newLng = pose.lng + newVLng * dtSec;

        // Resolve smoothed heading from the unit-circle EMA, while keeping
        // continuity with previous heading (no >180° flips).
        const trig = headingTrigRef.current;
        const targetHeading =
          (Math.atan2(trig.s, trig.c) * 180) / Math.PI;
        const newHeading = shortestAngle(pose.heading, targetHeading);

        poseRef.current = {
          lat: newLat,
          lng: newLng,
          heading: newHeading,
          vLat: newVLat,
          vLng: newVLng,
        };
        if (
          now - lastPoseStateTsRef.current >= POSE_STATE_MIN_INTERVAL_MS ||
          !hasSmoothedPoseRef.current
        ) {
          lastPoseStateTsRef.current = now;
          hasSmoothedPoseRef.current = true;
          setSmoothedLast({
            lat: newLat,
            lng: newLng,
            heading: ((newHeading % 360) + 360) % 360,
          });
        }

        if (followDriver && now - lastCameraTsRef.current > CAMERA_MIN_INTERVAL_MS) {
          if (lastCameraTsRef.current === 0) {
            cameraHeadingRef.current = newHeading;
          }

          // Smooth map rotation separately from marker heading:
          // 1) Blend toward desired heading
          // 2) Clamp turn speed (deg/sec)
          const camCurrent = cameraHeadingRef.current;
          const camTarget = shortestAngle(camCurrent, newHeading);
          const camBlended = camCurrent + (camTarget - camCurrent) * CAMERA_HEADING_BLEND;
          const maxStep = CAMERA_MAX_TURN_RATE_DPS * dtSec;
          const camDelta = ((camBlended - camCurrent + 540) % 360) - 180;
          const camStep =
            Math.abs(camDelta) > maxStep
              ? Math.sign(camDelta) * maxStep
              : camDelta;
          const camHeading = camCurrent + camStep;
          cameraHeadingRef.current = camHeading;

          mapRef.current?.setCamera({
            center: { latitude: newLat, longitude: newLng },
            heading: ((camHeading % 360) + 360) % 360,
            pitch: 0,
            altitude: followZoom >= 18 ? 150 : 400,
            zoom: followZoom,
          });
          lastCameraTsRef.current = now;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameTsRef.current = null;
    };
  }, [followDriver, followZoom]);

  // Cap to last 40 points — avoids ever-growing polyline re-renders
  const historyCoords = useMemo(
    () =>
      routePoints
        .slice(-40)
        .map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [routePoints],
  );

  const movementHeading = useMemo(
    () => inferMovementHeading(routePoints),
    [routePoints],
  );
  const railHeading = movementHeading ?? smoothedLast?.heading ?? null;

  // The backend already trims the polyline to a 50 m segment ending at
  // the pin, so we just render `approachLine` directly. No client-side
  // forward/behind filtering needed.
  const railCoords = useMemo(
    () =>
      (driverRoute?.approachLine ?? []).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [driverRoute?.approachLine],
  );

  // The backend removes pins from the queue once the vehicle passes
  // them, so if we have a pin it is by definition still ahead. We keep
  // a small client-side guard against jittery heading vs. pin geometry
  // (rare cases where backend hasn't ticked yet).
  const passedRailEnd = useMemo(() => {
    if (!smoothedLast || !driverRoute?.pin || railHeading == null) return false;
    return isPointBehindVehicle(smoothedLast, railHeading, driverRoute.pin);
  }, [smoothedLast, driverRoute?.pin, railHeading]);
  const nextDistanceM = driverRoute?.pin?.distanceMeters ?? null;
  // Pin stays visible until vehicle passes it.
  const showPin = !!driverRoute?.pin;
  const showLine =
    showGuidanceLine &&
    nextDistanceM != null &&
    nextDistanceM < 50;

  const region: Region = {
    latitude: last?.lat ?? 44.0,
    longitude: last?.lng ?? 20.9,
    latitudeDelta: last ? NAV_ZOOM_DELTA : 0.5,
    longitudeDelta: last ? NAV_ZOOM_DELTA : 0.5,
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={initialRegion ?? region}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPanDrag={onUserInteract}
      >
        {historyCoords.length > 1 ? (
          <Polyline
            coordinates={historyCoords}
            strokeColor="rgba(16,185,129,0.7)"
            strokeWidth={3}
          />
        ) : null}

        {zones.map((z) => {
          const selected = selectedZoneId === z.id;
          return (
            <Polygon
              key={z.id}
              coordinates={z.polygon.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
              strokeColor={selected ? "#ffffff" : (z.color || "#60a5fa")}
              fillColor={selected ? "rgba(255,255,255,0.28)" : `${z.color || "#60a5fa"}44`}
              strokeWidth={selected ? 3 : 2}
              tappable={!!onZoneSelect}
              onPress={onZoneSelect ? () => onZoneSelect(selected ? null : z.id) : undefined}
            />
          );
        })}

        {checkpoints.map((cp) => (
          <Marker
            key={cp.id}
            coordinate={{ latitude: cp.lat, longitude: cp.lng }}
            pinColor="#f59e0b"
            title={cp.name}
          />
        ))}

        {/* Single blue rail — one pass is enough */}
        {showLine && !passedRailEnd && railCoords.length > 1 ? (
          <Polyline
            coordinates={railCoords}
            strokeColor="rgba(59,130,246,0.8)"
            strokeWidth={5}
          />
        ) : null}

        {showPin && !passedRailEnd && driverRoute?.pin ? (
          <Marker
            coordinate={{
              latitude: driverRoute.pin.lat,
              longitude: driverRoute.pin.lng,
            }}
            pinColor="#2563eb"
          />
        ) : null}

        {destinationRoute && destinationRoute.length > 1 ? (
          <>
            <Polyline
              coordinates={destinationRoute.map((p) => ({
                latitude: p.lat,
                longitude: p.lng,
              }))}
              strokeColor="rgba(0,0,0,0.28)"
              strokeWidth={9}
            />
            <Polyline
              coordinates={destinationRoute.map((p) => ({
                latitude: p.lat,
                longitude: p.lng,
              }))}
              strokeColor="rgba(239,68,68,0.94)"
              strokeWidth={6}
            />
          </>
        ) : null}

        {destination ? (
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            pinColor="#ef4444"
            title={destination.label ?? "Destination"}
          />
        ) : null}

        {smoothedLast && !followDriver ? (
          <Marker
            coordinate={{ latitude: smoothedLast.lat, longitude: smoothedLast.lng }}
            pinColor="#ef4444"
            zIndex={999}
          />
        ) : null}
      </MapView>

      {smoothedLast && followDriver ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              backgroundColor: "#ef4444",
              borderWidth: 2,
              borderColor: "rgba(255,255,255,0.9)",
            }}
          />
        </View>
      ) : null}
      {destinationRoute && destinationRoute.length > 1 ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 10,
            top: 10,
            zIndex: 10,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(252,165,165,0.75)",
            backgroundColor: "rgba(239,68,68,0.82)",
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
            Google suggested route
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export const LiveMap = memo(LiveMapInner, (prev, next) => {
  if (prev.showGuidanceLine !== next.showGuidanceLine) return false;
  if ((prev.zones?.length ?? 0) !== (next.zones?.length ?? 0)) return false;
  if ((prev.checkpoints?.length ?? 0) !== (next.checkpoints?.length ?? 0)) return false;
  if (prev.selectedZoneId !== next.selectedZoneId) return false;
  if (prev.mapResetKey !== next.mapResetKey) return false;
  const prevLast = prev.routePoints[prev.routePoints.length - 1];
  const nextLast = next.routePoints[next.routePoints.length - 1];

  if (
    prevLast?.lat !== nextLast?.lat ||
    prevLast?.lng !== nextLast?.lng ||
    prevLast?.heading !== nextLast?.heading
  )
    return false;

  if (prev.routePoints.length !== next.routePoints.length) return false;

  if (
    prev.driverRoute?.pin?.lat !== next.driverRoute?.pin?.lat ||
    prev.driverRoute?.pin?.lng !== next.driverRoute?.pin?.lng ||
    prev.driverRoute?.pin?.distanceMeters !== next.driverRoute?.pin?.distanceMeters ||
    prev.driverRoute?.approachLine?.length !==
      next.driverRoute?.approachLine?.length
  )
    return false;

  if (
    prev.destination?.lat !== next.destination?.lat ||
    prev.destination?.lng !== next.destination?.lng ||
    prev.destinationRoute?.length !== next.destinationRoute?.length
  )
    return false;

  return true;
});
