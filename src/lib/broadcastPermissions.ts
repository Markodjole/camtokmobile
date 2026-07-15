import { Camera } from "expo-camera";
import * as Location from "expo-location";
import { Linking, PermissionsAndroid, Platform } from "react-native";

export type BroadcastPermissionId =
  | "camera"
  | "microphone"
  | "location"
  | "locationBackground";

export type BroadcastPermissionStatus = {
  id: BroadcastPermissionId;
  label: string;
  detail: string;
  granted: boolean;
  canAskAgain: boolean;
  required: boolean;
};

export type BroadcastPermissionsSnapshot = {
  permissions: BroadcastPermissionStatus[];
  /** Camera + mic + foreground location — required to go live. */
  ready: boolean;
  /** Includes optional background location for ride telemetry. */
  allGranted: boolean;
};

const PERMISSION_META: Record<
  BroadcastPermissionId,
  { label: string; detail: string; required: boolean }
> = {
  camera: {
    label: "Camera",
    detail: "Live video and vehicle detection on your stream",
    required: true,
  },
  microphone: {
    label: "Microphone",
    detail: "Audio on your live broadcast",
    required: true,
  },
  location: {
    label: "Location",
    detail: "Map position and ride telemetry for viewers",
    required: true,
  },
  locationBackground: {
    label: "Background location",
    detail: "Keeps GPS running during brief interruptions",
    required: false,
  },
};

function toStatus(
  id: BroadcastPermissionId,
  granted: boolean,
  canAskAgain: boolean,
): BroadcastPermissionStatus {
  const meta = PERMISSION_META[id];
  return {
    id,
    label: meta.label,
    detail: meta.detail,
    granted,
    canAskAgain,
    required: meta.required,
  };
}

function buildSnapshot(
  permissions: BroadcastPermissionStatus[],
): BroadcastPermissionsSnapshot {
  const required = permissions.filter((p) => p.required);
  const ready = required.every((p) => p.granted);
  return {
    permissions,
    ready,
    allGranted: permissions.every((p) => p.granted),
  };
}

export async function checkBroadcastPermissions(): Promise<BroadcastPermissionsSnapshot> {
  const [camera, microphone] = await Promise.all([
    Camera.getCameraPermissionsAsync(),
    Camera.getMicrophonePermissionsAsync(),
  ]);
  const foreground = await Location.getForegroundPermissionsAsync();
  const background =
    Platform.OS === "web"
      ? { status: "granted" as const, canAskAgain: false }
      : await Location.getBackgroundPermissionsAsync();

  return buildSnapshot([
    toStatus("camera", camera.granted, camera.canAskAgain),
    toStatus("microphone", microphone.granted, microphone.canAskAgain),
    toStatus(
      "location",
      foreground.status === "granted",
      foreground.canAskAgain,
    ),
    toStatus(
      "locationBackground",
      background.status === "granted",
      background.canAskAgain,
    ),
  ]);
}

/** Request everything needed for streaming + on-device vehicle analysis. */
export async function requestAllBroadcastPermissions(): Promise<BroadcastPermissionsSnapshot> {
  if (Platform.OS === "android") {
    try {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ]);
    } catch {
      // Fall through to Expo permission APIs.
    }
  }

  await Camera.requestCameraPermissionsAsync();
  await Camera.requestMicrophonePermissionsAsync();

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status === "granted" && Platform.OS !== "web") {
    await Location.requestBackgroundPermissionsAsync().catch(() => undefined);
  }

  return checkBroadcastPermissions();
}

export function openBroadcastPermissionSettings(): Promise<void> {
  return Linking.openSettings();
}
