/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import type { RoutePoint } from "@/types/live";

/**
 * Mirrors the new API shape: a single visible pin (`pin`) and a
 * pre-trimmed 50 m approach polyline (`approachLine`). The backend
 * removes the pin from the response once the vehicle passes it.
 */
type DriverRouteOverlay = {
  pin: { lat: number; lng: number; distanceMeters?: number } | null;
  approachLine: Array<{ lat: number; lng: number }>;
};

type Props = {
  routePoints: RoutePoint[];
  driverRoute?: DriverRouteOverlay | null;
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
  selectedZoneId?: string | null;
  onZoneSelect?: (id: string | null) => void;
  followDriver?: boolean;
  followZoom?: number;
  mapResetKey?: number;
  showGuidanceLine?: boolean;
  onUserInteract?: () => void;
};

const FORWARD_EPS = 0;
const MOVEMENT_EPS2 = 1e-10;

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
export function LiveMap({
  routePoints,
  driverRoute,
  zones = [],
  checkpoints = [],
  selectedZoneId = null,
  onZoneSelect,
  followDriver = true,
  followZoom = 16,
  mapResetKey = 0,
  showGuidanceLine = false,
  onUserInteract,
}: Props) {
  // Keep Leaflet instance alive in refs
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const routePolyRef = useRef<any>(null);
  const driverPolyRef = useRef<any>(null);
  const turnCircleRef = useRef<any>(null);
  const zonesLayerRef = useRef<any>(null);
  const checkpointsLayerRef = useRef<any>(null);
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
      zoom: last ? followZoom : 5,
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
    map.on("dragstart", () => {
      onUserInteract?.();
    });

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      routePolyRef.current = null;
      driverPolyRef.current = null;
      turnCircleRef.current = null;
      zonesLayerRef.current = null;
      checkpointsLayerRef.current = null;
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
      // Camera smoothing: step part-way toward the target each GPS tick.
      // This avoids the "restart pan animation every packet" jitter.
      const center = map.getCenter();
      const blend = 0.24;
      const nextLat = center.lat + (last.lat - center.lat) * blend;
      const nextLng = center.lng + (last.lng - center.lng) * blend;
      if (followDriver) {
        map.setView([nextLat, nextLng], map.getZoom(), { animate: false });
      }
    }
  }, [routePoints, followDriver]);

  // User-triggered: snap map view to latest point (recovery when stuck)
  useEffect(() => {
    if (mapResetKey < 1) return;
    const map = mapRef.current;
    if (!map) return;
    const pts = routePointsRef.current;
    const last = pts[pts.length - 1];
    if (last) {
      map.setView([last.lat, last.lng], followZoom, {
        animate: true,
        duration: 0.35,
      });
    }
  }, [mapResetKey, followZoom]);

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

    // Backend already trimmed `approachLine` to the 50 m segment ending
    // at the pin and dropped it once the vehicle passed the pin, so we
    // render it as-is. The behind-vehicle check is a small client-side
    // safeguard against jittery heading.
    const approach = driverRoute?.approachLine ?? [];
    const nextDistanceM = driverRoute?.pin?.distanceMeters ?? null;
    // Pin stays visible until vehicle passes it.
    const showPin = !!driverRoute?.pin;
    const showLine =
      showGuidanceLine &&
      nextDistanceM != null &&
      nextDistanceM < 50;
    const passedRailEnd =
      !!lastVehicle &&
      !!driverRoute?.pin &&
      railHeading != null &&
      isPointBehindVehicle(lastVehicle, railHeading, driverRoute.pin);

    if (showLine && !passedRailEnd && approach.length > 1) {
      driverPolyRef.current = L.polyline(
        approach.map((p) => [p.lat, p.lng]),
        { color: "#3b82f6", weight: 8, opacity: 0.85 },
      ).addTo(map);
    }
    if (showPin && !passedRailEnd && driverRoute?.pin) {
      turnCircleRef.current = L.circle(
        [driverRoute.pin.lat, driverRoute.pin.lng],
        {
          radius: 16,
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.25,
          weight: 2,
        },
      ).addTo(map);
    }
  }, [driverRoute, routePoints, showGuidanceLine]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const L = require("leaflet");

    if (!zonesLayerRef.current) zonesLayerRef.current = L.layerGroup().addTo(map);
    if (!checkpointsLayerRef.current) checkpointsLayerRef.current = L.layerGroup().addTo(map);
    zonesLayerRef.current.clearLayers();
    checkpointsLayerRef.current.clearLayers();

    zones.forEach((z) => {
      const pts = z.polygon.map((p: { lat: number; lng: number }) => [p.lat, p.lng]);
      if (pts.length < 3) return;
      const selected = selectedZoneId === z.id;
      const poly = L.polygon(pts, {
        color: selected ? "#ffffff" : (z.color || "#60a5fa"),
        weight: selected ? 3 : 2,
        fillColor: z.color || "#60a5fa",
        fillOpacity: selected ? 0.35 : 0.2,
      });
      if (onZoneSelect) {
        poly.on("click", () => onZoneSelect(selected ? null : z.id));
        poly.getElement?.()?.style && (poly.getElement().style.cursor = "pointer");
      }
      poly.addTo(zonesLayerRef.current);
      if (/^[A-Z][A-Z]*\d+$/.test(z.name) && zones.length <= 140) {
        poly.bindTooltip(z.name, {
          permanent: true,
          direction: "center",
          className: "camtok-mobile-grid-lbl",
        });
      }
    });

    checkpoints.forEach((cp) => {
      L.circleMarker([cp.lat, cp.lng], {
        radius: 5,
        color: "#ffffff",
        weight: 1,
        fillColor: "#f59e0b",
        fillOpacity: 0.95,
      })
        .bindTooltip(cp.name, { direction: "top", opacity: 0.9 })
        .addTo(checkpointsLayerRef.current);
    });
  }, [zones, checkpoints, selectedZoneId, onZoneSelect]);

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
