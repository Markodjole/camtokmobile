import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useShareIntentContext } from "expo-share-intent";
import { parseSharedDestination } from "@/lib/parseSharedDestination";
import { useSharedDestinationStore } from "@/stores/sharedDestinationStore";
import { useAuth } from "@/providers/AuthProvider";

/**
 * Listens for Maps destinations shared into CamTok (share sheet) or opened
 * via deep link, then routes the rider to Go Live with destination prefilled.
 */
export function ShareDestinationBridge() {
  const router = useRouter();
  const { session } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent, isReady } =
    useShareIntentContext();
  const setPending = useSharedDestinationStore((s) => s.setPending);
  const setError = useSharedDestinationStore((s) => s.setError);
  const handlingRef = useRef(false);

  async function applySharedText(raw: string, navigate: boolean) {
    if (handlingRef.current) return;
    handlingRef.current = true;
    try {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log("[share-dest] incoming", {
          text: shareIntent.text?.slice(0, 200),
          webUrl: shareIntent.webUrl,
          type: shareIntent.type,
          meta: shareIntent.meta,
          raw: raw.slice(0, 240),
        });
      }
      const dest = await parseSharedDestination(raw);
      if (!dest) {
        setError(
          "Couldn’t read that Maps share. Tip: open the place → Share (not the route overview), or search in CamTok.",
        );
        return;
      }
      setPending(dest);
      if (navigate && session) {
        router.push("/live/go");
      }
    } finally {
      handlingRef.current = false;
    }
  }

  // Android / iOS share sheet → CamTok
  useEffect(() => {
    if (!isReady || !hasShareIntent) return;
    // Prefer full text (place name + URL). webUrl alone loses the label.
    const parts = [
      shareIntent.text?.trim(),
      shareIntent.webUrl?.trim(),
      typeof shareIntent.meta?.title === "string"
        ? shareIntent.meta.title.trim()
        : "",
    ].filter(Boolean) as string[];
    const raw = [...new Set(parts)].join("\n");
    if (!raw) {
      resetShareIntent(true);
      return;
    }
    void (async () => {
      await applySharedText(raw, true);
      resetShareIntent(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, hasShareIntent, shareIntent.webUrl, shareIntent.text]);

  // Deep links: camtok://destination?lat=&lng=&label= or maps https URL opened with CamTok
  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleUrl = (url: string | null) => {
      if (!url) return;
      void (async () => {
        try {
          const parsed = Linking.parse(url);
          const q = parsed.queryParams ?? {};
          const lat = Number(q.lat);
          const lng = Number(q.lng);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            setPending({
              lat,
              lng,
              label: String(q.label ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
              placeId: q.placeId ? String(q.placeId) : null,
              source: "share",
            });
            if (session) router.push("/live/go");
            return;
          }
        } catch {
          // fall through to generic parse
        }
        if (/maps\.google|google\.[^/]+\/maps|maps\.app\.goo\.gl|geo:/i.test(url)) {
          await applySharedText(url, true);
        }
      })();
    };

    void Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return null;
}
