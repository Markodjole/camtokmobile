import { apiFetch } from "@/lib/api";

export type OsrmProfile = "driving" | "cycling" | "walking";

function profileForMode(transportMode?: string | null): OsrmProfile {
  const m = (transportMode ?? "drive").toLowerCase();
  if (m === "walking" || m === "walk") return "walking";
  if (m === "bike" || m === "bicycle" || m === "cycle" || m === "scooter") {
    return "cycling";
  }
  return "driving";
}

/**
 * Free road polyline via public OSRM (no Google Routes cost).
 */
export async function fetchOsrmSuggestedRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  opts: { transportMode?: string | null; signal?: AbortSignal } = {},
): Promise<{
  polyline: Array<{ lat: number; lng: number }>;
  distanceMeters: number;
  durationSec: number;
} | null> {
  const profile = profileForMode(opts.transportMode);
  const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;

  try {
    const res = await fetch(url, {
      signal: opts.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn("[osrm] http", res.status);
      }
      return null;
    }
    const json = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { type: "LineString"; coordinates: Array<[number, number]> };
      }>;
    };
    if (json.code !== "Ok" || !json.routes?.length) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn("[osrm] code", json.code);
      }
      return null;
    }
    const route = json.routes[0]!;
    return {
      polyline: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distanceMeters: route.distance,
      durationSec: route.duration,
    };
  } catch (e) {
    if (__DEV__ && (e as { name?: string })?.name !== "AbortError") {
      // eslint-disable-next-line no-console
      console.warn("[osrm] error", e);
    }
    return null;
  }
}

/** Prefer backend destination-route; fill with OSRM when Google is off. */
export async function resolveDestinationRoute(
  roomId: string,
  opts: {
    signal?: AbortSignal;
    transportMode?: string | null;
    driver?: { lat: number; lng: number } | null;
    destinationFallback?: { lat: number; lng: number } | null;
  } = {},
) {
  type ApiShape = {
    destination: {
      lat: number;
      lng: number;
      label: string;
      placeId: string | null;
    } | null;
    route: {
      polyline: Array<{ lat: number; lng: number }>;
      distanceMeters: number;
      durationSec: number;
      source?: "google" | "osrm";
    } | null;
    distanceToDestinationMeters?: number;
    source?: "google" | "osrm" | null;
    reason?: string;
  };

  let res: ApiShape;
  try {
    res = await apiFetch<ApiShape>(
      `/api/live/rooms/${roomId}/destination-route`,
      { signal: opts.signal, anonymous: true },
    );
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    res = {
      destination: opts.destinationFallback
        ? {
            lat: opts.destinationFallback.lat,
            lng: opts.destinationFallback.lng,
            label: "Destination",
            placeId: null,
          }
        : null,
      route: null,
      reason: "api_error",
    };
  }

  if (res.route?.polyline && res.route.polyline.length > 1) {
    return res;
  }

  const dest = res.destination ?? (
    opts.destinationFallback
      ? {
          lat: opts.destinationFallback.lat,
          lng: opts.destinationFallback.lng,
          label: "Destination",
          placeId: null,
        }
      : null
  );
  const driver = opts.driver;
  if (!dest || !driver) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log("[destination-route] skip osrm", {
        hasDest: !!dest,
        hasDriver: !!driver,
        reason: res.reason,
      });
    }
    return { ...res, destination: dest };
  }

  const osrm = await fetchOsrmSuggestedRoute(driver, dest, {
    transportMode: opts.transportMode,
    signal: opts.signal,
  });
  if (osrm && osrm.polyline.length >= 2) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log("[destination-route] osrm ok", osrm.polyline.length, "pts");
    }
    return {
      ...res,
      destination: dest,
      route: { ...osrm, source: "osrm" as const },
      source: "osrm" as const,
      reason: "osrm_client",
    };
  }

  // Always show something when we have both ends (OSRM can be blocked/offline).
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn("[destination-route] osrm failed; using straight line");
  }
  return {
    ...res,
    destination: dest,
    route: {
      polyline: [
        { lat: driver.lat, lng: driver.lng },
        { lat: dest.lat, lng: dest.lng },
      ],
      distanceMeters: 0,
      durationSec: 0,
      source: "osrm" as const,
    },
    source: "osrm" as const,
    reason: "straight_fallback",
  };
}
