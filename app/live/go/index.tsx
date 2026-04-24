import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { useMyCharacters } from "@/hooks/useMyCharacters";

/**
 * Twin of `apps/web/src/app/live/go/page.tsx`: lets the owner pick a
 * character to broadcast from.
 */
export default function GoLivePickerScreen() {
  const router = useRouter();
  const { data, isLoading, error } = useMyCharacters();

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="mb-2 flex-row items-center gap-3">
        <Pressable
          onPress={() => router.back()}
          className="h-9 w-9 items-center justify-center rounded-full bg-muted"
        >
          <Text className="text-white">‹</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-2xl font-bold text-white">Go live</Text>
          <Text className="text-sm text-muted-foreground">
            Pick which character profile you want to stream from.
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#ffffff" />
        </View>
      ) : error ? (
        <Text className="text-sm text-accent">
          {error instanceof Error ? error.message : "Could not load characters"}
        </Text>
      ) : (
        <ScrollView contentContainerStyle={{ paddingVertical: 8, gap: 8 }}>
          {(data ?? []).map((c) => (
            <Pressable
              key={c.id}
              onPress={() => router.push(`/live/go/${c.id}`)}
              className="flex-row items-center justify-between rounded-2xl border border-border bg-muted p-3 active:opacity-80"
            >
              <Text className="text-white">{c.name}</Text>
              <Text className="text-sm font-semibold text-primary">Go live →</Text>
            </Pressable>
          ))}
          {(data ?? []).length === 0 ? (
            <View className="mt-4 rounded-2xl border border-border bg-muted p-4">
              <Text className="text-sm text-muted-foreground">
                No owned characters found. Create one from the web app first.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
