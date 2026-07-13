import { Platform } from "react-native";
import * as Location from "expo-location";
import { pushLiveTelemetryPoint } from "@/lib/liveTelemetryBuffer";
import type { RoutePoint } from "@/types/live";

export const LIVE_LOCATION_TASK = "camtok-live-location";

type TaskManagerModule = typeof import("expo-task-manager");

let taskManager: TaskManagerModule | null | undefined;

function getTaskManager(): TaskManagerModule | null {
  if (Platform.OS === "web") return null;
  if (taskManager !== undefined) return taskManager;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    taskManager = require("expo-task-manager") as TaskManagerModule;
  } catch {
    taskManager = null;
  }
  return taskManager;
}

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

function registerLiveLocationTask() {
  const TaskManager = getTaskManager();
  if (!TaskManager) return;

  try {
    TaskManager.defineTask(LIVE_LOCATION_TASK, async ({ data, error }) => {
      if (error) {
        console.warn("[live-location-task]", error.message);
        return;
      }
      const locations = (
        data as { locations?: Location.LocationObject[] } | undefined
      )?.locations;
      if (!locations?.length) return;
      for (const loc of locations) {
        ingestLocation(loc);
      }
    });
  } catch (e) {
    console.warn(
      "[live-location-task] Failed to register background task:",
      e instanceof Error ? e.message : e,
    );
  }
}

registerLiveLocationTask();

export function isLiveLocationTaskAvailable(): boolean {
  return getTaskManager() != null;
}

export type LiveLocationTaskStartResult =
  | "started"
  | "no_permission"
  | "unavailable"
  | "failed";

export async function startLiveLocationTask(): Promise<LiveLocationTaskStartResult> {
  if (!getTaskManager()) return "unavailable";

  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return "no_permission";

  try {
    const running = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK);
    if (running) return "started";

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
    return "started";
  } catch (e) {
    console.warn(
      "[live-location-task] start failed:",
      e instanceof Error ? e.message : e,
    );
    return "failed";
  }
}

export async function stopLiveLocationTask() {
  if (!getTaskManager()) return;

  const running = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK);
  if (running) {
    await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
  }
}
