import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { LiveFeedRow } from "@/types/live";

/**
 * Mirrors the web `LiveFeedShell` poll loop — every 4s the backend returns
 * the active live rooms view.
 */
export function useLiveFeed() {
  return useQuery({
    queryKey: ["live-feed"],
    queryFn: async ({ signal }) => {
      const res = await apiFetch<{ items: LiveFeedRow[] }>("/api/live/rooms", {
        signal,
        anonymous: true,
      });
      return res.items;
    },
    refetchInterval: 4_000,
    staleTime: 2_000,
  });
}
