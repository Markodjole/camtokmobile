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

export type LiveMarketSummary = {
  id: string;
  title: string;
  marketType: string;
  locksAt: string;
  revealAt: string;
  options: LiveMarketOption[];
  participantCount: number;
  turnPointLat: number | null;
  turnPointLng: number | null;
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
};

export type DriverRouteInstruction = {
  decisionId?: string;
  turnKind?: "left" | "right" | "straight" | "u-turn";
  turnPoint: { lat: number; lng: number };
  checkpoint: { lat: number; lng: number };
  routePolyline: Array<{ lat: number; lng: number }>;
  distanceMeters?: number;
  lockAt?: string | null;
  expiresAt?: string | null;
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
