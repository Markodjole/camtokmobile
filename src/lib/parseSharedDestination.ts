import { searchDestinationPlaces } from "@/lib/placeSearch";

export type SharedDestination = {
  lat: number;
  lng: number;
  label: string;
  placeId: string | null;
  source: "share";
};

const LAT_LNG_RE =
  /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/;

/** Google Maps encodes coords as !3dLAT!4dLNG inside place/data URLs. */
const GOOGLE_3D_RE = /!3d(-?\d+\.?\d*)/;
const GOOGLE_4D_RE = /!4d(-?\d+\.?\d*)/;

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function cleanLabel(raw: string | null | undefined, fallback: string): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return fallback;
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

function fromLatLng(
  lat: number,
  lng: number,
  label?: string | null,
): SharedDestination | null {
  if (!isValidCoord(lat, lng)) return null;
  return {
    lat,
    lng,
    label: cleanLabel(label, `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
    placeId: null,
    source: "share",
  };
}

function decodeSafe(value: string): string {
  let out = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(out.replace(/\+/g, " "));
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

function coordsFromGoogleEncoded(raw: string): { lat: number; lng: number } | null {
  const latM = raw.match(GOOGLE_3D_RE);
  const lngM = raw.match(GOOGLE_4D_RE);
  if (!latM || !lngM) return null;
  const lat = Number(latM[1]);
  const lng = Number(lngM[1]);
  if (!isValidCoord(lat, lng)) return null;
  return { lat, lng };
}

function coordsFromAt(raw: string): { lat: number; lng: number } | null {
  const at = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!at) return null;
  const lat = Number(at[1]);
  const lng = Number(at[2]);
  if (!isValidCoord(lat, lng)) return null;
  return { lat, lng };
}

function labelFromMapsUrl(raw: string): string | null {
  const place = raw.match(/\/place\/([^/@?]+)/);
  if (place?.[1]) {
    const label = decodeSafe(place[1]).replace(/\+/g, " ").trim();
    if (label && !LAT_LNG_RE.test(label)) return label;
  }
  const dir = raw.match(/\/dir\/(?:[^/]+\/)+([^/?]+)/);
  if (dir?.[1]) {
    const label = decodeSafe(dir[1]).replace(/\+/g, " ").trim();
    if (label && !LAT_LNG_RE.test(label)) return label;
  }
  return null;
}

/**
 * Pull the real https maps URL out of an Android intent:// Location header.
 * Google short links redirect to intent://…;S.browser_fallback_url=https://…;end;
 */
function unwrapIntentLocation(location: string): string {
  if (!/^intent:/i.test(location)) return location;
  const m = location.match(/S\.browser_fallback_url=([^;]+)/i);
  if (m?.[1]) return decodeSafe(m[1]);
  const scheme = location.match(/;scheme=([^;]+)/i)?.[1];
  const path = location.replace(/^intent:/i, "").split("#")[0] ?? "";
  if (scheme && path) return `${scheme}://${path.replace(/^\/\//, "")}`;
  return location;
}

/**
 * Expand maps.app.goo.gl without following intent:// (that breaks RN/Node fetch).
 * Uses redirect:manual and parses Location / browser_fallback_url.
 */
export async function expandMapsUrl(url: string): Promise<string> {
  if (!/maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps/i.test(url)) {
    return url;
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": MOBILE_UA,
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const location =
      res.headers.get("Location") ??
      res.headers.get("location") ??
      // Some RN builds expose only via opaque redirect URL
      (typeof res.url === "string" && res.url !== url ? res.url : null);

    if (location) {
      const unwrapped = unwrapIntentLocation(location);
      if (/^https?:\/\//i.test(unwrapped)) return unwrapped;
      // Still an intent or short link — try extracting coords later from raw location
      if (coordsFromGoogleEncoded(location) || coordsFromGoogleEncoded(unwrapped)) {
        return unwrapped || location;
      }
    }

    // If the runtime auto-followed to an https maps URL, use it.
    if (res.url && /google\.[^/]+\/maps|maps\.google/i.test(res.url)) {
      return res.url;
    }
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[share-dest] expand failed", e);
    }
  }

  return url;
}

function parseGeoUri(raw: string): SharedDestination | null {
  const m = raw.match(/^geo:([^?#]*)(?:\?(.*))?$/i);
  if (!m) return null;
  const path = m[1] ?? "";
  const query = m[2] ?? "";

  const pathCoords = path.match(LAT_LNG_RE);
  if (pathCoords) {
    const lat = Number(pathCoords[1]);
    const lng = Number(pathCoords[2]);
    if (lat !== 0 || lng !== 0) return fromLatLng(lat, lng);
  }

  const params = new URLSearchParams(query);
  const q = params.get("q");
  if (!q) return null;

  const qCoords = q.match(LAT_LNG_RE);
  if (qCoords) {
    const lat = Number(qCoords[1]);
    const lng = Number(qCoords[2]);
    const labelMatch = q.match(/\(([^)]+)\)/);
    return fromLatLng(lat, lng, labelMatch?.[1] ?? null);
  }

  return null;
}

function parseGoogleMapsUrl(
  urlOrRaw: string,
  hintLabel?: string | null,
): SharedDestination | null {
  const raw = urlOrRaw;
  const encoded = coordsFromGoogleEncoded(raw);
  if (encoded) {
    return fromLatLng(
      encoded.lat,
      encoded.lng,
      hintLabel ?? labelFromMapsUrl(raw),
    );
  }

  const at = coordsFromAt(raw);
  if (at) {
    return fromLatLng(at.lat, at.lng, hintLabel ?? labelFromMapsUrl(raw));
  }

  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (!url) return null;

  const destParam =
    url.searchParams.get("destination") ??
    url.searchParams.get("daddr") ??
    url.searchParams.get("destination_place_id");
  if (destParam) {
    const coords = destParam.match(LAT_LNG_RE);
    if (coords) {
      return fromLatLng(
        Number(coords[1]),
        Number(coords[2]),
        hintLabel ?? null,
      );
    }
  }

  const dirParts = raw.match(/\/dir\/([^?]+)/);
  if (dirParts?.[1]) {
    const segments = dirParts[1]
      .split("/")
      .map((s) => decodeSafe(s))
      .filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      const coords = last.match(LAT_LNG_RE);
      if (coords) {
        return fromLatLng(Number(coords[1]), Number(coords[2]), hintLabel);
      }
    }
  }

  const q =
    url.searchParams.get("q") ??
    url.searchParams.get("query") ??
    url.searchParams.get("ll") ??
    url.searchParams.get("center");
  if (q) {
    const coords = q.match(LAT_LNG_RE);
    if (coords) {
      const label =
        hintLabel ||
        q.replace(LAT_LNG_RE, "").replace(/^[,\s]+|[,\s]+$/g, "") ||
        null;
      return fromLatLng(Number(coords[1]), Number(coords[2]), label);
    }
  }

  return null;
}

function parseAppleMapsUrl(url: URL, hintLabel?: string | null): SharedDestination | null {
  const daddr = url.searchParams.get("daddr") ?? url.searchParams.get("address");
  const ll = url.searchParams.get("ll") ?? url.searchParams.get("coordinate");
  if (ll) {
    const coords = ll.match(LAT_LNG_RE);
    if (coords) {
      return fromLatLng(
        Number(coords[1]),
        Number(coords[2]),
        hintLabel ?? (daddr ? decodeSafe(daddr) : null),
      );
    }
  }
  if (daddr) {
    const coords = daddr.match(LAT_LNG_RE);
    if (coords) {
      return fromLatLng(Number(coords[1]), Number(coords[2]), hintLabel);
    }
  }
  return null;
}

function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const geo = text.match(/geo:[^\s<>"']+/gi) ?? [];
  return [...found, ...geo].map((u) => u.replace(/[),.]+$/g, ""));
}

/** First non-URL, non-phone line from Maps share text → place name. */
function extractPlaceNameHint(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^https?:\/\//i.test(line)) continue;
    if (/^geo:/i.test(line)) continue;
    if (/^tel:/i.test(line)) continue;
    if (/^\+?\d[\d\s().-]{6,}$/.test(line)) continue;
    if (LAT_LNG_RE.test(line) && line.length < 40) continue;
    if (line.length < 2) continue;
    return line.slice(0, 120);
  }
  return null;
}

async function geocodeLabel(label: string): Promise<SharedDestination | null> {
  try {
    const hits = await searchDestinationPlaces(label, {
      sessionToken: `share-${Date.now()}`,
    });
    const hit = hits.find((h) => h.lat != null && h.lng != null) ?? hits[0];
    if (hit?.lat == null || hit?.lng == null) return null;
    return fromLatLng(
      hit.lat,
      hit.lng,
      hit.label ?? hit.primary ?? label,
    );
  } catch {
    return null;
  }
}

/**
 * Parse shared Maps text / URL into a destination CamTok can route to.
 */
export async function parseSharedDestination(
  raw: string | null | undefined,
): Promise<SharedDestination | null> {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  const hintLabel = extractPlaceNameHint(text);
  const candidates = extractUrls(text);

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log("[share-dest] raw", text.slice(0, 240), "hint", hintLabel);
  }

  if (candidates.length === 0) {
    const bare = text.match(LAT_LNG_RE);
    if (bare) return fromLatLng(Number(bare[1]), Number(bare[2]), hintLabel);
    if (hintLabel) return geocodeLabel(hintLabel);
    return null;
  }

  for (const candidate of candidates) {
    if (/^geo:/i.test(candidate)) {
      const geo = parseGeoUri(candidate);
      if (geo) return geo;
      continue;
    }

    // Try parsing the short URL string itself (sometimes already expanded in text)
    const direct = parseGoogleMapsUrl(candidate, hintLabel);
    if (direct) return direct;

    let href = candidate;
    try {
      href = await expandMapsUrl(candidate);
    } catch {
      href = candidate;
    }

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log("[share-dest] expanded", href.slice(0, 240));
    }

    // Expanded string may still be intent:// or maps URL with !3d!4d
    const fromExpanded = parseGoogleMapsUrl(href, hintLabel);
    if (fromExpanded) return fromExpanded;

    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }

    const host = url.hostname.toLowerCase();
    if (
      host.includes("google.") ||
      host === "maps.app.goo.gl" ||
      host === "goo.gl"
    ) {
      const parsed = parseGoogleMapsUrl(url.href, hintLabel);
      if (parsed) return parsed;
    }
    if (host.includes("apple.com") || host === "maps.apple.com") {
      const parsed = parseAppleMapsUrl(url, hintLabel);
      if (parsed) return parsed;
    }

    const q = url.searchParams.get("q") ?? url.searchParams.get("ll");
    if (q) {
      const coords = q.match(LAT_LNG_RE);
      if (coords) {
        return fromLatLng(Number(coords[1]), Number(coords[2]), hintLabel);
      }
    }
  }

  const bare = text.match(LAT_LNG_RE);
  if (bare) return fromLatLng(Number(bare[1]), Number(bare[2]), hintLabel);

  // Last resort: geocode the place name Google put above the short link
  if (hintLabel) {
    const geo = await geocodeLabel(hintLabel);
    if (geo) return geo;
  }

  return null;
}
