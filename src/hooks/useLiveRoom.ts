import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  CityGridSpec,
  DriverRouteInstruction,
  GridCell,
  LiveFeedRow,
  ProposeMarketInput,
  RoutePoint,
} from "@/types/live";

export function useLiveRoom(roomId: string | null) {
  return useQuery({
    queryKey: ["live-room", roomId],
    enabled: !!roomId,
    queryFn: async ({ signal }) => {
      const res = await apiFetch<{ room: LiveFeedRow | null }>(
        `/api/live/rooms/${roomId}/state`,
        { signal, anonymous: true },
      );
      return res.room;
    },
    refetchInterval: 700,
    staleTime: 1_000,
  });
}

export function useRoutePoints(sessionId: string | null) {
  return useQuery({
    queryKey: ["route-points", sessionId],
    enabled: !!sessionId,
    queryFn: async ({ signal }) => {
      const res = await apiFetch<{ points: RoutePoint[] }>(
        `/api/live/sessions/${sessionId}/route-points`,
        { signal, anonymous: true },
      );
      return res.points;
    },
    refetchInterval: 450,
    staleTime: 1_000,
  });
}

export function useDriverRoute(roomId: string | null) {
  return useQuery({
    queryKey: ["driver-route", roomId],
    enabled: !!roomId,
    queryFn: async ({ signal }) => {
      const res = await apiFetch<{ instruction: DriverRouteInstruction | null }>(
        `/api/live/rooms/${roomId}/driver-route`,
        { signal, anonymous: true },
      );
      return res.instruction;
    },
    refetchInterval: 450,
    staleTime: 1_000,
  });
}

function colLabel(col: number): string {
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Memoized: derives 500 m grid cells from a `CityGridSpec` for a viewport
 * centered on (lat, lng) ± 0.008°. Pure computation — no network call.
 * Rounded lat/lng to 3 dp so the list only rebuilds when the driver has
 * moved ~110 m (avoids every-GPS-tick re-renders).
 */
export function useCityGridCells(
  spec: CityGridSpec | null | undefined,
  lat: number | null,
  lng: number | null,
): GridCell[] {
  const rLat = lat != null ? Math.round(lat * 1000) / 1000 : null;
  const rLng = lng != null ? Math.round(lng * 1000) / 1000 : null;

  return useMemo<GridCell[]>(() => {
    if (!spec || rLat == null || rLng == null) return [];
    const pad = 0.008;
    const south = rLat - pad;
    const north = rLat + pad;
    const west = rLng - pad;
    const east = rLng + pad;

    const col0 = Math.max(0, Math.floor((west - spec.swLng) / spec.dLng));
    const col1 = Math.min(spec.nCols - 1, Math.ceil((east - spec.swLng) / spec.dLng) - 1);
    const row0 = Math.max(0, Math.floor((south - spec.swLat) / spec.dLat));
    const row1 = Math.min(spec.nRows - 1, Math.ceil((north - spec.swLat) / spec.dLat) - 1);
    if (col0 > col1 || row0 > row1) return [];

    const cells: GridCell[] = [];
    for (let col = col0; col <= col1; col += 1) {
      for (let row = row0; row <= row1; row += 1) {
        const w = spec.swLat + row * spec.dLat;
        const s = spec.swLng + col * spec.dLng;
        const nLat = w + spec.dLat;
        const eLng = s + spec.dLng;
        cells.push({
          id: `grid:r${row}:c${col}`,
          label: `${colLabel(col)}${row + 1}`,
          row,
          col,
          polygon: [
            { lat: w, lng: s },
            { lat: w, lng: eLng },
            { lat: nLat, lng: eLng },
            { lat: nLat, lng: s },
          ],
        });
      }
    }
    return cells;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.swLat, spec?.swLng, spec?.dLat, spec?.dLng, spec?.nCols, spec?.nRows, rLat, rLng]);
}

export function usePlaceBet(roomId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      marketId: string;
      optionId: string;
      stakeAmount: number;
    }) => {
      return apiFetch<{ ok: true }>(`/api/live/rooms/${roomId}/bet`, {
        method: "POST",
        body: vars,
      });
    },
    onSuccess: () => {
      if (roomId) qc.invalidateQueries({ queryKey: ["live-room", roomId] });
    },
  });
}

export function useProposeMarket() {
  return useMutation({
    mutationFn: async (input: ProposeMarketInput) => {
      const { roomId, ...payload } = input;
      return apiFetch<{ proposalId: string }>(
        `/api/live/rooms/${roomId}/markets/propose`,
        { method: "POST", body: payload },
      );
    },
  });
}
