import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from "react-native";
import * as Location from "expo-location";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { LiveMap } from "@/components/live/LiveMap";
import { LiveVideoPlayer } from "@/components/live/LiveVideoPlayer";
import { DirectionalBetPad } from "@/components/live/DirectionalBetPad";
import { MarketComposerSheet } from "@/components/live/MarketComposerSheet";
import { TransportModeIcon } from "@/components/live/TransportModeIcon";
import { useCountdown } from "@/hooks/useCountdown";
import {
  useDriverRoute,
  useGoogleGeoContext,
  useLiveRoom,
  usePlaceBet,
  useRoutePoints,
} from "@/hooks/useLiveRoom";
import { blurOnWeb } from "@/lib/blurOnWeb";
import { useMapTilePreload } from "@/hooks/useMapTilePreload";
import { useLiveMapStale } from "@/hooks/useLiveMapStale";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import type { RoutePoint } from "@/types/live";
import { BET_LOCK_DISTANCE_M, metersBetween } from "@/lib/geo";

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
  const { roomId, sessionId: routeSessionId, mode } = useLocalSearchParams<{
    roomId: string;
    sessionId?: string;
    mode?: string;
  }>();
  const isDriverMode = mode === "driver";
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
  // Keep map as the default fullscreen layer (web parity for room navigation in-app).
  const [mapExpanded, setMapExpanded] = useState(true);
  const [mapFollow, setMapFollow] = useState(true);
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
  const timeLocked = currentMarket
    ? Date.parse(currentMarket.locksAt) <= Date.now()
    : true;
  // Distance gate (mirrors web): bets close once the vehicle is within
  // BET_LOCK_DISTANCE_M of the turn point, regardless of clock. Use the
  // market's stored turn point when present; fall back to the next
  // driver-route pin so the gate still works while a market is being
  // (re)opened.
  const distanceLocked = (() => {
    const last =
      (room.data?.routePoints?.[room.data.routePoints.length - 1]) ??
      (routePoints.data?.[routePoints.data.length - 1]);
    if (!last) return false;
    const turn =
      currentMarket?.turnPointLat != null && currentMarket?.turnPointLng != null
        ? { lat: currentMarket.turnPointLat, lng: currentMarket.turnPointLng }
        : driverRoute.data?.pins?.[0]
          ? { lat: driverRoute.data.pins[0].lat, lng: driverRoute.data.pins[0].lng }
          : null;
    if (!turn) return false;
    return metersBetween({ lat: last.lat, lng: last.lng }, turn) <= BET_LOCK_DISTANCE_M;
  })();
  const locked = timeLocked || distanceLocked;

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
  const googleGeo = useGoogleGeoContext(lastResolved?.lat ?? null, lastResolved?.lng ?? null);
  const mapStale = useLiveMapStale({
    lat: lastResolved?.lat,
    lng: lastResolved?.lng,
    requireMovement: isOwnLiveSession,
    speedMps: lastResolved?.speedMps,
    staleAfterMs: isOwnLiveSession ? 25_000 : 40_000,
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
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Map layer — always mounted so camera state is not reset on PiP swap */}
      <View
        style={
          mapExpanded
            ? { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 5 }
            : { position: "absolute", left: 12, top: 130, width: 144, height: 144, zIndex: 30, borderRadius: 16, overflow: "hidden" }
        }
      >
        <LiveMap
          routePoints={resolvedRoutePoints}
          mapResetKey={mapResetKey}
          followDriver={mapFollow}
          followZoom={isDriverMode ? 17 : 16}
          showGuidanceLine={isDriverMode}
          onUserInteract={() => setMapFollow(false)}
          driverRoute={
            driverRoute.data
              ? {
                  // Show only the next pin (`pins[0]`). The backend
                  // keeps a queue of 3 internally for stable lookahead;
                  // the rest are not rendered.
                  pin: driverRoute.data.pins?.[0]
                    ? {
                        lat: driverRoute.data.pins[0].lat,
                        lng: driverRoute.data.pins[0].lng,
                        distanceMeters: driverRoute.data.pins[0].distanceMeters,
                      }
                    : null,
                  approachLine: driverRoute.data.approachLine ?? [],
                }
              : null
          }
          zones={isDriverMode ? [] : (googleGeo.data?.zones ?? [])}
          checkpoints={isDriverMode ? [] : (googleGeo.data?.checkpoints ?? [])}
        />
      </View>

      {/* Video layer — always mounted; WebRTC connection persists through PiP swaps */}
      <View
        style={
          mapExpanded
            ? { position: "absolute", left: 12, top: 130, width: 144, height: 144, zIndex: 30, borderRadius: 16, overflow: "hidden" }
            : { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 5 }
        }
      >
        <LiveVideoPlayer
          liveSessionId={effectiveSessionId}
          localStream={isOwnLiveSession ? localBroadcastStream : null}
        />
      </View>

      {/* Top gradient scrim */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0, right: 0, top: 0,
          height: 160,
          zIndex: 10,
        }}
      />

      {/* Top bar */}
      <SafeAreaView edges={["top"]} style={{ position: "absolute", left: 0, right: 0, top: 0, zIndex: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Pressable
            onPress={blurOnWeb(() => router.back())}
            accessibilityLabel="Close live room"
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: "#fff", fontSize: 18 }}>✕</Text>
          </Pressable>
          <View style={{ borderRadius: 4, backgroundColor: "rgba(239,68,68,0.3)", paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: "#f87171", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 }}>LIVE</Text>
          </View>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{data.characterName}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <TransportModeIcon mode={data.transportMode} className="text-sm" />
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
              {String(data.transportMode).replace("_", " ")}
            </Text>
          </View>
          <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Pressable
              onPress={() => setShowComposer(true)}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
              accessibilityLabel="Propose market"
            >
              <Text style={{ color: "#fff", fontSize: 14 }}>＋</Text>
            </Pressable>
            <Pressable
              onPress={() => setBetAmount((n) => Math.max(1, n - 5))}
              style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>−</Text>
            </Pressable>
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700", minWidth: 40, textAlign: "center" }}>${betAmount}</Text>
            <Pressable
              onPress={() => setBetAmount((n) => n + 5)}
              style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>+</Text>
            </Pressable>
          </View>
        </View>
        {currentMarket ? (
          <View style={{ marginHorizontal: 16, marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, flex: 1 }} numberOfLines={1}>{currentMarket.title}</Text>
            <MarketTimer locksAt={currentMarket.locksAt} />
          </View>
        ) : null}
      </SafeAreaView>

      {/* Map controls */}
      {mapExpanded && !mapFollow ? (
        <View style={{ position: "absolute", right: 12, top: 160, zIndex: 45 }}>
          <Pressable
            onPress={blurOnWeb(() => setMapFollow(true))}
            accessibilityLabel="Recenter on streamer"
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "rgba(252,211,77,0.5)",
              backgroundColor: "rgba(245,158,11,0.35)",
              paddingHorizontal: 10,
              paddingVertical: 7,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fffbeb", fontSize: 11, fontWeight: "700" }}>
              ◎ Center on streamer
            </Text>
          </Pressable>
        </View>
      ) : null}
      {mapExpanded && mapStale ? (
        <View style={{ position: "absolute", left: 12, right: 56, top: 160, zIndex: 45, borderRadius: 10, borderWidth: 1, borderColor: "rgba(245,158,11,0.4)", backgroundColor: "rgba(245,158,11,0.15)", paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: "rgba(255,237,213,0.95)", fontSize: 11, textAlign: "center" }}>Map may be stuck — tap ↻ to refresh</Text>
        </View>
      ) : null}
      {mapExpanded && resolvedRoutePoints.length === 0 ? (
        <View style={{ position: "absolute", left: 12, right: 56, top: 160, zIndex: 45, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, textAlign: "center" }}>Waiting for location…</Text>
        </View>
      ) : null}

      {/* PiP decorative border (always at pip corner, non-interactive) */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 12, top: 130,
          width: 144, height: 144,
          zIndex: 31,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.25)",
        }}
      />
      {/* PiP swap button */}
      <Pressable
        onPress={() => setMapExpanded((v) => !v)}
        style={{
          position: "absolute",
          left: 12 + 144 - 32,
          top: 130 + 144 - 32,
          zIndex: 32,
          width: 26, height: 26, borderRadius: 13,
          backgroundColor: "rgba(0,0,0,0.7)",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Text style={{ color: "#fff", fontSize: 10 }}>⛶</Text>
      </Pressable>

      {/* Bottom gradient scrim */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220, zIndex: 10 }}
      />

      {/* Joystick / driver bar — plain View, guaranteed visible */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          paddingBottom: Math.max(insets.bottom, 6),
          paddingTop: 4,
          alignItems: "center",
        }}
        pointerEvents="box-none"
      >
        {isDriverMode ? (
          <DriverStatusBar
            routePoints={resolvedRoutePoints}
            sessionId={effectiveSessionId}
          />
        ) : (
          <>
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
              <Text style={{ marginTop: 4, fontSize: 11, color: "#f87171", textAlign: "center" }}>
                {betError}
              </Text>
            ) : null}
          </>
        )}
      </View>

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

function DriverStatusBar({
  routePoints,
  sessionId,
}: {
  routePoints: import("@/types/live").RoutePoint[];
  sessionId: string | null;
}) {
  const last = routePoints[routePoints.length - 1];
  const speedKmh = last?.speedMps != null ? Math.round(last.speedMps * 3.6) : null;

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: "rgba(239,68,68,0.35)",
        backgroundColor: "rgba(0,0,0,0.75)",
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 12,
      }}
    >
      {/* LIVE badge */}
      <View
        style={{
          borderRadius: 6,
          backgroundColor: "rgba(239,68,68,0.25)",
          paddingHorizontal: 8,
          paddingVertical: 3,
        }}
      >
        <Text
          style={{
            color: "#f87171",
            fontSize: 11,
            fontWeight: "800",
            letterSpacing: 1.5,
          }}
        >
          LIVE
        </Text>
      </View>

      {/* Speed */}
      <View style={{ alignItems: "center" }}>
        <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "700", lineHeight: 20 }}>
          {speedKmh ?? "—"}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 9, fontWeight: "600", letterSpacing: 0.5 }}>
          KM/H
        </Text>
      </View>

      {/* Points */}
      <View style={{ flex: 1 }}>
        <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
          {routePoints.length > 0 ? `${routePoints.length} pts recorded` : "Waiting for GPS…"}
        </Text>
        {sessionId ? (
          <Text style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }} numberOfLines={1}>
            {sessionId.slice(0, 8)}…
          </Text>
        ) : null}
      </View>

      {/* Driving indicator */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: "rgba(16,185,129,0.2)",
          borderWidth: 1,
          borderColor: "rgba(16,185,129,0.5)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 18 }}>🚗</Text>
      </View>
    </View>
  );
}
