/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef } from "react";
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
  mapResetKey?: number;
};

const FORWARD_EPS = 0;
const MOVEMENT_EPS2 = 1e-10;

function directionalRailPolyline(
  polyline: Array<{ lat: number; lng: number }>,
  vehicle: RoutePoint | undefined,
  headingDeg: number | undefined,
) {
  if (polyline.length < 2 || !vehicle || headingDeg == null) return [];

  const headingRad = (headingDeg * Math.PI) / 180;
  const hLat = Math.cos(headingRad);
  const hLng = Math.sin(headingRad);

  let aheadIdx = -1;
  let aheadBestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < polyline.length; i += 1) {
    const p = polyline[i];
    const dLat = p.lat - vehicle.lat;
    const dLng = p.lng - vehicle.lng;
    const dist2 = dLat * dLat + dLng * dLng;
    const forwardness = dLat * hLat + dLng * hLng;

    if (forwardness >= FORWARD_EPS && dist2 < aheadBestDist) {
      aheadBestDist = dist2;
      aheadIdx = i;
    }
  }

  if (aheadIdx < 0) return [];
  const anchorIdx = aheadIdx;
  const next = anchorIdx + 1 < polyline.length ? polyline[anchorIdx + 1] : null;
  const prev = anchorIdx - 1 >= 0 ? polyline[anchorIdx - 1] : null;

  const scoreNext = next
    ? (next.lat - polyline[anchorIdx].lat) * hLat +
      (next.lng - polyline[anchorIdx].lng) * hLng
    : Number.NEGATIVE_INFINITY;
  const scorePrev = prev
    ? (prev.lat - polyline[anchorIdx].lat) * hLat +
      (prev.lng - polyline[anchorIdx].lng) * hLng
    : Number.NEGATIVE_INFINITY;

  const goForward = scoreNext >= scorePrev;
  const sliced = goForward
    ? polyline.slice(anchorIdx)
    : polyline.slice(0, anchorIdx + 1).reverse();

  // Hard rule: keep only points that are in front of the vehicle.
  const forwardOnly = sliced.filter((p, idx) => {
    if (idx === 0) return true;
    const dLat = p.lat - vehicle.lat;
    const dLng = p.lng - vehicle.lng;
    const forwardness = dLat * hLat + dLng * hLng;
    return forwardness >= FORWARD_EPS;
  });

  return forwardOnly.length > 1 ? forwardOnly : [];
}

function inferMovementHeading(routePoints: RoutePoint[]): number | undefined {
  if (routePoints.length < 2) return undefined;
  const a = routePoints[routePoints.length - 2]!;
  const b = routePoints[routePoints.length - 1]!;
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const mag2 = dLat * dLat + dLng * dLng;
  if (mag2 <= MOVEMENT_EPS2) return undefined;
  const rad = Math.atan2(dLng, dLat);
  const deg = (rad * 180) / Math.PI;
  return (deg + 360) % 360;
}

function isPointBehindVehicle(
  vehicle: RoutePoint,
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
 * Persistent Leaflet map — the map instance lives for the entire lifetime
 * of the component and layers are updated imperatively.
 *
 * Previously the map was destroyed + recreated on every GPS update
 * (routeKey/driverKey in the effect dep array), causing 1-3 s tile-reload
 * flashes. Now tiles stay in memory and only the polyline / marker move.
 */
export function LiveMap({ routePoints, driverRoute, mapResetKey = 0 }: Props) {
  // Keep Leaflet instance alive in refs
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const routePolyRef = useRef<any>(null);
  const driverPolyRef = useRef<any>(null);
  const turnCircleRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const routePointsRef = useRef(routePoints);
  routePointsRef.current = routePoints;

  // ── Inject Leaflet CSS once ────────────────────────────────────────────
  useEffect(() => {
    if (document.querySelector("[data-leaflet-css]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.setAttribute("data-leaflet-css", "1");
    document.head.appendChild(link);
  }, []);

  // ── Create map exactly ONCE when container mounts ─────────────────────
  // Deps array is intentionally empty — we never want to destroy+recreate
  // the map because that forces all tiles to be re-fetched.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || initializedRef.current) return;
    initializedRef.current = true;

    const L = require("leaflet");

    const last = routePoints[routePoints.length - 1];
    const center: [number, number] = last ? [last.lat, last.lng] : [44.0, 20.9];

    const map = L.map(container, {
      center,
      zoom: last ? 16 : 5,
      zoomControl: true,
      attributionControl: false,
      // Smooth panning / zooming
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    });

    // Tile layer with aggressive browser caching (OSM honours Cache-Control)
    tileLayerRef.current = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        keepBuffer: 8,        // keep 8 extra tile rows/cols in memory
        updateWhenIdle: false, // update tiles while panning (smoother)
        updateWhenZooming: false,
      },
    ).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      routePolyRef.current = null;
      driverPolyRef.current = null;
      turnCircleRef.current = null;
      markerRef.current = null;
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // <-- EMPTY — map is created once

  // ── Update route polyline + marker imperatively ────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const L = require("leaflet");
    const last = routePoints[routePoints.length - 1];

    // Route polyline — setLatLngs avoids a layer remove/re-add
    if (routePolyRef.current) {
      if (routePoints.length > 1) {
        routePolyRef.current.setLatLngs(
          routePoints.map((p: RoutePoint) => [p.lat, p.lng]),
        );
      } else {
        map.removeLayer(routePolyRef.current);
        routePolyRef.current = null;
      }
    } else if (routePoints.length > 1) {
      routePolyRef.current = L.polyline(
        routePoints.map((p: RoutePoint) => [p.lat, p.lng]),
        { color: "#10b981", weight: 5, opacity: 0.9 },
      ).addTo(map);
    }

    // Driver marker — basic centered red dot
    if (last) {
      const makeDotIcon = () =>
        L.divIcon({
          className: "",
          html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center">
            <div style="width:14px;height:14px;border-radius:9999px;background:#ef4444;border:2px solid rgba(255,255,255,0.9)">
            </div>
          </div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        });

      if (markerRef.current) {
        markerRef.current.setLatLng([last.lat, last.lng]);
        markerRef.current.setIcon(makeDotIcon());
      } else {
        markerRef.current = L.marker([last.lat, last.lng], {
          icon: makeDotIcon(),
          zIndexOffset: 1000,
        }).addTo(map);
      }
      // Smooth pan — tiles already loaded, only viewport shifts.
      // Short duration so it keeps up with 1 Hz GPS updates.
      map.panTo([last.lat, last.lng], { animate: true, duration: 0.45, easeLinearity: 0.4 });
    }
  }, [routePoints]);

  // User-triggered: snap map view to latest point (recovery when stuck)
  useEffect(() => {
    if (mapResetKey < 1) return;
    const map = mapRef.current;
    if (!map) return;
    const pts = routePointsRef.current;
    const last = pts[pts.length - 1];
    if (last) {
      map.panTo([last.lat, last.lng], { animate: true, duration: 0.35, easeLinearity: 0.4 });
    }
  }, [mapResetKey]);

  // ── Update driver-route overlay imperatively ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const L = require("leaflet");

    // Remove old driver overlay layers
    if (driverPolyRef.current) {
      map.removeLayer(driverPolyRef.current);
      driverPolyRef.current = null;
    }
    if (turnCircleRef.current) {
      map.removeLayer(turnCircleRef.current);
      turnCircleRef.current = null;
    }

    const lastVehicle = routePoints[routePoints.length - 1];
    const movementHeading = inferMovementHeading(routePoints);
    const railHeading = movementHeading ?? lastVehicle?.heading;
    const directionalRoute = directionalRailPolyline(
      driverRoute?.routePolyline ?? [],
      lastVehicle,
      railHeading,
    );
    const railEnd = driverRoute?.checkpoint ??
      (driverRoute?.routePolyline?.length
        ? driverRoute.routePolyline[driverRoute.routePolyline.length - 1]
        : null);
    const passedRailEnd =
      !!lastVehicle &&
      !!railEnd &&
      railHeading != null &&
      isPointBehindVehicle(lastVehicle, railHeading, railEnd);

    if (!passedRailEnd && directionalRoute.length > 1) {
      driverPolyRef.current = L.polyline(
        directionalRoute.map((p) => [p.lat, p.lng]),
        { color: "#3b82f6", weight: 8, opacity: 0.85 },
      ).addTo(map);
    }
    if (!passedRailEnd && driverRoute?.turnPoint) {
      turnCircleRef.current = L.circle(
        [driverRoute.turnPoint.lat, driverRoute.turnPoint.lng],
        {
          radius: 16,
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.25,
          weight: 2,
        },
      ).addTo(map);
    }
  }, [driverRoute, routePoints]);

  const hasPoints = routePoints.length > 0;

  return (
    <View style={{ flex: 1 }}>
      {!hasPoints ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#111827",
            zIndex: 1,
          }}
        >
          <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>
            Waiting for GPS…
          </Text>
        </View>
      ) : null}
      {React.createElement("div" as any, {
        ref: containerRef,
        style: { width: "100%", height: "100%", background: "#111827" },
      })}
    </View>
  );
}
