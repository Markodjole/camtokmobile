import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "./api";

export type PlaceSuggestion = {
  placeId: string;
  primary: string;
  secondary: string | null;
  /** Present for Nominatim hits — avoids a second lookup on pick. */
  lat?: number;
  lng?: number;
  label?: string;
  source: "nominatim" | "google";
};

const NOMINATIM_UA = "CamTokMobile/0.1.0 (destination search)";
const GOOGLE_USAGE_KEY = "camtok:google_places_usage";
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

function splitDisplayName(displayName: string): { primary: string; secondary: string | null } {
  const parts = displayName.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { primary: displayName, secondary: null };
  return { primary: parts[0]!, secondary: parts.slice(1, 4).join(", ") || null };
}

async function searchNominatim(
  query: string,
  bias: { lat: number; lng: number } | null,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");
  if (bias) {
    const d = 0.35;
    url.searchParams.set(
      "viewbox",
      `${bias.lng - d},${bias.lat + d},${bias.lng + d},${bias.lat - d}`,
    );
  }

  const res = await fetch(url.toString(), {
    signal,
    headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
  });
  if (!res.ok) return [];

  const rows = (await res.json()) as Array<{
    place_id?: number;
    lat?: string;
    lon?: string;
    display_name?: string;
    name?: string;
  }>;

  return rows
    .filter((r) => r.place_id != null && r.lat && r.lon && r.display_name)
    .map((r) => {
      const label = r.display_name!;
      const { primary, secondary } = splitDisplayName(
        r.name && !label.startsWith(r.name) ? `${r.name}, ${label}` : label,
      );
      return {
        placeId: `osm:${r.place_id}`,
        primary,
        secondary,
        lat: Number(r.lat),
        lng: Number(r.lon),
        label,
        source: "nominatim" as const,
      };
    })
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

async function searchGoogle(
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

  await recordGoogleCall();
  const res = await apiFetch<{
    suggestions: Array<{
      placeId: string;
      primary: string;
      secondary: string | null;
    }>;
    reason?: string;
  }>(
    `/api/live/places/autocomplete?input=${encodeURIComponent(query)}&sessionToken=${sessionToken}${latLngQuery}`,
    { anonymous: true, signal },
  );

  if (!res.suggestions?.length) return [];
  return res.suggestions.map((s) => ({ ...s, source: "google" as const }));
}

/**
 * Cost-conscious destination search:
 * - Nominatim (free) is always tried first.
 * - Google backend is only used when Nominatim returns nothing AND daily/session caps allow it.
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

  const nominatim = await searchNominatim(q, bias, opts.signal).catch(() => []);
  if (nominatim.length > 0) {
    sessionCache.set(key, nominatim);
    return nominatim;
  }

  const google = await searchGoogle(q, opts.sessionToken, bias, opts.signal).catch(
    () => [],
  );
  if (google.length > 0) sessionCache.set(key, google);
  return google;
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
    suggestion.source === "nominatim" &&
    suggestion.lat != null &&
    suggestion.lng != null
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

  await recordGoogleCall();
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
  return res.destination;
}
