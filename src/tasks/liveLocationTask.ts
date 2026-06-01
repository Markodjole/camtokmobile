import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { pushLiveTelemetryPoint } from "@/lib/liveTelemetryBuffer";
import type { RoutePoint } from "@/types/live";

export const LIVE_LOCATION_TASK = "camtok-live-location";

function ingestLocation(pos: Location.LocationObject) {
  const speedMps =
    pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
      ? pos.coords.speed
      : undefined;
  const heading =
    pos.coords.heading != null &&
    !Number.isNaN(pos.coords.heading) &&
    pos.coords.heading >= 0 &&
    (speedMps ?? 0) >= 0.5
      ? pos.coords.heading
      : undefined;

  const routePoint: RoutePoint = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    heading,
    speedMps,
  };

  pushLiveTelemetryPoint(
    {
      recordedAt: new Date(pos.timestamp ?? Date.now()).toISOString(),
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      speedMps: routePoint.speedMps,
      headingDeg: routePoint.heading,
      accuracyMeters: pos.coords.accuracy ?? undefined,
    },
    routePoint,
  );
}

TaskManager.defineTask(LIVE_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[live-location-task]", error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)
    ?.locations;
  if (!locations?.length) return;
  for (const loc of locations) {
    ingestLocation(loc);
  }
});

export async function startLiveLocationTask(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return false;

  const running = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK);
  if (running) return true;

  await Location.requestBackgroundPermissionsAsync().catch(() => undefined);

  await Location.startLocationUpdatesAsync(LIVE_LOCATION_TASK, {
    accuracy: Location.Accuracy.Highest,
    timeInterval: 450,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "CamTok live",
      notificationBody: "Tracking your drive while broadcasting",
      notificationColor: "#ef4444",
    },
  });
  return true;
}

export async function stopLiveLocationTask() {
  const running = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK);
  if (running) {
    await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
  }
}
