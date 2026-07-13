import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { LiveFeedRow } from "@/types/live";

/**
 * Live feed polling — unused on rider-only mobile (viewer tab redirects).
 * Kept for optional re-enable; disabled by default so it never hits the network.
 */
export function useLiveFeed(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["live-feed"],
    enabled: opts?.enabled === true,
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
