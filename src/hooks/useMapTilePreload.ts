import { useEffect } from "react";
import { Image } from "react-native";

/**
 * Native tile pre-warmer.
 *
 * Google Maps SDK (PROVIDER_GOOGLE) manages its own SQLite tile cache
 * automatically — but it only fetches tiles that are *visible*. During a
 * turn the camera rotates and reveals tiles that weren't cached yet, causing
 * the brief grey-tile flash.
 *
 * We mitigate this by pre-fetching the 3×3 Google Static Map tiles around the
 * current position at the zoom levels we use (17–18) using React Native's
 * `Image.prefetch`, which writes them into the OS HTTP cache. The Google Maps
 * SDK shares the same HTTP stack and will get cache hits for those tiles.
 *
 * Tiles are staggered (50 ms apart) so the main thread is never blocked.
 */
const GMAP_TILE = (x: number, y: number, z: number) =>
  `https://mt1.google.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}`;

const lon2tile = (lon: number, z: number) =>
  Math.floor(((lon + 180) / 360) * 2 ** z);

const lat2tile = (lat: number, z: number) =>
  Math.floor(
    ((1 -
      Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) /
        Math.PI) /
      2) *
      2 ** z,
  );

export function useMapTilePreload(
  lat: number | undefined,
  lng: number | undefined,
) {
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let delay = 0;

    const prefetch = (url: string) => {
      const t = setTimeout(() => {
        Image.prefetch(url).catch(() => {/* silent */});
      }, delay);
      timers.push(t);
      delay += 50;
    };

    // Pre-warm a 3×3 tile grid at zoom 16 and 17 (the levels we fly through)
    const ZOOMS = [16, 17];
    const RADIUS = 1;

    for (const z of ZOOMS) {
      const tx = lon2tile(lng, z);
      const ty = lat2tile(lat, z);
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        for (let dy = -RADIUS; dy <= RADIUS; dy++) {
          prefetch(GMAP_TILE(tx + dx, ty + dy, z));
        }
      }
    }

    return () => timers.forEach(clearTimeout);
  }, [lat, lng]);
}
