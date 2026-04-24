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
};

/**
 * Persistent Leaflet map — the map instance lives for the entire lifetime
 * of the component and layers are updated imperatively.
 *
 * Previously the map was destroyed + recreated on every GPS update
 * (routeKey/driverKey in the effect dep array), causing 1-3 s tile-reload
 * flashes. Now tiles stay in memory and only the polyline / marker move.
 */
export function LiveMap({ routePoints, driverRoute }: Props) {
  // Keep Leaflet instance alive in refs
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const routePolyRef = useRef<any>(null);
  const driverPolyRef = useRef<any>(null);
  const turnCircleRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const initializedRef = useRef(false);

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

    // Driver car icon — move + re-icon existing marker, don't recreate it
    if (last) {
      const makeDotIcon = () =>
        L.divIcon({
          className: "",
          html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center">
            <div style="width:36px;height:36px;border-radius:9999px;background:rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;font-size:24px;line-height:1">🚗</div>
          </div>`,
          iconSize: [44, 44],
          // Visual calibration: Leaflet marker div appears ~1 px right.
          iconAnchor: [21, 22],
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

    if (driverRoute?.routePolyline && driverRoute.routePolyline.length > 1) {
      driverPolyRef.current = L.polyline(
        driverRoute.routePolyline.map((p) => [p.lat, p.lng]),
        { color: "#3b82f6", weight: 8, opacity: 0.85 },
      ).addTo(map);
    }
    if (driverRoute?.turnPoint) {
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
  }, [driverRoute]);

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
