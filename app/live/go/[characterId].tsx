import React, { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { LiveMap } from "@/components/live/LiveMap";
import { BroadcasterCameraPreview } from "@/components/live/BroadcasterCameraPreview";
import { apiFetch } from "@/lib/api";
import { useBroadcasterTelemetry } from "@/hooks/useBroadcasterTelemetry";
import { blurOnWeb } from "@/lib/blurOnWeb";
import { useMapTilePreload } from "@/hooks/useMapTilePreload";
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

  const [transportMode, setTransportMode] = useState<TransportMode>("walking");
  const [statusText, setStatusText] = useState("");
  const [intentLabel, setIntentLabel] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  const onTelemetryError = useCallback((msg: string) => setError(msg), []);
  const { routePoints, hasPermission } = useBroadcasterTelemetry({
    sessionId,
    transportMode,
    onError: onTelemetryError,
  });

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
          statusText: statusText.trim() || undefined,
          intentLabel: intentLabel.trim() || undefined,
        },
      });
      if ("error" in res) {
        setError(res.error);
      } else {
        setSessionId(res.sessionId);
        setRoomId(res.roomId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start session");
    } finally {
      setStarting(false);
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
      setSessionId(null);
      setRoomId(null);
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
          <>
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

            {error ? (
              <Text className="text-xs text-accent">{error}</Text>
            ) : null}

            <Button
              label={starting ? "Starting…" : "Start broadcasting"}
              onPress={goLive}
              loading={starting}
              fullWidth
            />
          </>
        ) : (
          <>
            <View className="h-[56vh] min-h-[320px] overflow-hidden rounded-3xl border border-border">
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

            <View className="h-48 overflow-hidden rounded-3xl border border-border">
              <LiveMap routePoints={routePoints} />
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
                onPress={() => router.push(`/room/${roomId}`)}
                fullWidth
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
