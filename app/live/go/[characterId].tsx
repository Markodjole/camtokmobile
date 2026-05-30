import React, { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { LiveModeSwitch } from "@/components/live/LiveModeSwitch";
import { apiFetch } from "@/lib/api";
import { blurOnWeb } from "@/lib/blurOnWeb";
import { useMapTilePreload } from "@/hooks/useMapTilePreload";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import type { TransportMode } from "@/types/live";
import { TWO_WHEELED_MODES } from "@/lib/transportMode";

const RECENT_DESTINATIONS_KEY = "camtok:recent_destinations";
const MAX_RECENT = 5;

type SavedDestination = {
  placeId: string | null;
  label: string;
  lat: number;
  lng: number;
};

async function loadRecentDestinations(): Promise<SavedDestination[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_DESTINATIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedDestination[];
  } catch {
    return [];
  }
}

async function saveRecentDestination(dest: SavedDestination): Promise<void> {
  try {
    const existing = await loadRecentDestinations();
    const filtered = existing.filter(
      (d) =>
        d.placeId !== dest.placeId ||
        d.label.toLowerCase() !== dest.label.toLowerCase(),
    );
    const updated = [dest, ...filtered].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENT_DESTINATIONS_KEY, JSON.stringify(updated));
  } catch {
    // best-effort
  }
}

const MODES: { id: TransportMode; label: string; emoji: string }[] = [
  { id: "walking", label: "Walking", emoji: "🚶" },
  { id: "run", label: "Running", emoji: "🏃" },
  { id: "bike", label: "Bike", emoji: "🚴" },
  { id: "scooter", label: "Scooter", emoji: "🛴" },
  { id: "motorcycle", label: "Moto", emoji: "🏍️" },
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
  const [transportMode, setTransportMode] = useState<TransportMode>(
    storeTransportMode === "car" ? "bike" : storeTransportMode,
  );
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
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
  const [recentDestinations, setRecentDestinations] = useState<SavedDestination[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const hideRecentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [placeSessionToken] = useState(() =>
    Math.random().toString(36).slice(2),
  );

  // Drive market / zone creation — mirrors OwnerLiveControlPanel.startTick().
  // Without this, runRoomTick never fires unless the Vercel cron is running.
  useEffect(() => {
    if (!roomId) return;
    const id = setInterval(() => {
      void apiFetch(`/api/live/rooms/${roomId}/tick`, { method: "POST" }).catch(() => undefined);
    }, 1500);
    return () => clearInterval(id);
  }, [roomId]);

  // If a live session is already active (e.g. user navigated back), go
  // straight to the room instead of showing the setup form again.
  useEffect(() => {
    if (sessionId && roomId) {
      router.replace(
        `/room/${roomId}?sessionId=${encodeURIComponent(sessionId)}&mode=driver`,
      );
    }
  }, [sessionId, roomId, router]);

  function cancelHideRecent() {
    if (hideRecentTimerRef.current) {
      clearTimeout(hideRecentTimerRef.current);
      hideRecentTimerRef.current = null;
    }
  }

  function scheduleHideRecent() {
    cancelHideRecent();
    hideRecentTimerRef.current = setTimeout(() => setShowRecent(false), 250);
  }

  function selectRecentDestination(d: SavedDestination) {
    cancelHideRecent();
    setDestination({
      lat: d.lat,
      lng: d.lng,
      label: d.label,
      placeId: d.placeId,
    });
    setDestinationQuery(d.label);
    setShowRecent(false);
    setDestinationSuggestions([]);
    Keyboard.dismiss();
  }

  useEffect(() => () => cancelHideRecent(), []);

  useEffect(() => {
    loadRecentDestinations().then(setRecentDestinations).catch(() => undefined);
  }, []);

  useEffect(() => {
    setStoreTransportMode(transportMode);
  }, [transportMode, setStoreTransportMode]);

  // Pre-fetch map tiles for current GPS location as soon as we have a point
  const lastPoint = routePoints[routePoints.length - 1];
  useMapTilePreload(lastPoint?.lat, lastPoint?.lng);

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
        setError(
          typeof res.error === "string" ? res.error : "Could not start session",
        );
      } else {
        setSessionId(res.sessionId);
        setRoomId(res.roomId);
        setStoreTransportMode(transportMode);
        if (destination) {
          void saveRecentDestination({
            placeId: destination.placeId,
            label: destination.label,
            lat: destination.lat,
            lng: destination.lng,
          });
        }
        router.replace(
          `/room/${res.roomId}?sessionId=${encodeURIComponent(res.sessionId)}&mode=driver`,
        );
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
    cancelHideRecent();
    setShowRecent(false);
    Keyboard.dismiss();
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

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 16 }}
      >
        <View style={{ gap: 16 }}>
            <Card>
              <CardTitle>Transport mode</CardTitle>
              <CardDescription>
                Pick mode and destination. No extra setup.
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
            <View style={{ gap: 6 }}>
              <Text className="text-sm font-medium text-white">Destination</Text>
              <View
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.14)",
                  backgroundColor: "rgba(0,0,0,0.35)",
                  overflow: "hidden",
                }}
              >
                <Input
                  placeholder="Search destination"
                  value={destinationQuery}
                  onChangeText={(t) => {
                    setDestination(null);
                    setShowRecent(t.trim().length === 0);
                    void fetchDestinationSuggestions(t);
                  }}
                  onFocus={() => {
                    cancelHideRecent();
                    if (destinationQuery.trim().length === 0) setShowRecent(true);
                  }}
                  onBlur={scheduleHideRecent}
                />
              </View>
            </View>
            {/* Recent destinations — shown when input is focused & empty */}
            {showRecent && recentDestinations.length > 0 && destinationSuggestions.length === 0 ? (
              <View
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.12)",
                  backgroundColor: "rgba(0,0,0,0.55)",
                  overflow: "hidden",
                }}
              >
                <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: "700", letterSpacing: 0.8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
                  RECENT
                </Text>
                {recentDestinations.map((d, i) => (
                  <Pressable
                    key={`${d.label}-${i}`}
                    onPressIn={() => selectRecentDestination(d)}
                    onPress={() => selectRecentDestination(d)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderTopWidth: 1,
                      borderTopColor: "rgba(255,255,255,0.07)",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>🕐</Text>
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                      {d.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
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
                    onPressIn={() => void pickSuggestion(s.placeId)}
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
              <Text className="text-xs text-accent">{String(error)}</Text>
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
      </ScrollView>
    </Screen>
  );
}
