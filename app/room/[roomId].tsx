import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from "react-native";
import * as Location from "expo-location";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  isAvailableAsync as isKeepAwakeAvailableAsync,
} from "expo-keep-awake";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { LiveMap } from "@/components/live/LiveMap";
import { BroadcasterCameraPreview } from "@/components/live/BroadcasterCameraPreview";
import { streamPipDimensions } from "@/components/live/SquareTopVideoFrame";
import { DirectionalBetPad } from "@/components/live/DirectionalBetPad";
import { MarketComposerSheet } from "@/components/live/MarketComposerSheet";
import { TransportModeIcon } from "@/components/live/TransportModeIcon";
import { useCountdown } from "@/hooks/useCountdown";
import {
  useDestinationRoute,
  useDriverRoute,
  useCityGridCells,
  useLiveRoom,
  usePlaceBet,
  useRoutePoints,
} from "@/hooks/useLiveRoom";
import { blurOnWeb } from "@/lib/blurOnWeb";
import { apiFetch } from "@/lib/api";
import { useMapTilePreload } from "@/hooks/useMapTilePreload";
import { useLiveMapStale } from "@/hooks/useLiveMapStale";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import type { RoutePoint } from "@/types/live";
import { BET_LOCK_DISTANCE_M, metersBetween } from "@/lib/geo";
import {
  buildRouteToPinPolyline,
  inferTurnDirectionFromApproach,
  inferTurnDirectionFromRoute,
  trimPolylineAhead,
} from "@/lib/routeGeometry";
import { TurnBlinkOverlay } from "@/components/live/TurnBlinkOverlay";
import {
  drivingRouteStyleBadges,
  normalizeDrivingRouteStyle,
} from "@/lib/drivingRouteStyle";

const TURN_ARROW_MAX_M = 50;
const TURN_ARROW_MIN_M = 8;

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
  const localBroadcastSessionId = useLiveBroadcastStore((s) => s.sessionId);
  const localBroadcastRoutePoints = useLiveBroadcastStore((s) => s.routePoints);
  const clearBroadcastStore = useLiveBroadcastStore((s) => s.clear);

  // Rider-only: only load room data for driver mode / own session.
  const isLikelyRider =
    isDriverMode ||
    (!!routeSessionId &&
      !!localBroadcastSessionId &&
      routeSessionId === localBroadcastSessionId);

  const room = useLiveRoom(isLikelyRider ? (roomId ?? null) : null);
  const effectiveSessionId = room.data?.liveSessionId ?? routeSessionId ?? null;
  const isOwnLiveSession =
    !!effectiveSessionId && localBroadcastSessionId === effectiveSessionId;
  /** Rider = own live session / driver mode — nav only, no betting UI. */
  const isRider = isDriverMode || isOwnLiveSession;

  // Own GPS replaces remote route-point polling for the rider.
  const routePoints = useRoutePoints(effectiveSessionId, {
    enabled: isLikelyRider && !isRider,
  });
  const driverRoute = useDriverRoute(roomId ?? null, {
    enabled: isLikelyRider && isRider,
  });
  const placeBet = usePlaceBet(null);

  // Pre-fetch map tiles
  const firstPoint = room.data?.routePoints?.[0] ?? routePoints.data?.[0];
  useMapTilePreload(firstPoint?.lat, firstPoint?.lng);

  const [betAmount, setBetAmount] = useState(10);
  // Keep map as the default fullscreen layer (web parity for room navigation in-app).
  const [mapExpanded, setMapExpanded] = useState(true);
  // Free pan/zoom by default — follow mode fights gestures on Android.
  const [mapFollow, setMapFollow] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [endingDriverSession, setEndingDriverSession] = useState(false);
  const [roomLocalPoints, setRoomLocalPoints] = useState<RoutePoint[]>([]);
  const [mapResetKey, setMapResetKey] = useState(0);
  // Bounce viewer deep-links — mobile is rider/driver only.
  useEffect(() => {
    if (isLikelyRider) return;
    router.replace("/live/go");
  }, [isLikelyRider, router]);

  // Keep screen awake only while in a live room. Global useKeepAwake() throws
  // "Unable to activate keep awake" on Android when the Activity isn't ready.
  useEffect(() => {
    const tag = "camtok-live-room";
    let active = true;
    void (async () => {
      try {
        if (!(await isKeepAwakeAvailableAsync()) || !active) return;
        await activateKeepAwakeAsync(tag);
      } catch {
        // Non-fatal — Android can reject when Activity is inactive.
      }
    })();
    return () => {
      active = false;
      void deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, []);

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
    // City grid markets use time-only locking — no turn-point distance gate.
    if (currentMarket?.marketType === "city_grid") return false;
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

  const driverTurnPoint = useMemo(() => {
    if (
      currentMarket?.turnPointLat != null &&
      currentMarket?.turnPointLng != null
    ) {
      return {
        lat: currentMarket.turnPointLat,
        lng: currentMarket.turnPointLng,
      };
    }
    const pin = driverRoute.data?.pins?.[0];
    return pin ? { lat: pin.lat, lng: pin.lng } : null;
  }, [
    currentMarket?.turnPointLat,
    currentMarket?.turnPointLng,
    driverRoute.data?.pins,
  ]);

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

  const lastResolvedForRoute = resolvedRoutePoints[resolvedRoutePoints.length - 1];
  const destinationRoute = useDestinationRoute(roomId ?? null, {
    driver: lastResolvedForRoute
      ? { lat: lastResolvedForRoute.lat, lng: lastResolvedForRoute.lng }
      : null,
    destination: room.data?.destination
      ? { lat: room.data.destination.lat, lng: room.data.destination.lng }
      : null,
    transportMode: room.data?.transportMode ?? null,
  });

  /** Green committed path ahead of the vehicle once bets lock (driver mode). */
  const driverCommittedRoute = useMemo(() => {
    if (!isDriverMode || !currentMarket || !locked) return null;
    if (currentMarket.marketType === "city_grid") return null;
    const last = resolvedRoutePoints[resolvedRoutePoints.length - 1];
    if (!last || !driverTurnPoint) return null;

    const destPoly = destinationRoute.data?.route?.polyline;
    if (destPoly && destPoly.length >= 2) {
      return buildRouteToPinPolyline(destPoly, last, driverTurnPoint);
    }

    const approach = driverRoute.data?.approachLine ?? [];
    if (approach.length >= 2) {
      const ahead = trimPolylineAhead(approach, last);
      if (ahead.length >= 2) return ahead;
    }

    return [{ lat: last.lat, lng: last.lng }, driverTurnPoint];
  }, [
    isDriverMode,
    currentMarket,
    locked,
    resolvedRoutePoints,
    driverTurnPoint,
    destinationRoute.data?.route?.polyline,
    driverRoute.data?.approachLine,
  ]);

  /**
   * Blue line to the next CamTok turn instruction — updates whenever
   * /driver-route polls a new pin (not only inside the last 50 m).
   */
  const instructionRouteAhead = useMemo(() => {
    if (driverCommittedRoute) return null;
    if (currentMarket?.marketType === "city_grid") return null;
    const last = resolvedRoutePoints[resolvedRoutePoints.length - 1];
    if (!last || !driverTurnPoint) return null;

    const approach = driverRoute.data?.approachLine ?? [];
    if (approach.length >= 2) {
      const ahead = trimPolylineAhead(approach, last);
      if (ahead.length >= 2) return ahead;
    }

    const destPoly = destinationRoute.data?.route?.polyline;
    if (destPoly && destPoly.length >= 2) {
      const alongDest = buildRouteToPinPolyline(destPoly, last, driverTurnPoint);
      if (alongDest.length >= 2) return alongDest;
    }

    return [
      { lat: last.lat, lng: last.lng },
      { lat: driverTurnPoint.lat, lng: driverTurnPoint.lng },
    ];
  }, [
    driverCommittedRoute,
    currentMarket?.marketType,
    resolvedRoutePoints,
    driverTurnPoint,
    driverRoute.data?.approachLine,
    destinationRoute.data?.route?.polyline,
  ]);

  const driverTurnDistanceM = useMemo(() => {
    const pin = driverRoute.data?.pins?.[0];
    if (pin?.distanceMeters != null) return pin.distanceMeters;
    const last = resolvedRoutePoints[resolvedRoutePoints.length - 1];
    if (!last || !driverTurnPoint) return null;
    return metersBetween(last, driverTurnPoint);
  }, [driverRoute.data?.pins, resolvedRoutePoints, driverTurnPoint]);

  const driverTurnDirection = useMemo((): "left" | "right" | null => {
    const approach = driverRoute.data?.approachLine ?? [];
    if (approach.length >= 3 && driverTurnPoint) {
      const fromApproach = inferTurnDirectionFromApproach(approach, driverTurnPoint);
      if (fromApproach) return fromApproach;
    }
    if (driverCommittedRoute && driverCommittedRoute.length >= 3 && driverTurnPoint) {
      const fromRoute = inferTurnDirectionFromRoute(
        driverCommittedRoute,
        driverTurnPoint,
      );
      if (fromRoute) return fromRoute;
    }
    const opts = currentMarket?.options ?? [];
    const dirs = opts.flatMap((o) => {
      const s = `${o.label} ${o.shortLabel ?? ""}`.toLowerCase();
      if (s.includes("left")) return ["left"] as const;
      if (s.includes("right")) return ["right"] as const;
      return [];
    });
    const unique = [...new Set(dirs)];
    if (unique.length === 1) return unique[0]!;
    return null;
  }, [
    driverRoute.data?.approachLine,
    driverTurnPoint,
    driverCommittedRoute,
    currentMarket?.options,
  ]);

  const showDriverTurnArrows =
    isDriverMode &&
    locked &&
    !!currentMarket &&
    currentMarket.marketType !== "city_grid" &&
    driverTurnDirection != null &&
    driverTurnDistanceM != null &&
    driverTurnDistanceM <= TURN_ARROW_MAX_M &&
    driverTurnDistanceM > TURN_ARROW_MIN_M;

  const lastResolved = resolvedRoutePoints[resolvedRoutePoints.length - 1];
  const lastLat = lastResolved?.lat ?? null;
  const lastLng = lastResolved?.lng ?? null;
  const gridAnchorLat = lastLat ?? currentMarket?.turnPointLat ?? null;
  const gridAnchorLng = lastLng ?? currentMarket?.turnPointLng ?? null;
  const cityGridSpec =
    !isRider && currentMarket?.marketType === "city_grid"
      ? (currentMarket.cityGridSpec ?? null)
      : null;
  const cityGridCells = useCityGridCells(cityGridSpec, gridAnchorLat, gridAnchorLng);
  const [selectedGridCellId, setSelectedGridCellId] = useState<string | null>(null);

  // Clear selected cell whenever a new market opens.
  const currentMarketId = currentMarket?.id ?? null;
  useEffect(() => {
    setSelectedGridCellId(null);
  }, [currentMarketId]);

  const gridZones = useMemo(
    () =>
      isDriverMode || !showZones
        ? []
        : cityGridCells.map((c) => ({
            id: c.id,
            name: c.label,
            color: `hsl(${(c.col * 37 + c.row * 17) % 360} 52% 42%)`,
            polygon: c.polygon,
            isActive: true,
          })),
    [isDriverMode, showZones, cityGridCells],
  );

  const driverRouteBadges = useMemo(() => {
    if (isRider) return null;
    const d = room.data;
    if (!d) return [];
    return drivingRouteStyleBadges(
      normalizeDrivingRouteStyle(d.drivingRouteStyle),
      d.transportMode,
    );
  }, [
    isRider,
    room.data?.transportMode,
    room.data?.drivingRouteStyle?.comfortVsSpeed,
    room.data?.drivingRouteStyle?.pathStyle,
    room.data?.drivingRouteStyle?.ecoConscious,
  ]);

  const riderGuidanceLabel = useMemo(() => {
    if (!isRider) return null;
    if (driverTurnDirection && driverTurnDistanceM != null) {
      const dir =
        driverTurnDirection === "left"
          ? "Turn left"
          : driverTurnDirection === "right"
            ? "Turn right"
            : "Continue";
      const meters = Math.max(1, Math.round(driverTurnDistanceM));
      return `${dir} · ${meters} m`;
    }
    if (driverTurnPoint) return "Follow the blue line";
    if (room.data?.destination) return "Follow the red route";
    return "Waiting for next instruction…";
  }, [
    isRider,
    driverTurnDirection,
    driverTurnDistanceM,
    driverTurnPoint,
    room.data?.destination,
  ]);

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
    void destinationRoute.refetch();
  }, [isOwnLiveSession, room, routePoints, driverRoute, destinationRoute]);

  async function handleBet(optionId: string) {
    if (!currentMarket || !roomId) return;
    setBetError(null);
    try {
      await placeBet.mutateAsync({
        marketId: currentMarket.id,
        optionId,
        stakeAmount: betAmount,
      });
      if (currentMarket.marketType === "city_grid") {
        setSelectedGridCellId(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bet failed";
      setBetError(msg);
      Alert.alert("Bet failed", msg);
    }
  }

  async function handleEndDriverSession() {
    if (!effectiveSessionId || endingDriverSession) return;
    setEndingDriverSession(true);
    try {
      await apiFetch(`/api/live/sessions/${effectiveSessionId}/end`, {
        method: "POST",
        body: {},
      }).catch(() => undefined);
      clearBroadcastStore();
      router.replace("/live/go");
    } finally {
      setEndingDriverSession(false);
    }
  }

  if (!isLikelyRider) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#ffffff" />
      </View>
    );
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
  const pipSize = 124;
  const videoPip = streamPipDimensions(pipSize);
  const pipLeft = 12;
  const pipBottom = Math.max(insets.bottom + 72, 96);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Map layer — always mounted so camera state is not reset on PiP swap */}
      <View
        style={
          mapExpanded
            ? { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 5 }
            : {
                position: "absolute",
                left: pipLeft,
                bottom: pipBottom,
                width: pipSize,
                height: pipSize,
                zIndex: 30,
                borderRadius: 16,
                overflow: "hidden",
              }
        }
      >
        <LiveMap
          routePoints={resolvedRoutePoints}
          mapResetKey={mapResetKey}
          followDriver={mapFollow}
          followZoom={19}
          showGuidanceLine={isRider}
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
          destination={data.destination}
          destinationRoute={destinationRoute.data?.route?.polyline ?? null}
          committedRouteAhead={driverCommittedRoute}
          instructionRouteAhead={instructionRouteAhead}
          driverRouteBadges={driverRouteBadges}
          zones={gridZones}
          checkpoints={[]}
          selectedZoneId={selectedGridCellId}
          onZoneSelect={
            isDriverMode || currentMarket?.marketType !== "city_grid"
              ? undefined
              : (id) => setSelectedGridCellId(id)
          }
        />
        {showDriverTurnArrows && driverTurnDirection ? (
          <TurnBlinkOverlay
            direction={driverTurnDirection}
            distanceM={driverTurnDistanceM}
            urgent={driverTurnDistanceM != null && driverTurnDistanceM <= 25}
          />
        ) : null}
      </View>

      {/* Video layer — top-crop preview at encoded aspect; WebRTC persists through PiP swaps */}
      <View
        style={
          mapExpanded
            ? {
                position: "absolute",
                left: pipLeft,
                bottom: pipBottom,
                width: videoPip.width,
                height: videoPip.height,
                zIndex: 30,
                borderRadius: 16,
                overflow: "hidden",
              }
            : { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 5 }
        }
      >
        {isOwnLiveSession || isDriverMode ? (
          <BroadcasterCameraPreview
            liveSessionId={effectiveSessionId}
            facing="back"
            style={{ flex: 1 }}
          />
        ) : null}
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
      <SafeAreaView
        edges={["top"]}
        pointerEvents="box-none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, zIndex: 40 }}
      >
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
          {!isRider ? (
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
          ) : (
            <View style={{ marginLeft: "auto" }} />
          )}
        </View>
        {isRider && riderGuidanceLabel ? (
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 4,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "rgba(96,165,250,0.55)",
              backgroundColor: "rgba(37,99,235,0.35)",
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Text
              style={{ color: "#eff6ff", fontSize: 16, fontWeight: "800", textAlign: "center" }}
              numberOfLines={1}
            >
              {riderGuidanceLabel}
            </Text>
          </View>
        ) : null}
        {!isRider && currentMarket ? (
          <View style={{ marginHorizontal: 16, marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, flex: 1 }} numberOfLines={1}>{currentMarket.title}</Text>
            <MarketTimer locksAt={currentMarket.locksAt} />
          </View>
        ) : null}
      </SafeAreaView>

      {data.destination ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: insets.top + (isRider ? 118 : 72),
            zIndex: 39,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(248,113,113,0.6)",
            backgroundColor: "rgba(239,68,68,0.25)",
            paddingHorizontal: 12,
            paddingVertical: 7,
          }}
        >
          <Text
            style={{ color: "#fee2e2", fontSize: 12, fontWeight: "700" }}
            numberOfLines={1}
          >
            📍 {data.destination.label}
          </Text>
        </View>
      ) : null}

      {/* Map controls */}
      {mapExpanded && !isRider ? (
        <View style={{ position: "absolute", right: 12, top: 122, zIndex: 45 }}>
          <Pressable
            onPress={blurOnWeb(() => setShowZones((v) => !v))}
            accessibilityLabel={showZones ? "Hide zones" : "Show zones"}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: showZones ? "rgba(6,182,212,0.5)" : "rgba(255,255,255,0.25)",
              backgroundColor: showZones ? "rgba(6,182,212,0.32)" : "rgba(0,0,0,0.45)",
              paddingHorizontal: 10,
              paddingVertical: 7,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
              ▦ {showZones ? "Zones on" : "Zones off"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {mapExpanded && !mapFollow ? (
        <View style={{ position: "absolute", right: 12, top: 160, zIndex: 45 }}>
          <Pressable
            onPress={blurOnWeb(() => setMapFollow(true))}
            accessibilityLabel="Recenter on you"
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
              {isRider ? "◎ Recenter" : "◎ Center on streamer"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {mapExpanded && mapStale ? (
        <View pointerEvents="none" style={{ position: "absolute", left: 12, right: 56, top: 160, zIndex: 45, borderRadius: 10, borderWidth: 1, borderColor: "rgba(245,158,11,0.4)", backgroundColor: "rgba(245,158,11,0.15)", paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: "rgba(255,237,213,0.95)", fontSize: 11, textAlign: "center" }}>Map may be stuck — tap ↻ to refresh</Text>
        </View>
      ) : null}
      {mapExpanded && resolvedRoutePoints.length === 0 ? (
        <View pointerEvents="none" style={{ position: "absolute", left: 12, right: 56, top: 160, zIndex: 45, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, textAlign: "center" }}>Waiting for location…</Text>
        </View>
      ) : null}

      {/* PiP decorative border (video pip when map expanded) */}
      {mapExpanded ? (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: pipLeft,
          bottom: pipBottom,
          width: videoPip.width,
          height: videoPip.height,
          zIndex: 31,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.25)",
        }}
      />
      ) : (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: pipLeft,
          bottom: pipBottom,
          width: pipSize,
          height: pipSize,
          zIndex: 31,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.25)",
        }}
      />
      )}
      {/* PiP swap button */}
      <Pressable
        onPress={() => setMapExpanded((v) => !v)}
        style={{
          position: "absolute",
          left: pipLeft + (mapExpanded ? videoPip.width : pipSize) - 32,
          bottom: pipBottom + 6,
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
        {isRider ? (
          <DriverStatusBar
            routePoints={resolvedRoutePoints}
            sessionId={effectiveSessionId}
            onEndSession={handleEndDriverSession}
            endingSession={endingDriverSession}
          />
        ) : currentMarket?.marketType === "city_grid" ? (
          <GridBetBar
            selectedCellLabel={
              selectedGridCellId
                ? (cityGridCells.find((c) => c.id === selectedGridCellId)?.label ?? null)
                : null
            }
            betAmount={betAmount}
            locked={locked || !currentMarket || placeBet.isPending}
            onBet={selectedGridCellId ? () => handleBet(selectedGridCellId) : undefined}
            error={betError}
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

      {!isRider && roomId ? (
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

function GridBetBar({
  selectedCellLabel,
  betAmount,
  locked,
  onBet,
  error,
}: {
  selectedCellLabel: string | null;
  betAmount: number;
  locked: boolean;
  onBet?: () => void;
  error: string | null;
}) {
  const canBet = !locked && !!onBet && !!selectedCellLabel;
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.15)",
        backgroundColor: "rgba(0,0,0,0.75)",
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>
        {locked ? "Betting closed" : selectedCellLabel ? `Square ${selectedCellLabel} selected` : "Tap a square on the map to bet"}
      </Text>
      {error ? (
        <Text style={{ color: "#f87171", fontSize: 11 }}>{error}</Text>
      ) : null}
      <Pressable
        disabled={!canBet}
        onPress={canBet ? blurOnWeb(() => void onBet()) : undefined}
        style={{
          borderRadius: 12,
          backgroundColor: canBet ? "#ef4444" : "rgba(255,255,255,0.12)",
          paddingVertical: 9,
          alignItems: "center",
        }}
      >
        <Text style={{ color: canBet ? "#fff" : "rgba(255,255,255,0.35)", fontWeight: "700", fontSize: 13 }}>
          {locked ? "Locked" : canBet ? `Place $${betAmount} on ${selectedCellLabel}` : "Select a square"}
        </Text>
      </Pressable>
    </View>
  );
}

function DriverStatusBar({
  routePoints,
  sessionId,
  onEndSession,
  endingSession,
}: {
  routePoints: import("@/types/live").RoutePoint[];
  sessionId: string | null;
  onEndSession: () => void;
  endingSession: boolean;
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

      <Pressable
        onPress={blurOnWeb(onEndSession)}
        disabled={endingSession}
        style={{
          borderRadius: 12,
          backgroundColor: endingSession
            ? "rgba(255,255,255,0.12)"
            : "rgba(239,68,68,0.28)",
          borderWidth: 1,
          borderColor: endingSession
            ? "rgba(255,255,255,0.22)"
            : "rgba(248,113,113,0.6)",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Text
          style={{
            color: endingSession ? "rgba(255,255,255,0.65)" : "#fee2e2",
            fontSize: 12,
            fontWeight: "700",
          }}
        >
          {endingSession ? "Ending..." : "End session"}
        </Text>
      </Pressable>
    </View>
  );
}
