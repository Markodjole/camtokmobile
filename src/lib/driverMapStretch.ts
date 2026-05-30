export const DRIVER_MAP_STRETCH_KEY = "camtok:driver_map_stretch_y";
export const DEFAULT_DRIVER_MAP_STRETCH = 1.12;
export const MIN_DRIVER_MAP_STRETCH = 1.0;
export const MAX_DRIVER_MAP_STRETCH = 1.5;
export const DRIVER_MAP_STRETCH_STEP = 0.04;

export function clampDriverMapStretch(value: number): number {
  return Math.min(MAX_DRIVER_MAP_STRETCH, Math.max(MIN_DRIVER_MAP_STRETCH, value));
}
