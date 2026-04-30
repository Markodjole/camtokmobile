import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { LiveMap } from "@/components/live/LiveMap";
import { BroadcasterCameraPreview } from "@/components/live/BroadcasterCameraPreview";
import { LiveModeSwitch } from "@/components/live/LiveModeSwitch";
import { apiFetch } from "@/lib/api";
import { blurOnWeb } from "@/lib/blurOnWeb";
import { useMapTilePreload } from "@/hooks/useMapTilePreload";
import { useLiveMapStale } from "@/hooks/useLiveMapStale";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import type { TransportMode } from "@/types/live";

const MODES: { id: TransportMode; label: string; emoji: string }[] = [
  { id: "walking", label: "Walking", emoji: "🚶" },
  { id: "run", label: "Running", emoji: "🏃" },
  { id: "bike", label: "Bike", emoji: "🚴" },
  { id: "scooter", label: "Scooter", emoji: "🛴" },
  { id: "car", label: "Car", emoji: "🚗" },
];

/**
 * Twin of `apps/web/src/components/live/OwnerLiveControlPanel.tsx`.
 *
 * Mobile differences:
 *   - Uses `expo-location` for GPS instead of `navigator.geolocation`.
 *   - Does not open a WebRTC broadcaster in this Expo Go build — instead
 *     it starts the live session + pushes GPS/heartbeat telemetry, which
 *     is exactly what `/live/go` produces server-side. Add
 *     `react-native-webrtc` in a dev client to attach real video.
 */
export default function GoLiveControlScreen() {
  const { characterId } = useLocalSearchParams<{ characterId: string }>();
  const router = useRouter();

  const storeTransportMode = useLiveBroadcastStore((s) => s.transportMode as TransportMode);
  const setStoreTransportMode = useLiveBroadcastStore((s) => s.setTransportMode);
  const sessionId = useLiveBroadcastStore((s) => s.sessionId);
  const roomId = useLiveBroadcastStore((s) => s.roomId);
  const setSessionId = useLiveBroadcastStore((s) => s.setSession);
  const setRoomId = useLiveBroadcastStore((s) => s.setRoomId);
  const routePoints = useLiveBroadcastStore((s) => s.routePoints);
  const hasPermission = useLiveBroadcastStore((s) => s.hasLocationPermission);
  const [transportMode, setTransportMode] = useState<TransportMode>(storeTransportMode);
  const [statusText, setStatusText] = useState("");
  const [intentLabel, setIntentLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [mapResetKey, setMapResetKey] = useState(0);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destinationSuggestions, setDestinationSuggestions] = useState<
    Array<{ placeId: string; primary: string; secondary: string | null }>
  >([]);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [destination, setDestination] = useState<{
    lat: number;
    lng: number;
    label: string;
    placeId: string | null;
  } | null>(null);
  const [placeSessionToken] = useState(() =>
    Math.random().toString(36).slice(2),
  );

  const clearBroadcastStore = useLiveBroadcastStore((s) => s.clear);

  useEffect(() => {
    setStoreTransportMode(transportMode);
  }, [transportMode, setStoreTransportMode]);

  // Pre-fetch map tiles for current GPS location as soon as we have a point
  const lastPoint = routePoints[routePoints.length - 1];
  useMapTilePreload(lastPoint?.lat, lastPoint?.lng);

  const mapStale = useLiveMapStale({
    lat: lastPoint?.lat,
    lng: lastPoint?.lng,
    requireMovement: true,
    speedMps: lastPoint?.speedMps,
    staleAfterMs: 25_000,
    enabled: !!sessionId && routePoints.length > 0,
  });

  const refreshMap = useCallback(() => {
    setMapResetKey((k) => k + 1);
  }, []);

  async function goLive() {
    if (!characterId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await apiFetch<
        { sessionId: string; roomId: string } | { error: string }
      >("/api/live/sessions", {
        method: "POST",
        body: {
          characterId,
          transportMode,
          statusText: statusText.trim() || undefined,
          intentLabel: intentLabel.trim() || undefined,
          destination: destination
            ? {
                lat: destination.lat,
                lng: destination.lng,
                label: destination.label,
                placeId: destination.placeId,
              }
            : undefined,
        },
      });
      if ("error" in res) {
        setError(res.error);
      } else {
        setSessionId(res.sessionId);
        setRoomId(res.roomId);
        setStoreTransportMode(transportMode);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start session");
    } finally {
      setStarting(false);
    }
  }

  async function fetchDestinationSuggestions(text: string) {
    const q = text.trim();
    setDestinationQuery(text);
    if (q.length < 2) {
      setDestinationSuggestions([]);
      return;
    }
    setDestinationLoading(true);
    try {
      let latLngQuery = "";
      try {
        const pos = await Location.getLastKnownPositionAsync();
        if (pos) {
          latLngQuery = `&lat=${pos.coords.latitude.toFixed(6)}&lng=${pos.coords.longitude.toFixed(6)}`;
        }
      } catch {
        // best effort only
      }
      const res = await apiFetch<{
        suggestions: Array<{
          placeId: string;
          primary: string;
          secondary: string | null;
        }>;
      }>(
        `/api/live/places/autocomplete?input=${encodeURIComponent(q)}&sessionToken=${placeSessionToken}${latLngQuery}`,
        { anonymous: true },
      );
      setDestinationSuggestions(res.suggestions ?? []);
    } catch {
      setDestinationSuggestions([]);
    } finally {
      setDestinationLoading(false);
    }
  }

  async function pickSuggestion(placeId: string) {
    setDestinationLoading(true);
    try {
      const res = await apiFetch<{
        destination: {
          lat: number;
          lng: number;
          label: string;
          placeId: string | null;
        } | null;
      }>(
        `/api/live/places/details?placeId=${encodeURIComponent(placeId)}&sessionToken=${placeSessionToken}`,
        { anonymous: true },
      );
      if (!res.destination) return;
      setDestination(res.destination);
      setDestinationQuery(res.destination.label);
      setDestinationSuggestions([]);
    } finally {
      setDestinationLoading(false);
    }
  }

  async function endLive() {
    if (!sessionId) return;
    setEnding(true);
    try {
      await apiFetch(`/api/live/sessions/${sessionId}/end`, {
        method: "POST",
        body: {},
      }).catch(() => undefined);
      clearBroadcastStore();
      Alert.alert("Ended", "Live session ended.");
    } finally {
      setEnding(false);
    }
  }

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center gap-3 px-4 pt-2">
        <Pressable
          onPress={blurOnWeb(() => router.back())}
          className="h-9 w-9 items-center justify-center rounded-full bg-muted"
        >
          <Text className="text-white">‹</Text>
        </Pressable>
        <Text className="text-xl font-bold text-white">Go live</Text>
        {sessionId ? (
          <View className="ml-auto rounded bg-red-500/30 px-2 py-0.5">
            <Text className="text-[11px] font-bold tracking-wider text-red-400">
              LIVE
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {!sessionId ? (
          <View style={{ gap: 16 }}>
            <Card>
              <CardTitle>Transport mode</CardTitle>
              <CardDescription>
                Car rooms have tighter safety limits per platform policy.
              </CardDescription>
              <View className="mt-3 flex-row flex-wrap gap-2">
                {MODES.map((m) => {
                  const active = transportMode === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setTransportMode(m.id)}
                      className={`flex-row items-center gap-1 rounded-full border px-3 py-1.5 ${
                        active
                          ? "border-primary bg-primary/20"
                          : "border-border bg-black/30"
                      }`}
                    >
                      <Text>{m.emoji}</Text>
                      <Text className="text-xs font-medium text-white">
                        {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            <Input
              label="Status"
              placeholder="What are you doing right now?"
              value={statusText}
              onChangeText={setStatusText}
            />
            <Input
              label="Intent (optional)"
              placeholder="e.g. Coffee run"
              value={intentLabel}
              onChangeText={setIntentLabel}
            />
            <Input
              label="Destination"
              placeholder="Address, place, or part of city"
              value={destinationQuery}
              onChangeText={(t) => {
                setDestination(null);
                void fetchDestinationSuggestions(t);
              }}
            />
            {destinationLoading ? (
              <Text className="text-xs text-muted-foreground">Searching places…</Text>
            ) : null}
            {destinationSuggestions.length > 0 ? (
              <View
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.12)",
                  backgroundColor: "rgba(0,0,0,0.35)",
                  overflow: "hidden",
                }}
              >
                {destinationSuggestions.map((s, i) => (
                  <Pressable
                    key={s.placeId}
                    onPress={() => void pickSuggestion(s.placeId)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderBottomWidth: i < destinationSuggestions.length - 1 ? 1 : 0,
                      borderBottomColor: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>
                      {s.primary}
                    </Text>
                    {s.secondary ? (
                      <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
                        {s.secondary}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            {destination ? (
              <View
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "rgba(248,113,113,0.5)",
                  backgroundColor: "rgba(239,68,68,0.15)",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <Text style={{ color: "#fee2e2", fontSize: 12, fontWeight: "700" }}>
                  📍 {destination.label}
                </Text>
              </View>
            ) : null}

            {error ? (
              <Text className="text-xs text-accent">{error}</Text>
            ) : null}

            <Button
              label={
                starting
                  ? "Starting…"
                  : destination
                    ? "Start broadcasting"
                    : "Pick destination first"
              }
              onPress={goLive}
              loading={starting}
              disabled={!destination || starting}
              fullWidth
            />
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <View
              style={{
                height: 360,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "#27272a",
                backgroundColor: "#000",
              }}
            >
              <BroadcasterCameraPreview
                liveSessionId={sessionId}
                facing="front"
              />
            </View>

            <Card>
              <CardTitle>Broadcasting</CardTitle>
              <CardDescription>
                Camera + GPS + heartbeat are live. On web we also push the
                video over WebRTC; Expo Go shows only the local preview
                until you attach a dev client with `react-native-webrtc`.
              </CardDescription>
              <View className="mt-3 gap-1">
                <Text className="text-xs text-muted-foreground">
                  Room ID: {roomId}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Session: {sessionId}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Points buffered: {routePoints.length}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Location permission:{" "}
                  {hasPermission === null
                    ? "requesting…"
                    : hasPermission
                      ? "granted"
                      : "denied"}
                </Text>
              </View>
            </Card>

            <View
              style={{
                height: 192,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "#27272a",
                backgroundColor: "#000",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <LiveMap routePoints={routePoints} mapResetKey={mapResetKey} />
              {sessionId ? (
                <Pressable
                  onPress={refreshMap}
                  accessibilityLabel="Refresh map"
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 8,
                    zIndex: 20,
                    height: 36,
                    minWidth: 36,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 9999,
                    backgroundColor: "rgba(0,0,0,0.7)",
                    paddingHorizontal: 8,
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 18 }}>↻</Text>
                </Pressable>
              ) : null}
              {mapStale ? (
                <View
                  style={{
                    position: "absolute",
                    left: 8,
                    right: 48,
                    top: 8,
                    zIndex: 20,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "rgba(245,158,11,0.45)",
                    backgroundColor: "rgba(245,158,11,0.18)",
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: "rgba(255,237,213,0.95)", fontSize: 11 }}>
                    Map may be stuck — tap ↻
                  </Text>
                </View>
              ) : null}
            </View>

            {error ? (
              <Text className="text-xs text-accent">{error}</Text>
            ) : null}

            <Button
              label={ending ? "Ending…" : "End live"}
              onPress={endLive}
              loading={ending}
              variant="destructive"
              fullWidth
            />
            {roomId ? (
              <Button
                label="Open room view"
                variant="secondary"
                onPress={() =>
                  router.push(
                    `/room/${roomId}?sessionId=${encodeURIComponent(sessionId)}&mode=driver`,
                  )
                }
                fullWidth
              />
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
