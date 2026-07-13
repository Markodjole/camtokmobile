import { useEffect } from "react";
import { Image } from "react-native";

/**
 * Native tile pre-warmer for Google Maps SDK (PROVIDER_GOOGLE).
 * Prefetches the 3×3 tile grid around the driver at zoom 16–17.
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
        Image.prefetch(url).catch(() => {
          /* silent */
        });
      }, delay);
      timers.push(t);
      delay += 50;
    };

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
