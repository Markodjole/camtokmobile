import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import * as Location from "expo-location";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { LiveMap } from "@/components/live/LiveMap";
import { LiveVideoPlayer } from "@/components/live/LiveVideoPlayer";
import { LiveModeSwitch } from "@/components/live/LiveModeSwitch";
import { DirectionalBetPad } from "@/components/live/DirectionalBetPad";
import { MarketComposerSheet } from "@/components/live/MarketComposerSheet";
import { TransportModeIcon } from "@/components/live/TransportModeIcon";
import { useCountdown } from "@/hooks/useCountdown";
import {
  useDriverRoute,
  useLiveRoom,
  usePlaceBet,
  useRoutePoints,
} from "@/hooks/useLiveRoom";
import { blurOnWeb } from "@/lib/blurOnWeb";
import { useMapTilePreload } from "@/hooks/useMapTilePreload";
import { useLiveMapStale } from "@/hooks/useLiveMapStale";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import type { RoutePoint } from "@/types/live";

/**
 * Mobile twin of `apps/web/src/components/live/LiveRoomScreen.tsx`.
 *
 * Layout:
 *   - Fullscreen layer: video (default) or map (when `mapExpanded`)
 *   - Top bar: LIVE badge, character name, transport mode, bet stepper,
 *              map/video swap, market composer shortcut.
 *   - PiP corner: the other view (map when video is fullscreen, camera
 *                 when map is fullscreen).
 *   - Bottom: directional bet pad pinned above the home indicator.
 */
export default function RoomScreen() {
  const { roomId, sessionId: routeSessionId } = useLocalSearchParams<{
    roomId: string;
    sessionId?: string;
  }>();
  const router = useRouter();

  const room = useLiveRoom(roomId ?? null);
  const effectiveSessionId = room.data?.liveSessionId ?? routeSessionId ?? null;
  const routePoints = useRoutePoints(effectiveSessionId);
  const driverRoute = useDriverRoute(roomId ?? null);
  const placeBet = usePlaceBet(roomId ?? null);
  const localBroadcastSessionId = useLiveBroadcastStore((s) => s.sessionId);
  const localBroadcastStream = useLiveBroadcastStore((s) => s.localStream);
  const localBroadcastRoutePoints = useLiveBroadcastStore((s) => s.routePoints);

  // Pre-fetch map tiles for the driver's current location the moment we know it
  const firstPoint = room.data?.routePoints?.[0] ?? routePoints.data?.[0];
  useMapTilePreload(firstPoint?.lat, firstPoint?.lng);

  const [betAmount, setBetAmount] = useState(10);
  const [mapExpanded, setMapExpanded] = useState(Platform.OS !== "web");
  const [showComposer, setShowComposer] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [roomLocalPoints, setRoomLocalPoints] = useState<RoutePoint[]>([]);
  const [mapResetKey, setMapResetKey] = useState(0);
  const isOwnLiveSession =
    !!effectiveSessionId && localBroadcastSessionId === effectiveSessionId;

  useEffect(() => {
    if (!isOwnLiveSession) {
      setRoomLocalPoints([]);
      return;
    }

    let cancelled = false;
    let watcher: Location.LocationSubscription | null = null;

    const start = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== "granted") return;

        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) {
            setRoomLocalPoints((prev) => [
              ...prev.slice(-199),
              {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                heading:
                  pos.coords.heading != null && !Number.isNaN(pos.coords.heading)
                    ? pos.coords.heading
                    : undefined,
                speedMps:
                  pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
                    ? pos.coords.speed
                    : undefined,
              },
            ]);
          }
        } catch {
          // Ignore seed failure; watcher below can still provide points.
        }

        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Highest,
            timeInterval: 450,
            distanceInterval: 0,
          },
          (pos) => {
            if (cancelled) return;
            setRoomLocalPoints((prev) => [
              ...prev.slice(-199),
              {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                heading:
                  pos.coords.heading != null && !Number.isNaN(pos.coords.heading)
                    ? pos.coords.heading
                    : undefined,
                speedMps:
                  pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
                    ? pos.coords.speed
                    : undefined,
              },
            ]);
          },
        );
      } catch {
        // No-op: other route point sources may still fill in.
      }
    };

    void start();
    return () => {
      cancelled = true;
      watcher?.remove();
    };
  }, [isOwnLiveSession]);

  const currentMarket = room.data?.currentMarket ?? null;
  const locked = currentMarket
    ? Date.parse(currentMarket.locksAt) <= Date.now()
    : true;

  const resolvedRoutePoints = useMemo(() => {
    if (!room.data) return [];
    const rdata = room.data;
    return isOwnLiveSession
      ? localBroadcastRoutePoints.length > 0
        ? localBroadcastRoutePoints
        : roomLocalPoints.length > 0
          ? roomLocalPoints
          : routePoints.data && routePoints.data.length > 0
            ? routePoints.data
            : (rdata.routePoints ?? [])
      : routePoints.data && routePoints.data.length > 0
        ? routePoints.data
        : (rdata.routePoints ?? []);
  }, [
    room.data,
    isOwnLiveSession,
    localBroadcastRoutePoints,
    roomLocalPoints,
    routePoints.data,
  ]);

  const lastResolved = resolvedRoutePoints[resolvedRoutePoints.length - 1];
  const mapStale = useLiveMapStale({
    lat: lastResolved?.lat,
    lng: lastResolved?.lng,
    requireMovement: isOwnLiveSession,
    speedMps: lastResolved?.speedMps,
    staleAfterMs: isOwnLiveSession ? 10_000 : 18_000,
    enabled: resolvedRoutePoints.length > 0,
  });

  const refreshMap = useCallback(() => {
    setMapResetKey((k) => k + 1);
    if (isOwnLiveSession) {
      void (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Highest,
          });
          setRoomLocalPoints((prev) => [
            ...prev.slice(-199),
            {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading:
                pos.coords.heading != null && !Number.isNaN(pos.coords.heading)
                  ? pos.coords.heading
                  : undefined,
              speedMps:
                pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
                  ? pos.coords.speed
                  : undefined,
            },
          ]);
        } catch {
          // ignore
        }
      })();
    }
    void room.refetch();
    void routePoints.refetch();
    void driverRoute.refetch();
  }, [isOwnLiveSession, room, routePoints, driverRoute]);

  async function handleBet(optionId: string) {
    if (!currentMarket || !roomId) return;
    setBetError(null);
    try {
      await placeBet.mutateAsync({
        marketId: currentMarket.id,
        optionId,
        stakeAmount: betAmount,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bet failed";
      setBetError(msg);
      Alert.alert("Bet failed", msg);
    }
  }

  if (room.isLoading && !room.data) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  if (!room.data) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-6">
        <Stack.Screen options={{ headerShown: false }} />
        <Text className="text-center text-base text-white">
          This live room is no longer active.
        </Text>
        <Pressable
          onPress={blurOnWeb(() => router.back())}
          className="mt-4 rounded-2xl bg-primary px-5 py-2"
        >
          <Text className="text-sm font-semibold text-white">Back</Text>
        </Pressable>
      </View>
    );
  }

  const data = room.data;

  return (
    <View className="relative flex-1 bg-black">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Fullscreen layer: video or map */}
      <View className="absolute inset-0">
        {mapExpanded ? (
          <LiveMap
            routePoints={resolvedRoutePoints}
            mapResetKey={mapResetKey}
            driverRoute={
              driverRoute.data
                ? {
                    turnPoint: driverRoute.data.turnPoint,
                    checkpoint: driverRoute.data.checkpoint,
                    routePolyline: driverRoute.data.routePolyline,
                  }
                : null
            }
          />
        ) : (
          <LiveVideoPlayer
            liveSessionId={effectiveSessionId}
            localStream={isOwnLiveSession ? localBroadcastStream : null}
          />
        )}
      </View>

      {mapExpanded ? (
        <View className="absolute right-3 top-28 z-[45] max-w-[40%] items-end">
          <Pressable
            onPress={blurOnWeb(refreshMap)}
            accessibilityLabel="Refresh map and location"
            className="h-10 min-w-10 items-center justify-center rounded-full bg-black/70 px-2 active:opacity-80"
          >
            <Text className="text-lg text-white">↻</Text>
          </Pressable>
        </View>
      ) : null}
      {mapExpanded && mapStale ? (
        <View className="absolute left-3 right-3 top-40 z-[45] rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2">
          <Text className="text-center text-xs text-amber-100/95">
            Map may be stuck — tap ↻ to refresh
          </Text>
        </View>
      ) : null}
      {mapExpanded && resolvedRoutePoints.length === 0 ? (
        <View className="absolute left-3 right-3 top-40 z-[45] rounded-xl border border-white/20 bg-black/50 px-3 py-2">
          <Text className="text-center text-xs text-white/85">
            Waiting for location… tap ↻ if it stays empty
          </Text>
        </View>
      ) : null}

      {/* Top bar */}
      <SafeAreaView edges={["top"]} className="absolute inset-x-0 top-0 z-40">
        <View className="px-4 pb-1 pt-1">
          <LiveModeSwitch />
        </View>
        <View className="flex-row items-center gap-2 px-4 py-2">
          <Pressable
            onPress={blurOnWeb(() => router.back())}
            accessibilityLabel="Close live room"
            className="h-9 w-9 items-center justify-center rounded-full bg-black/60"
          >
            <Text className="text-xl text-white">✕</Text>
          </Pressable>
          <View className="rounded bg-red-500/30 px-2 py-0.5">
            <Text className="text-[11px] font-bold tracking-wider text-red-400">
              LIVE
            </Text>
          </View>
          <Text className="font-semibold text-white">{data.characterName}</Text>
          <View className="flex-row items-center gap-1">
            <TransportModeIcon mode={data.transportMode} className="text-sm" />
            <Text className="text-xs text-white/60">
              {String(data.transportMode).replace("_", " ")}
            </Text>
          </View>

          <View className="ml-auto flex-row items-center gap-1.5">
            <Pressable
              onPress={() => setShowComposer(true)}
              className="h-8 w-8 items-center justify-center rounded-full bg-white/15 active:bg-white/30"
              accessibilityLabel="Propose market"
            >
              <Text className="text-xs text-white">＋</Text>
            </Pressable>
            <Pressable
              onPress={() => setBetAmount((n) => Math.max(1, n - 5))}
              className="h-7 w-7 items-center justify-center rounded-full bg-white/15 active:bg-white/30"
              accessibilityLabel="Decrease bet"
            >
              <Text className="text-sm font-bold text-white">−</Text>
            </Pressable>
            <Text className="min-w-[44px] text-center text-sm font-semibold text-white">
              ${betAmount}
            </Text>
            <Pressable
              onPress={() => setBetAmount((n) => n + 5)}
              className="h-7 w-7 items-center justify-center rounded-full bg-white/15 active:bg-white/30"
              accessibilityLabel="Increase bet"
            >
              <Text className="text-sm font-bold text-white">+</Text>
            </Pressable>
          </View>
        </View>

        {currentMarket ? (
          <View className="mx-4 mt-1 flex-row items-center justify-between rounded-full bg-black/50 px-3 py-1.5">
            <Text className="text-xs text-white/85">{currentMarket.title}</Text>
            <MarketTimer locksAt={currentMarket.locksAt} />
          </View>
        ) : null}
      </SafeAreaView>

      {/* PiP corner */}
      <View className="absolute left-3 top-24 h-40 w-40 overflow-hidden rounded-2xl border border-white/25 bg-black/60 shadow-xl">
        {mapExpanded ? (
          <LiveVideoPlayer
            liveSessionId={effectiveSessionId}
            localStream={isOwnLiveSession ? localBroadcastStream : null}
          />
        ) : (
          <LiveMap
            routePoints={resolvedRoutePoints}
            mapResetKey={mapResetKey}
            driverRoute={
              driverRoute.data
                ? {
                    turnPoint: driverRoute.data.turnPoint,
                    checkpoint: driverRoute.data.checkpoint,
                    routePolyline: driverRoute.data.routePolyline,
                  }
                : null
            }
          />
        )}
        <Pressable
          onPress={() => setMapExpanded((v) => !v)}
          accessibilityLabel={
            mapExpanded ? "Show camera fullscreen" : "Show map fullscreen"
          }
          className="absolute bottom-1.5 right-1.5 h-7 w-7 items-center justify-center rounded-full bg-black/70"
        >
          <Text className="text-[10px] text-white">⛶</Text>
        </Pressable>
      </View>

      {/* Bottom joystick */}
      <SafeAreaView edges={["bottom"]} className="absolute inset-x-0 bottom-0 z-50">
        <View className="items-center pb-4">
          <DirectionalBetPad
            options={currentMarket?.options ?? []}
            betAmount={betAmount}
            onBet={async (optionId) => {
              await handleBet(optionId);
            }}
            locked={locked || !currentMarket || placeBet.isPending}
            routePoints={resolvedRoutePoints}
          />
          {betError ? (
            <Text className="mt-1 text-[11px] text-red-400">{betError}</Text>
          ) : null}
        </View>
      </SafeAreaView>

      {roomId ? (
        <MarketComposerSheet
          roomId={roomId}
          visible={showComposer}
          onClose={() => setShowComposer(false)}
        />
      ) : null}
    </View>
  );
}

function MarketTimer({ locksAt }: { locksAt: string }) {
  const { secondsLeft, label } = useCountdown(locksAt);
  const color =
    secondsLeft <= 0
      ? "text-red-400"
      : secondsLeft < 10
        ? "text-amber-400"
        : "text-white/70";
  return (
    <Text className={`text-xs font-semibold ${color}`}>
      {secondsLeft <= 0 ? "locked" : label}
    </Text>
  );
}
