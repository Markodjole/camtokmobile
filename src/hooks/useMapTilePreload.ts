// Native stub — tile preloading is handled by the OS map cache (Apple Maps /
// Google Maps).  The hook is a no-op so callers don't need to branch.
export function useMapTilePreload(
  _lat: number | undefined,
  _lng: number | undefined,
) {
  // nothing to do on native
}
