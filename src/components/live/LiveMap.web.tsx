/* eslint-disable @typescript-eslint/no-require-imports */
import React, { useEffect, useMemo } from "react";
import { View, Text } from "react-native";
import type { RoutePoint } from "@/types/live";
// Leaflet is web-only. We require it at runtime so the native bundler
// never tries to resolve it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;

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

/**
 * Web implementation of LiveMap using Leaflet / OpenStreetMap tiles.
 * `react-native-maps` is native-only; this gives the web build the same
 * interactive map experience.
 */
export function LiveMap({ routePoints, driverRoute }: Props) {
  const last = routePoints[routePoints.length - 1];

  // Inject Leaflet CSS once
  useEffect(() => {
    if (document.querySelector("[data-leaflet-css]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.setAttribute("data-leaflet-css", "1");
    document.head.appendChild(link);
  }, []);

  const mapId = useMemo(
    () => `leaflet-map-${Math.random().toString(36).slice(2)}`,
    [],
  );

  // Serialise deps so we can safely stringify in the dep array
  const routeKey = JSON.stringify(routePoints);
  const routeRef = React.useRef(routePoints);
  routeRef.current = routePoints;
  const driverKey = JSON.stringify(driverRoute ?? null);
  const driverRef = React.useRef(driverRoute);
  driverRef.current = driverRoute;

  useEffect(() => {
    // Require leaflet via CommonJS at runtime (web only)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const L: L = require("leaflet");

    const container = document.getElementById(mapId);
    if (!container) return;

    const pts = routeRef.current;
    const dr = driverRef.current;
    const lastPt = pts[pts.length - 1];
    const center: [number, number] = lastPt
      ? [lastPt.lat, lastPt.lng]
      : [44.0, 20.9];

    const map = L.map(container, {
      center,
      zoom: lastPt ? 16 : 5,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    if (pts.length > 1) {
      L.polyline(
        pts.map((p: RoutePoint) => [p.lat, p.lng]),
        { color: "#10b981", weight: 5, opacity: 0.9 },
      ).addTo(map);
    }

    if (dr?.routePolyline && dr.routePolyline.length > 1) {
      L.polyline(
        dr.routePolyline.map((p) => [p.lat, p.lng]),
        { color: "#3b82f6", weight: 7, opacity: 0.55 },
      ).addTo(map);
    }

    if (dr?.turnPoint) {
      L.circle([dr.turnPoint.lat, dr.turnPoint.lng], {
        radius: 16,
        color: "#2563eb",
        fillColor: "#3b82f6",
        fillOpacity: 0.25,
        weight: 2,
      }).addTo(map);
    }

    if (lastPt) {
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:16px;height:16px;border-radius:50%;background:#ef4444;border:2.5px solid white;box-shadow:0 0 6px rgba(0,0,0,.6)"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      L.marker([lastPt.lat, lastPt.lng], { icon }).addTo(map);
      map.setView([lastPt.lat, lastPt.lng], 16, { animate: true });
    }

    return () => {
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, routeKey, driverKey]);

  if (!last) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#1a1a1a" }}
      >
        <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
          Waiting for GPS…
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* plain <div> is valid inside Expo Web's React DOM render tree */}
      <div id={mapId} style={{ width: "100%", height: "100%", background: "#1a1a1a" }} />
    </View>
  );
}
