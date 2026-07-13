import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import MapView, {
  Marker,
  Polygon,
  Polyline,
  PROVIDER_GOOGLE,
  type Region,
} from "react-native-maps";
import { Platform, Text, View } from "react-native";
import { NativeViewGestureHandler } from "react-native-gesture-handler";
import type { RoutePoint } from "@/types/live";
import { metersBetween } from "@/lib/geo";

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
  /** Green path ahead of vehicle once bets lock (driver mode). */
  committedRouteAhead?: Array<{ lat: number; lng: number }> | null;
  /**
   * Blue path to the next CamTok instruction (turn pin). Updates as
   * /driver-route polls change — shown as soon as an instruction exists.
   */
  instructionRouteAhead?: Array<{ lat: number; lng: number }> | null;
  /** Labels from driver routing persona (viewers see these on the map). */
  driverRouteBadges?: string[] | null;
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

const NAV_ZOOM_DELTA = 0.008;
const FALLBACK_REGION: Region = {
  latitude: 44.8176,
  longitude: 20.4633,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

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
const TURN_PRECISE_PRE_M = 50;
const TURN_PRECISE_POST_M = 20;
const BASE_MAX_PROJECT_MS = 1200;
const BASE_COAST_MAX_MS = 4500;
const PRECISE_MAX_PROJECT_MS = 220;
const PRECISE_COAST_MAX_MS = 500;
const SPRING_STIFFNESS_BASE = 13;
const SPRING_STIFFNESS_PRECISE = 34;

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
  committedRouteAhead = null,
  instructionRouteAhead = null,
  driverRouteBadges = null,
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
  /** Apply followZoom once when follow starts; omit later so pinch-zoom sticks. */
  const forceFollowZoomRef = useRef(true);
  /** Frame street-level camera once when the first GPS fix arrives. */
  const hasFramedRef = useRef(false);
  const routePointsRef = useRef(routePoints);
  routePointsRef.current = routePoints;
  const driverRouteRef = useRef(driverRoute ?? null);
  driverRouteRef.current = driverRoute ?? null;
  const turnPinRef = useRef<{ lat: number; lng: number } | null>(null);
  const followDriverRef = useRef(followDriver);
  followDriverRef.current = followDriver;
  const followZoomRef = useRef(followZoom);
  followZoomRef.current = followZoom;

  const last = routePoints[routePoints.length - 1];
  const [smoothedLast, setSmoothedLast] = useState<RoutePoint | null>(
    last ?? null,
  );

  function frameCamera(
    lat: number,
    lng: number,
    opts?: { heading?: number; zoom?: number; animated?: boolean },
  ) {
    const zoom = opts?.zoom ?? followZoomRef.current;
    const heading =
      typeof opts?.heading === "number" && !Number.isNaN(opts.heading)
        ? ((opts.heading % 360) + 360) % 360
        : 0;
    const camera = {
      center: { latitude: lat, longitude: lng },
      heading,
      pitch: 0,
      zoom,
    };
    if (opts?.animated === false) {
      mapRef.current?.setCamera(camera);
    } else {
      mapRef.current?.animateCamera(camera, { duration: 450 });
    }
  }

  // Seed a usable street-level view once we have a fix (follow off by default).
  useEffect(() => {
    if (!last || hasFramedRef.current) return;
    hasFramedRef.current = true;
    frameCamera(last.lat, last.lng, {
      heading: last.heading,
      zoom: followZoom,
      animated: true,
    });
  }, [last?.lat, last?.lng, last?.heading, followZoom]);

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
    turnPinRef.current = null;
    hasFramedRef.current = false;
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
    hasFramedRef.current = true;
    forceFollowZoomRef.current = true;
    frameCamera(pt.lat, pt.lng, {
      heading: rawHeading,
      zoom: followZoom,
      animated: false,
    });
  }, [mapResetKey, followZoom]);

  // When follow is re-enabled (recenter button), snap zoom back in once.
  useEffect(() => {
    if (!followDriver) return;
    forceFollowZoomRef.current = true;
    if (!last) return;
    frameCamera(last.lat, last.lng, {
      heading: last.heading,
      zoom: followZoom,
      animated: true,
    });
    forceFollowZoomRef.current = false;
  }, [followDriver]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const pin = driverRouteRef.current?.pin ?? null;
        const viewerMode = !showGuidanceLine;
        if (pin && pin.distanceMeters != null && pin.distanceMeters <= TURN_PRECISE_PRE_M) {
          turnPinRef.current = { lat: pin.lat, lng: pin.lng };
        }
        let viewerPreciseTurnWindow = false;
        if (viewerMode) {
          if (pin && pin.distanceMeters != null && pin.distanceMeters <= TURN_PRECISE_PRE_M) {
            viewerPreciseTurnWindow = true;
          } else if (turnPinRef.current) {
            const postTurnDist = metersBetween(
              { lat: pose.lat, lng: pose.lng },
              turnPinRef.current,
            );
            if (postTurnDist <= TURN_PRECISE_POST_M) {
              viewerPreciseTurnWindow = true;
            } else {
              turnPinRef.current = null;
            }
          }
        }

        const springStiffness = viewerPreciseTurnWindow
          ? SPRING_STIFFNESS_PRECISE
          : SPRING_STIFFNESS_BASE;
        const springDamping = 2 * Math.sqrt(springStiffness);
        const projectMs = viewerPreciseTurnWindow
          ? PRECISE_MAX_PROJECT_MS
          : BASE_MAX_PROJECT_MS;
        const coastMs = viewerPreciseTurnWindow
          ? PRECISE_COAST_MAX_MS
          : BASE_COAST_MAX_MS;

        // Project the GPS forward by the smoothed velocity, but clamp how far.
        const sinceRawSec = (now - raw.ts) / 1000;
        const projectedWindowSec = Math.min(projectMs / 1000, sinceRawSec);
        let projectedLat = raw.lat + velRef.current.vLat * projectedWindowSec;
        let projectedLng = raw.lng + velRef.current.vLng * projectedWindowSec;

        // After the normal prediction window, keep moving with decayed velocity
        // so missed packets don't look like a hard freeze.
        if (sinceRawSec > projectedWindowSec) {
          const extraSec = Math.min(
            coastMs / 1000,
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
          springStiffness * (projectedLat - pose.lat) -
          springDamping * pose.vLat;
        const aLng =
          springStiffness * (projectedLng - pose.lng) -
          springDamping * pose.vLng;
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

        if (
          followDriver &&
          now - lastCameraTsRef.current > CAMERA_MIN_INTERVAL_MS
        ) {
          if (lastCameraTsRef.current === 0) {
            cameraHeadingRef.current = newHeading;
          }

          // Smooth map rotation separately from marker heading:
          // 1) Blend toward desired heading
          // 2) Clamp turn speed (deg/sec)
          // Viewers (`showGuidanceLine` false) need faster alignment for betting UX.
          const viewerBettingFollow = !showGuidanceLine;
          const headingBlend = viewerBettingFollow
            ? viewerPreciseTurnWindow
              ? 0.72
              : 0.52
            : CAMERA_HEADING_BLEND;
          const maxTurnDps = viewerBettingFollow
            ? viewerPreciseTurnWindow
              ? 420
              : 280
            : CAMERA_MAX_TURN_RATE_DPS;
          const camCurrent = cameraHeadingRef.current;
          const camTarget = shortestAngle(camCurrent, newHeading);
          const camBlended = camCurrent + (camTarget - camCurrent) * headingBlend;
          const maxStep = maxTurnDps * dtSec;
          const camDelta = ((camBlended - camCurrent + 540) % 360) - 180;
          const camStep =
            Math.abs(camDelta) > maxStep
              ? Math.sign(camDelta) * maxStep
              : camDelta;
          const camHeading = camCurrent + camStep;
          cameraHeadingRef.current = camHeading;

          const shouldForceZoom = forceFollowZoomRef.current;
          mapRef.current?.setCamera({
            center: { latitude: newLat, longitude: newLng },
            heading: ((camHeading % 360) + 360) % 360,
            pitch: 0,
            ...(shouldForceZoom ? { zoom: followZoomRef.current } : {}),
          });
          if (shouldForceZoom) forceFollowZoomRef.current = false;
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
  }, [followDriver, followZoom, showGuidanceLine]);

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
  // Near-pin approach rail (backend ~50 m segment) — still useful when close.
  const showNearApproach =
    showGuidanceLine &&
    !committedRouteAhead &&
    !instructionRouteAhead &&
    nextDistanceM != null &&
    nextDistanceM < 50;

  const committedCoords = useMemo(
    () =>
      (committedRouteAhead ?? []).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [committedRouteAhead],
  );

  const instructionCoords = useMemo(
    () =>
      (instructionRouteAhead ?? []).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [instructionRouteAhead],
  );

  const destinationCoords = useMemo(
    () =>
      (destinationRoute ?? []).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [destinationRoute],
  );

  const region: Region = last
    ? {
        latitude: last.lat,
        longitude: last.lng,
        latitudeDelta: NAV_ZOOM_DELTA,
        longitudeDelta: NAV_ZOOM_DELTA,
      }
    : FALLBACK_REGION;

  const mapView = (
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={region}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        scrollEnabled
        zoomEnabled
        zoomControlEnabled={Platform.OS === "android"}
        rotateEnabled={false}
        pitchEnabled={false}
        cacheEnabled={false}
        onPanDrag={onUserInteract}
        onMapReady={() => {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log("[LiveMap] Google MapView ready (native SDK tiles)");
          }
          if (last && !hasFramedRef.current) {
            hasFramedRef.current = true;
            frameCamera(last.lat, last.lng, {
              heading: last.heading,
              zoom: followZoom,
              animated: false,
            });
          }
        }}
      >
        {historyCoords.length > 1 ? (
          <Polyline
            coordinates={historyCoords}
            strokeColor="#10B981"
            strokeWidth={3}
            zIndex={2}
            lineCap="round"
            lineJoin="round"
            lineDashPattern={[0]}
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
        {showNearApproach && !passedRailEnd && railCoords.length > 1 ? (
          <Polyline
            coordinates={railCoords}
            strokeColor="#3B82F6"
            strokeWidth={5}
            zIndex={3}
            lineCap="round"
            lineJoin="round"
            lineDashPattern={[0]}
          />
        ) : null}

        {instructionCoords.length > 1 && committedCoords.length < 2 ? (
          <>
            <Polyline
              coordinates={instructionCoords}
              strokeColor="#1E3A8A"
              strokeWidth={10}
              zIndex={5}
              geodesic
              lineCap="round"
              lineJoin="round"
              lineDashPattern={[0]}
            />
            <Polyline
              coordinates={instructionCoords}
              strokeColor="#3B82F6"
              strokeWidth={6}
              zIndex={6}
              geodesic
              lineCap="round"
              lineJoin="round"
              lineDashPattern={[0]}
            />
          </>
        ) : null}

        {committedCoords.length > 1 ? (
          <>
            <Polyline
              coordinates={committedCoords}
              strokeColor="#000000"
              strokeWidth={11}
              zIndex={4}
              lineCap="round"
              lineJoin="round"
              lineDashPattern={[0]}
            />
            <Polyline
              coordinates={committedCoords}
              strokeColor="#22C55E"
              strokeWidth={7}
              zIndex={5}
              lineCap="round"
              lineJoin="round"
              lineDashPattern={[0]}
            />
          </>
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

        {destinationCoords.length > 1 ? (
          <>
            <Polyline
              coordinates={destinationCoords}
              strokeColor="#7F1D1D"
              strokeWidth={10}
              zIndex={6}
              geodesic
              lineCap="round"
              lineJoin="round"
              lineDashPattern={[0]}
            />
            <Polyline
              coordinates={destinationCoords}
              strokeColor="#EF4444"
              strokeWidth={6}
              zIndex={7}
              geodesic
              lineCap="round"
              lineJoin="round"
              lineDashPattern={[0]}
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
  );

  return (
    <View style={{ flex: 1 }}>
      {/*
        GestureHandlerRootView steals pan/pinch from Google MapView on Android
        unless MapView sits inside a NativeViewGestureHandler.
      */}
      <NativeViewGestureHandler disallowInterruption>
        <View style={{ flex: 1 }} collapsable={false}>
          {mapView}
        </View>
      </NativeViewGestureHandler>

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
      {(driverRouteBadges ?? []).length > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            top: 8,
            zIndex: 11,
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 4,
          }}
        >
          {(driverRouteBadges ?? []).map((label) => (
            <View
              key={label}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "rgba(125,211,252,0.55)",
                backgroundColor: "rgba(12,74,110,0.9)",
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Text style={{ color: "#e0f2fe", fontSize: 9, fontWeight: "700" }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const LiveMap = memo(LiveMapInner, (prev, next) => {
  if (prev.showGuidanceLine !== next.showGuidanceLine) return false;
  if (
    (prev.driverRouteBadges ?? []).join("\u0001") !==
    (next.driverRouteBadges ?? []).join("\u0001")
  )
    return false;
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
    prev.destinationRoute?.length !== next.destinationRoute?.length ||
    prev.committedRouteAhead?.length !== next.committedRouteAhead?.length ||
    prev.instructionRouteAhead?.length !== next.instructionRouteAhead?.length
  )
    return false;

  const prevInstr = prev.instructionRouteAhead;
  const nextInstr = next.instructionRouteAhead;
  if (prevInstr && nextInstr && prevInstr.length > 0 && nextInstr.length > 0) {
    const pa = prevInstr[0]!;
    const pb = prevInstr[prevInstr.length - 1]!;
    const na = nextInstr[0]!;
    const nb = nextInstr[nextInstr.length - 1]!;
    if (
      pa.lat !== na.lat ||
      pa.lng !== na.lng ||
      pb.lat !== nb.lat ||
      pb.lng !== nb.lng
    ) {
      return false;
    }
  }

  return true;
});
