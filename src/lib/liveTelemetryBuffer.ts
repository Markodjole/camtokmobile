import type { RoutePoint } from "@/types/live";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";

export type TelemetryPoint = {
  recordedAt: string;
  lat: number;
  lng: number;
  speedMps?: number;
  headingDeg?: number;
  accuracyMeters?: number;
};

const pending: TelemetryPoint[] = [];

export function pushLiveTelemetryPoint(
  point: TelemetryPoint,
  routePoint: RoutePoint,
) {
  pending.push(point);
  useLiveBroadcastStore.getState().setRoutePoints((prev) => [
    ...prev.slice(-199),
    routePoint,
  ]);
}

export function drainLiveTelemetryPending(max = 20): TelemetryPoint[] {
  return pending.splice(0, max);
}

export function clearLiveTelemetryPending() {
  pending.length = 0;
}
