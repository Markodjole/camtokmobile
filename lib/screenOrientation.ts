import { requireOptionalNativeModule } from "expo-modules-core";

/** True when the dev client was built with expo-screen-orientation linked. */
export function isScreenOrientationAvailable(): boolean {
  return requireOptionalNativeModule("ExpoScreenOrientation") != null;
}

export async function lockLandscapeAsync(): Promise<void> {
  if (!isScreenOrientationAvailable()) return;
  const ScreenOrientation = await import("expo-screen-orientation");
  await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
}

export async function unlockOrientationAsync(): Promise<void> {
  if (!isScreenOrientationAvailable()) return;
  const ScreenOrientation = await import("expo-screen-orientation");
  await ScreenOrientation.unlockAsync();
}
