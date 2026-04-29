import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  DriverRouteInstruction,
  LiveFeedRow,
  ProposeMarketInput,
  RoutePoint,
} from "@/types/live";

type GoogleGeoZone = {
  id: string;
  slug: string;
  name: string;
  kind: "district" | "corridor" | "mission-zone" | "restricted-zone";
  color: string;
  isActive: boolean;
  polygon: Array<{ lat: number; lng: number }>;
};

type GoogleGeoCheckpoint = {
  id: string;
  name: string;
  kind: "bridge" | "square" | "landmark" | "crossing" | "poi";
  lat: number;
  lng: number;
  isActive: boolean;
};

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

export function useGoogleGeoContext(lat: number | null, lng: number | null) {
  return useQuery({
    queryKey: ["google-geo-context", lat, lng],
    enabled: lat != null && lng != null,
    queryFn: async ({ signal }) => {
      return apiFetch<{
        zones: GoogleGeoZone[];
        checkpoints: GoogleGeoCheckpoint[];
        source?: string;
        reason?: string;
      }>(`/api/live/google-geo-context?lat=${lat}&lng=${lng}`, {
        signal,
        anonymous: true,
      });
    },
    refetchInterval: 4000,
    staleTime: 3000,
  });
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
