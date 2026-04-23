import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { DriverRouteInstruction, LiveRoomDetail } from "@/types/live";

export function useLiveRoom(roomId: string | null) {
  return useQuery({
    queryKey: ["live-room", roomId],
    enabled: !!roomId,
    queryFn: async ({ signal }) => {
      const res = await apiFetch<{ room: LiveRoomDetail | null }>(
        `/api/live/rooms/${roomId}/state`,
        { signal },
      );
      return res.room;
    },
    // Poll pretty aggressively so the map + market stays fresh. The Next.js
    // route is cheap — it's what the web app polls too.
    refetchInterval: 1_500,
  });
}

export function useDriverRoute(roomId: string | null) {
  return useQuery({
    queryKey: ["driver-route", roomId],
    enabled: !!roomId,
    queryFn: async ({ signal }) => {
      const res = await apiFetch<{ instruction: DriverRouteInstruction | null }>(
        `/api/live/rooms/${roomId}/driver-route`,
        { signal },
      );
      return res.instruction;
    },
    refetchInterval: 2_000,
  });
}

export function usePlaceBet(roomId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      marketId: string;
      optionId: string;
      stake: number;
    }) => {
      return apiFetch<{ ok: true; walletBalance: number }>(
        `/api/live/rooms/${roomId}/bet`,
        {
          method: "POST",
          body: vars,
        },
      );
    },
    onSuccess: () => {
      if (roomId) qc.invalidateQueries({ queryKey: ["live-room", roomId] });
    },
  });
}
