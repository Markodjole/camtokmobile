/**
 * These types mirror what the Next.js `apps/web` API returns for live rooms
 * and feeds. We redeclare them here instead of importing from the monorepo
 * so the mobile app stays standalone (and we avoid pulling in server-only
 * modules). If the backend changes shape, update here.
 */

export type LiveFeedItem = {
  roomId: string;
  title: string;
  characterSlug: string | null;
  characterName: string;
  characterAvatarUrl: string | null;
  viewers: number;
  startedAt: string;
  thumbnailUrl: string | null;
  liveStatus: "live" | "starting" | "offline";
  transportMode: "car" | "bike" | "walk" | null;
  city: string | null;
};

export type LiveRoutePoint = {
  lat: number;
  lng: number;
  heading: number | null;
  speedMps: number | null;
  recordedAt: string;
};

export type LiveMarketOption = {
  id: string;
  label: string;
  shortLabel: string | null;
  displayOrder: number;
  odds: number;
  totalStaked: number;
};

export type LiveMarket = {
  id: string;
  prompt: string;
  status: "open" | "locked" | "settled" | "cancelled";
  locksAt: string | null;
  revealAt: string | null;
  turnPointLat: number | null;
  turnPointLng: number | null;
  options: LiveMarketOption[];
};

export type LiveRoomDetail = {
  roomId: string;
  characterName: string;
  characterSlug: string;
  characterAvatarUrl: string | null;
  liveStatus: "live" | "starting" | "offline";
  transportMode: "car" | "bike" | "walk" | null;
  viewers: number;
  startedAt: string;
  routePoints: LiveRoutePoint[];
  currentMarket: LiveMarket | null;
  walletBalance?: number;
};

export type DriverRouteInstruction = {
  decisionId: string;
  turnKind: "left" | "right" | "straight" | "u-turn";
  turnPoint: { lat: number; lng: number };
  checkpoint: { lat: number; lng: number };
  routePolyline: Array<{ lat: number; lng: number }>;
  distanceMeters: number;
  lockAt: string | null;
  expiresAt: string | null;
  confidence: "high" | "low";
};
