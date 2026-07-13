export type SharedDestination = {
  lat: number;
  lng: number;
  label: string;
  placeId: string | null;
  source: "share";
};

const LAT_LNG_RE =
  /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/;

function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
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
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** Expand Google short links so we can parse the final maps URL. */
export async function expandMapsUrl(url: string): Promise<string> {
  if (!/maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps/i.test(url)) {
    return url;
  }
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    if (res.url) return res.url;
  } catch {
    // keep original
  }
  return url;
}

function parseGeoUri(raw: string): SharedDestination | null {
  // geo:lat,lng or geo:0,0?q=lat,lng(Label) or geo:0,0?q=Address
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

  // Address-only geo query — no coordinates yet
  return null;
}

function parseGoogleMapsUrl(url: URL): SharedDestination | null {
  const href = url.href;

  // /@lat,lng,zoom
  const at = href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) {
    const placeName = href.match(/\/place\/([^/@]+)/);
    return fromLatLng(
      Number(at[1]),
      Number(at[2]),
      placeName ? decodeSafe(placeName[1].replace(/\+/g, " ")) : null,
    );
  }

  // /dir/.../destLat,destLng or /dir/?destination=lat,lng
  const destParam =
    url.searchParams.get("destination") ??
    url.searchParams.get("daddr") ??
    url.searchParams.get("destination_place_id");
  if (destParam) {
    const coords = destParam.match(LAT_LNG_RE);
    if (coords) {
      return fromLatLng(Number(coords[1]), Number(coords[2]));
    }
  }

  const dirParts = href.match(/\/dir\/([^?]+)/);
  if (dirParts?.[1]) {
    const segments = dirParts[1]
      .split("/")
      .map((s) => decodeSafe(s))
      .filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      const coords = last.match(LAT_LNG_RE);
      if (coords) {
        return fromLatLng(Number(coords[1]), Number(coords[2]));
      }
      // last segment may be an address — try query params instead below
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
      const label = q.replace(LAT_LNG_RE, "").replace(/^[,\s]+|[,\s]+$/g, "");
      return fromLatLng(Number(coords[1]), Number(coords[2]), label || null);
    }
  }

  const place = href.match(/\/place\/([^/@?]+)/);
  if (place?.[1]) {
    // Place name without coords — not enough for routing by itself
    return null;
  }

  return null;
}

function parseAppleMapsUrl(url: URL): SharedDestination | null {
  const daddr = url.searchParams.get("daddr") ?? url.searchParams.get("address");
  const ll = url.searchParams.get("ll") ?? url.searchParams.get("coordinate");
  if (ll) {
    const coords = ll.match(LAT_LNG_RE);
    if (coords) {
      return fromLatLng(
        Number(coords[1]),
        Number(coords[2]),
        daddr ? decodeSafe(daddr) : null,
      );
    }
  }
  if (daddr) {
    const coords = daddr.match(LAT_LNG_RE);
    if (coords) {
      return fromLatLng(Number(coords[1]), Number(coords[2]));
    }
  }
  return null;
}

function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const geo = text.match(/geo:[^\s<>"']+/gi) ?? [];
  return [...found, ...geo].map((u) => u.replace(/[),.]+$/g, ""));
}

/**
 * Parse shared Maps text / URL into a destination CamTok can route to.
 * Returns null if we only got an address without coordinates.
 */
export async function parseSharedDestination(
  raw: string | null | undefined,
): Promise<SharedDestination | null> {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  // Prefer URLs embedded in share text
  const candidates = extractUrls(text);
  if (candidates.length === 0) {
    const bare = text.match(LAT_LNG_RE);
    if (bare) return fromLatLng(Number(bare[1]), Number(bare[2]));
    return null;
  }

  for (const candidate of candidates) {
    if (/^geo:/i.test(candidate)) {
      const geo = parseGeoUri(candidate);
      if (geo) return geo;
      continue;
    }

    let href = candidate;
    try {
      href = await expandMapsUrl(candidate);
    } catch {
      href = candidate;
    }

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
      const parsed = parseGoogleMapsUrl(url);
      if (parsed) return parsed;
    }
    if (host.includes("apple.com") || host === "maps.apple.com") {
      const parsed = parseAppleMapsUrl(url);
      if (parsed) return parsed;
    }

    // Generic ?q=lat,lng on any host
    const q = url.searchParams.get("q") ?? url.searchParams.get("ll");
    if (q) {
      const coords = q.match(LAT_LNG_RE);
      if (coords) {
        return fromLatLng(Number(coords[1]), Number(coords[2]));
      }
    }
  }

  const bare = text.match(LAT_LNG_RE);
  if (bare) return fromLatLng(Number(bare[1]), Number(bare[2]));
  return null;
}
