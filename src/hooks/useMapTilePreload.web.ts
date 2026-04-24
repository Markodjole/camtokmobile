import { useEffect } from "react";

/**
 * Web-only hook. When given a lat/lng, silently pre-fetches OSM raster tiles
 * for the surrounding area at zoom 14–17 into the browser's HTTP cache.
 *
 * Tiles are fetched with `cache: "force-cache"` so subsequent Leaflet
 * requests hit the disk cache instantly (sub-millisecond) instead of the
 * network.  The browser enforces OSM's Cache-Control headers (1 year) so
 * tiles are only downloaded once per session.
 *
 * We stagger fetches with small delays so the network isn't saturated on
 * startup. The hook is a no-op on native (the `.web.ts` suffix ensures Metro
 * never bundles it for native targets).
 */
export function useMapTilePreload(
  lat: number | undefined,
  lng: number | undefined,
) {
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    if (typeof window === "undefined") return;

    // Tile coordinate helpers
    const lon2tile = (lon: number, z: number) =>
      Math.floor(((lon + 180) / 360) * 2 ** z);
    const lat2tile = (latDeg: number, z: number) =>
      Math.floor(
        ((1 -
          Math.log(
            Math.tan((latDeg * Math.PI) / 180) +
              1 / Math.cos((latDeg * Math.PI) / 180),
          ) /
            Math.PI) /
          2) *
          2 ** z,
      );

    let cancelled = false;
    let delay = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const prefetch = (url: string) => {
      const t = setTimeout(() => {
        if (cancelled) return;
        // fetch into HTTP cache — Leaflet will get a cache-hit for free
        fetch(url, { cache: "force-cache", mode: "no-cors" }).catch(() => {
          /* silently ignore network errors */
        });
      }, delay);
      timers.push(t);
      delay += 40; // 40 ms stagger between requests
    };

    // For each zoom level, prefetch the 3×3 tile grid centred on position
    const ZOOMS = [14, 15, 16, 17];
    const RADIUS = 1; // tiles on each side

    for (const z of ZOOMS) {
      const tx = lon2tile(lng, z);
      const ty = lat2tile(lat, z);
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        for (let dy = -RADIUS; dy <= RADIUS; dy++) {
          const subdomains = ["a", "b", "c"];
          const s = subdomains[(Math.abs(tx + dx + ty + dy)) % 3];
          prefetch(
            `https://${s}.tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png`,
          );
        }
      }
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [lat, lng]);
}
