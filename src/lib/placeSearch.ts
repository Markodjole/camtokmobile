import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "./api";

export type PlaceSuggestion = {
  placeId: string;
  primary: string;
  secondary: string | null;
  /** Present for free geocoder hits — avoids a Google Details call on pick. */
  lat?: number;
  lng?: number;
  label?: string;
  source: "nominatim" | "google";
};

/** Bumped to reset budgets burned by failed Nominatim→Google attempts. */
const GOOGLE_USAGE_KEY = "camtok:google_places_usage_v2";
const GOOGLE_DAILY_CAP = 25;
const GOOGLE_SESSION_CAP = 8;

const sessionCache = new Map<string, PlaceSuggestion[]>();
let sessionGoogleCalls = 0;

type GoogleUsage = { date: string; count: number };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function googleBudgetLeft(): Promise<number> {
  if (sessionGoogleCalls >= GOOGLE_SESSION_CAP) return 0;
  try {
    const raw = await AsyncStorage.getItem(GOOGLE_USAGE_KEY);
    const usage = raw ? (JSON.parse(raw) as GoogleUsage) : null;
    if (!usage || usage.date !== todayKey()) return GOOGLE_DAILY_CAP - sessionGoogleCalls;
    return Math.max(0, GOOGLE_DAILY_CAP - usage.count - sessionGoogleCalls);
  } catch {
    return GOOGLE_DAILY_CAP - sessionGoogleCalls;
  }
}

async function recordGoogleCall(): Promise<void> {
  sessionGoogleCalls += 1;
  try {
    const raw = await AsyncStorage.getItem(GOOGLE_USAGE_KEY);
    const today = todayKey();
    const usage = raw ? (JSON.parse(raw) as GoogleUsage) : null;
    const count = usage?.date === today ? usage.count + 1 : 1;
    await AsyncStorage.setItem(GOOGLE_USAGE_KEY, JSON.stringify({ date: today, count }));
  } catch {
    // best-effort
  }
}

function cacheKey(q: string, lat?: number, lng?: number): string {
  const bias =
    lat != null && lng != null
      ? `${lat.toFixed(3)},${lng.toFixed(3)}`
      : "none";
  return `${q.toLowerCase()}|${bias}`;
}

/**
 * Photon (Komoot) — OSM-based, free, and does not block React Native's
 * okhttp User-Agent (unlike nominatim.openstreetmap.org which returns 403).
 */
async function searchPhoton(
  query: string,
  bias: { lat: number; lng: number } | null,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  if (bias) {
    url.searchParams.set("lat", String(bias.lat));
    url.searchParams.set("lon", String(bias.lng));
  }

  const res = await fetch(url.toString(), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];

  const json = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        osm_id?: number;
        osm_type?: string;
        name?: string;
        street?: string;
        housenumber?: string;
        city?: string;
        state?: string;
        country?: string;
        type?: string;
      };
    }>;
  };

  return (json.features ?? [])
    .map((f, i) => {
      const coords = f.geometry?.coordinates;
      const p = f.properties ?? {};
      if (!coords || coords.length < 2) return null;
      const [lng, lat] = coords;
      const primary =
        p.name ||
        [p.street, p.housenumber].filter(Boolean).join(" ") ||
        p.city ||
        "Place";
      const secondary =
        [p.street && p.name ? p.street : null, p.city, p.state, p.country]
          .filter(Boolean)
          .join(", ") || null;
      const label = secondary ? `${primary}, ${secondary}` : primary;
      return {
        placeId: `photon:${p.osm_type ?? "x"}:${p.osm_id ?? i}`,
        primary,
        secondary,
        lat,
        lng,
        label,
        source: "nominatim" as const,
      };
    })
    .filter((s): s is PlaceSuggestion => s != null && Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

async function searchGoogleBackend(
  query: string,
  sessionToken: string,
  bias: { lat: number; lng: number } | null,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const budget = await googleBudgetLeft();
  if (budget <= 0) return [];

  let latLngQuery = "";
  if (bias) {
    latLngQuery = `&lat=${bias.lat.toFixed(6)}&lng=${bias.lng.toFixed(6)}`;
  }

  const res = await apiFetch<{
    suggestions: Array<{
      placeId: string;
      primary: string;
      secondary: string | null;
      fullText?: string;
      lat?: number;
      lng?: number;
      source?: "nominatim" | "google";
    }>;
    source?: "nominatim" | "google";
    reason?: string;
    message?: string | null;
  }>(
    `/api/live/places/autocomplete?input=${encodeURIComponent(query)}&sessionToken=${sessionToken}${latLngQuery}`,
    { anonymous: true, signal },
  );

  // Backend may already return Nominatim (after deploy) — don't burn Google budget.
  if (res.source === "nominatim" || res.suggestions?.some((s) => s.source === "nominatim")) {
    return (res.suggestions ?? []).map((s) => ({
      placeId: s.placeId,
      primary: s.primary,
      secondary: s.secondary,
      lat: s.lat,
      lng: s.lng,
      label: s.fullText ?? s.primary,
      source: "nominatim" as const,
    }));
  }

  if (!res.suggestions?.length) {
    if (res.reason) throw new Error(res.message || res.reason);
    return [];
  }

  await recordGoogleCall();
  return res.suggestions.map((s) => ({
    placeId: s.placeId,
    primary: s.primary,
    secondary: s.secondary,
    lat: s.lat,
    lng: s.lng,
    label: s.fullText ?? s.primary,
    source: "google" as const,
  }));
}

/**
 * Cost-conscious destination search:
 * 1. Photon (free, works from React Native)
 * 2. Backend autocomplete (Nominatim server-side after deploy, else capped Google)
 */
export async function searchDestinationPlaces(
  query: string,
  opts: {
    sessionToken: string;
    bias?: { lat: number; lng: number } | null;
    signal?: AbortSignal;
  },
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const bias = opts.bias ?? null;
  const key = cacheKey(q, bias?.lat, bias?.lng);
  const cached = sessionCache.get(key);
  if (cached) return cached;

  const photon = await searchPhoton(q, bias, opts.signal).catch(() => []);
  if (photon.length > 0) {
    sessionCache.set(key, photon);
    return photon;
  }

  const backend = await searchGoogleBackend(
    q,
    opts.sessionToken,
    bias,
    opts.signal,
  ).catch(() => []);
  if (backend.length > 0) sessionCache.set(key, backend);
  return backend;
}

export async function resolvePlaceSuggestion(
  suggestion: PlaceSuggestion,
  sessionToken: string,
): Promise<{
  lat: number;
  lng: number;
  label: string;
  placeId: string | null;
} | null> {
  if (
    suggestion.lat != null &&
    suggestion.lng != null &&
    (suggestion.source === "nominatim" ||
      suggestion.placeId.startsWith("osm:") ||
      suggestion.placeId.startsWith("photon:"))
  ) {
    return {
      lat: suggestion.lat,
      lng: suggestion.lng,
      label: suggestion.label ?? suggestion.primary,
      placeId: null,
    };
  }

  const budget = await googleBudgetLeft();
  if (budget <= 0) return null;

  const res = await apiFetch<{
    destination: {
      lat: number;
      lng: number;
      label: string;
      placeId: string | null;
    } | null;
  }>(
    `/api/live/places/details?placeId=${encodeURIComponent(suggestion.placeId)}&sessionToken=${sessionToken}`,
    { anonymous: true },
  );

  if (!res.destination) return null;
  await recordGoogleCall();
  return res.destination;
}
