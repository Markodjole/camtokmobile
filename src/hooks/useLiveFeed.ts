import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { LiveFeedItem } from "@/types/live";

export function useLiveFeed() {
  return useQuery({
    queryKey: ["live-feed"],
    queryFn: async ({ signal }) => {
      const res = await apiFetch<{ items: LiveFeedItem[] }>(
        "/api/live/feed",
        { signal },
      );
      return res.items;
    },
    // Feed list refreshes every 10 s while the user looks at it.
    refetchInterval: 10_000,
  });
}
