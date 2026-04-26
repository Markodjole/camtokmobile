import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from "react-native-maps";
import { Text, View } from "react-native";
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
  /** Increment to clear smoothing/camera state and re-seed from the latest point (recovery when stuck). */
  mapResetKey?: number;
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

// Spring stiffness (1/s²). Higher = catches up faster.
const SPRING_STIFFNESS = 14;
// Critical damping coefficient (1/s).
const SPRING_DAMPING = 2 * Math.sqrt(SPRING_STIFFNESS);
// Velocity EMA factor (per GPS sample). Smooths jitter in instantaneous speed.
const VELOCITY_EMA = 0.3;
// Heading EMA (per GPS sample, applied via sin/cos for circular continuity).
const HEADING_EMA = 0.35;
// Cap how far ahead we project (ms). Prevents rocketing forward if GPS pauses.
const MAX_PROJECT_MS = 1500;
// If packets are late, keep coasting for a few seconds with exponential decay.
const COAST_MAX_MS = 6000;
const COAST_DECAY_PER_SEC = 0.72;
// Camera tick gate (ms). Prevents starving the JS thread.
const CAMERA_MIN_INTERVAL_MS = 60;
// Camera heading smoothing. Lower values = more stable, less twitch.
const CAMERA_HEADING_BLEND = 0.16;
// Maximum camera heading rotation speed (deg/sec) to avoid snap turns.
const CAMERA_MAX_TURN_RATE_DPS = 120;

function shortestAngle(prev: number, next: number): number {
  let d = ((next - prev + 540) % 360) - 180;
  return prev + d;
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
  followDriver = true,
  mapResetKey = 0,
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
        setSmoothedLast({
          lat: newLat,
          lng: newLng,
          heading: ((newHeading % 360) + 360) % 360,
        });

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
            pitch: 50,
            altitude: 250,
            zoom: 18,
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
  }, [followDriver]);

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
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={initialRegion ?? region}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
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
          <Text style={{ fontSize: 30 }}>🚗</Text>
        </View>
      ) : null}
    </View>
  );
}

export const LiveMap = memo(LiveMapInner, (prev, next) => {
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
    prev.driverRoute?.turnPoint?.lat !== next.driverRoute?.turnPoint?.lat ||
    prev.driverRoute?.routePolyline?.length !==
      next.driverRoute?.routePolyline?.length
  )
    return false;

  return true;
});
