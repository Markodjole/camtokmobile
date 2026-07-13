import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { useMyCharacters } from "@/hooks/useMyCharacters";
import { useSharedDestinationStore } from "@/stores/sharedDestinationStore";

/**
 * Auto-picks the logged-in user's character and continues to go-live.
 * No character picker when the account already owns a profile.
 */
export default function GoLivePickerScreen() {
  const router = useRouter();
  const { data, isLoading, error } = useMyCharacters();
  const redirected = useRef(false);
  const pending = useSharedDestinationStore((s) => s.pending);
  const lastError = useSharedDestinationStore((s) => s.lastError);

  useEffect(() => {
    if (redirected.current || isLoading || error) return;
    const first = data?.[0];
    if (!first) return;
    redirected.current = true;
    router.replace(`/live/go/${first.id}`);
  }, [data, isLoading, error, router]);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="mb-2 flex-1">
        <Text className="text-2xl font-bold text-white">Go live</Text>
        <Text className="text-sm text-muted-foreground">
          Starting your ride…
        </Text>
        {lastError ? (
          <Text className="mt-1 text-xs text-amber-300">{lastError}</Text>
        ) : null}
        {pending ? (
          <Text className="mt-1 text-xs text-emerald-300">
            Destination ready: {pending.label}
          </Text>
        ) : null}
      </View>

      {isLoading || (data && data.length > 0 && !error) ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#ffffff" />
        </View>
      ) : error ? (
        <Text className="text-sm text-accent">
          {error instanceof Error ? error.message : "Could not load characters"}
        </Text>
      ) : (
        <View className="mt-4 rounded-2xl border border-border bg-muted p-4">
          <Text className="text-sm text-muted-foreground">
            No owned characters found. Create one from the web app first.
          </Text>
        </View>
      )}
    </Screen>
  );
}
