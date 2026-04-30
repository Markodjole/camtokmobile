/**
 * Shared types for the CamTok live layer.
 *
 * These mirror the shapes returned by the Next.js backend (`apps/web`) —
 * specifically `LiveFeedRow` and the live room / markets / proposals
 * actions. Redeclaring them here (instead of importing the server
 * package) keeps the mobile app fully standalone.
 */

export type TransportMode =
  | "walking"
  | "bike"
  | "scooter"
  | "car"
  | "motorcycle"
  | "run"
  | "other";

export type RoutePoint = {
  lat: number;
  lng: number;
  heading?: number;
  speedMps?: number;
};

export type LiveMarketOption = {
  id: string;
  label: string;
  shortLabel?: string;
  displayOrder: number;
};

export type CityGridSpec = {
  cellMeters: number;
  swLat: number;
  swLng: number;
  dLat: number;
  dLng: number;
  nCols: number;
  nRows: number;
  cityLabel: string | null;
};

export type GridCell = {
  id: string;
  label: string;
  row: number;
  col: number;
  polygon: Array<{ lat: number; lng: number }>;
};

export type LiveMarketSummary = {
  id: string;
  title: string;
  marketType: string;
  locksAt: string;
  revealAt: string;
  /** Empty for `city_grid` markets (options derived client-side from cityGridSpec). */
  options: LiveMarketOption[];
  participantCount: number;
  turnPointLat: number | null;
  turnPointLng: number | null;
  /** Present when marketType === "city_grid" */
  cityGridSpec: CityGridSpec | null;
};

export type LiveFeedRow = {
  roomId: string;
  liveSessionId: string;
  characterId: string;
  characterName: string;
  characterSlug: string | null;
  characterTagline: string | null;
  transportMode: TransportMode | string;
  statusText: string | null;
  intentLabel: string | null;
  regionLabel: string | null;
  placeType: string | null;
  phase: string;
  viewerCount: number;
  participantCount: number;
  currentMarket: LiveMarketSummary | null;
  sessionStartedAt: string;
  lastHeartbeatAt: string | null;
  routePoints: RoutePoint[];
  destination: {
    lat: number;
    lng: number;
    label: string;
    placeId: string | null;
  } | null;
};

/**
 * Driver-route guidance from the backend. The backend internally tracks
 * a queue of up to 3 crossroad pins ahead of the vehicle (200–400 m of
 * road distance apart), but only `pins[0]` — the next decision point —
 * is shown to the user. The blue line is a pre-trimmed 50 m segment
 * ending at `pins[0]`.
 */
export type DriverRoutePin = {
  /** Stable id (OSM node id) — useful for dedup. */
  id: number;
  lat: number;
  lng: number;
  /** Road-distance from the current vehicle position, meters. */
  distanceMeters: number;
};

export type DriverRouteInstruction = {
  decisionId?: string;
  pins: DriverRoutePin[];
  approachLine: Array<{ lat: number; lng: number }>;
  confidence?: "high" | "low";
};

/* ---------------- Legacy aliases (kept so older files keep compiling) ---- */

export type LiveRoutePoint = RoutePoint & { recordedAt?: string };

export type LiveMarket = LiveMarketSummary & {
  prompt?: string;
  status?: "open" | "locked" | "settled" | "cancelled";
};

export type LiveFeedItem = LiveFeedRow & {
  title?: string;
  characterAvatarUrl?: string | null;
  viewers?: number;
  startedAt?: string;
  thumbnailUrl?: string | null;
  liveStatus?: "live" | "starting" | "offline";
  city?: string | null;
};

export type LiveRoomDetail = LiveFeedRow & {
  characterAvatarUrl?: string | null;
  viewers?: number;
  startedAt?: string;
  liveStatus?: "live" | "starting" | "offline";
  walletBalance?: number;
};

/* ---------------- Go-live / owner flows ---------------------------------- */

export type StartLiveSessionInput = {
  characterId: string;
  transportMode: TransportMode;
  statusText?: string;
  intentLabel?: string;
  destination?: {
    lat: number;
    lng: number;
    label: string;
    placeId?: string | null;
  } | null;
};

export type DestinationRoute = {
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
  } | null;
  distanceToDestinationMeters?: number;
};

export type StartLiveSessionResult =
  | { sessionId: string; roomId: string }
  | { error: string };

export type ProposeMarketInput = {
  roomId: string;
  title: string;
  options: Array<{ label: string; shortLabel?: string }>;
  locksInSeconds?: number;
};
