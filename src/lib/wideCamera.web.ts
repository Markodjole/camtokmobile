import type { WideVideoConstraints } from "./wideCamera";

export async function buildWideVideoConstraints(
  _mediaDevices: unknown,
  base: WideVideoConstraints,
): Promise<WideVideoConstraints> {
  return {
    ...base,
    facingMode: { exact: "environment" },
    // Non-standard but supported on mobile browsers for the 0.5× lens.
    zoom: 0.5,
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
}
