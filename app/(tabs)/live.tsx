import React, { useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
  type ViewToken,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import { useCountdown } from "@/hooks/useCountdown";
import { transportEmoji } from "@/components/live/TransportModeIcon";
import { LiveModeSwitch } from "@/components/live/LiveModeSwitch";
import { blurOnWeb } from "@/lib/blurOnWeb";
import type { LiveFeedRow, LiveMarketSummary } from "@/types/live";

/**
 * Mobile twin of `apps/web/src/components/live/LiveFeedShell.tsx` — a
 * vertical snap-scroll of full-screen "rooms" with the LIVE badge,
 * character name, transport mode, region, status text, current market
 * strip, lock countdown, and a "Tap to watch & bet →" CTA.
 */
export default function LiveTab() {
  const { data, isLoading, refetch, isRefetching, error } = useLiveFeed();
  const router = useRouter();
  const visibleIndex = useRef(0);

  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) visibleIndex.current = first.index;
    },
    [],
  );

  if (isLoading && !data) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-6">
        <Text className="text-lg font-semibold text-white">
          Couldn't load the live feed
        </Text>
        <Text className="mt-1 text-center text-sm text-white/60">
          {error instanceof Error ? error.message : "Unknown error"}
        </Text>
      </View>
    );
  }

  const items = data ?? [];
  const height = Dimensions.get("window").height;

  if (items.length === 0) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-black">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-xl font-semibold text-white">
            No one is live yet.
          </Text>
          <Text className="mt-1 text-center text-sm text-white/60">
            Check back in a minute, or go live yourself.
          </Text>
          <Pressable
            onPress={blurOnWeb(() => router.push("/live/go"))}
            className="mt-6 rounded-2xl bg-primary px-5 py-3 active:bg-primary/80"
          >
            <Text className="text-sm font-semibold text-white">
              Start your live stream
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <SafeAreaView
        pointerEvents="box-none"
        edges={["top"]}
        className="absolute inset-x-0 top-0 z-50 px-4"
      >
        <View className="mt-2 flex-row items-center justify-end">
          <Pressable
            onPress={blurOnWeb(() => router.push("/live/go"))}
            className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5"
          >
            <Text className="text-xs font-bold text-emerald-200">Go live</Text>
          </Pressable>
        </View>
      </SafeAreaView>
      <FlatList
        data={items}
        keyExtractor={(it) => it.roomId}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToAlignment="start"
        decelerationRate="fast"
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        refreshControl={
          <RefreshControl
            tintColor="#ffffff"
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
          />
        }
        renderItem={({ item }) => (
          <View style={{ height }}>
            <LiveSnapSlide
              row={item}
              onOpen={() => router.push(`/room/${item.roomId}`)}
            />
          </View>
        )}
      />
    </View>
  );
}

function LiveSnapSlide({
  row,
  onOpen,
}: {
  row: LiveFeedRow;
  onOpen: () => void;
}) {
  return (
    <Pressable
      onPress={blurOnWeb(onOpen)}
      className="relative flex-1 bg-black"
      accessibilityLabel={`Open live room for ${row.characterName}`}
    >
      {/* Top gradient scrim */}
      <View className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-black/75" />
      {/* Bottom gradient scrim */}
      <View className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-black/85" />

      <SafeAreaView edges={["bottom"]} className="flex-1 justify-end px-5 pb-28">
        <View className="flex-row items-center gap-2">
          <View className="rounded-full border border-red-400/35 bg-red-500/30 px-2.5 py-1">
            <Text className="text-[11px] font-bold tracking-wider text-red-400">
              LIVE
            </Text>
          </View>
          <Text className="text-lg font-semibold text-white">
            {row.characterName}
          </Text>
        </View>

        <View className="mt-1 flex-row items-center gap-2">
          <Text className="text-sm text-white/80">
            {transportEmoji(row.transportMode)}{" "}
            {String(row.transportMode).replace("_", " ")}
          </Text>
          <Text className="text-xs text-white/50">
            · {row.viewerCount} watching
          </Text>
        </View>

        {row.statusText ? (
          <Text numberOfLines={2} className="mt-2 text-sm text-white/85">
            {row.statusText}
          </Text>
        ) : null}

        <Text className="mt-1 text-xs text-white/50">
          {row.regionLabel ?? "Unknown area"}
          {row.placeType ? ` · ${row.placeType}` : ""}
        </Text>

        <MarketStrip market={row.currentMarket} />

        <Text className="mt-6 text-center text-sm font-bold tracking-wide text-blue-300">
          Tap to watch & bet
        </Text>
      </SafeAreaView>
    </Pressable>
  );
}

function MarketStrip({ market }: { market: LiveMarketSummary | null }) {
  if (!market) {
    return (
      <Text className="mt-3 text-xs text-white/45">Waiting for next market…</Text>
    );
  }
  return (
    <View className="mt-3 flex-row items-center gap-2">
      <View className="rounded bg-primary/25 px-2 py-1">
        <Text className="text-xs font-medium text-white">{market.title}</Text>
      </View>
      <LockCountdown locksAt={market.locksAt} />
    </View>
  );
}

function LockCountdown({ locksAt }: { locksAt: string }) {
  const { secondsLeft, label } = useCountdown(locksAt);
  if (secondsLeft <= 0) {
    return <Text className="text-xs text-white/50">locked</Text>;
  }
  return <Text className="text-xs text-white/50">closes in {label}</Text>;
}
