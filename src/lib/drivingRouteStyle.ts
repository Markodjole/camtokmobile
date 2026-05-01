/**
 * Mirrors `apps/web/src/lib/live/routing/drivingRouteStyle.ts` for mobile UI labels.
 */

export type ComfortVsSpeed = "comfort" | "balanced" | "speed";
export type PathStyle = "smooth" | "balanced" | "direct";

export type DrivingRouteStyle = {
  version: number;
  comfortVsSpeed: ComfortVsSpeed;
  pathStyle: PathStyle;
  ecoConscious: boolean;
};

export const DEFAULT_DRIVING_ROUTE_STYLE: DrivingRouteStyle = {
  version: 1,
  comfortVsSpeed: "balanced",
  pathStyle: "balanced",
  ecoConscious: false,
};

export function normalizeDrivingRouteStyle(raw: unknown): DrivingRouteStyle {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DRIVING_ROUTE_STYLE };
  const o = raw as Record<string, unknown>;
  const cs = o.comfortVsSpeed;
  const ps = o.pathStyle;
  return {
    version: 1,
    comfortVsSpeed:
      cs === "comfort" || cs === "balanced" || cs === "speed" ? cs : "balanced",
    pathStyle:
      ps === "smooth" || ps === "balanced" || ps === "direct" ? ps : "balanced",
    ecoConscious: typeof o.ecoConscious === "boolean" ? o.ecoConscious : false,
  };
}

function motorRoad(tm?: string | null): boolean {
  const m = (tm ?? "").toLowerCase();
  return (
    m.includes("car") ||
    m.includes("drive") ||
    m.includes("scooter") ||
    m.includes("motor")
  );
}

export function drivingRouteStyleBadges(
  style: DrivingRouteStyle,
  transportMode?: string | null,
): string[] {
  const motor = motorRoad(transportMode);
  const tags: string[] = [];

  if (style.pathStyle === "smooth") {
    tags.push(motor ? "Avoids highways" : "Calmer paths");
    tags.push("Smooth driving");
  } else if (style.pathStyle === "direct") {
    tags.push("Likes shortcuts");
    tags.push("Direct routes");
  }

  if (style.comfortVsSpeed === "comfort") tags.push("Comfort over speed");
  else if (style.comfortVsSpeed === "speed") tags.push("Prioritizes ETA");

  if (style.ecoConscious) {
    tags.push(motor ? "Saves gas & tolls" : "Light footprint");
  }

  let dedup = [...new Set(tags)];
  if (dedup.length === 0) dedup = ["Everyday routing"];
  return dedup.slice(0, 4);
}
