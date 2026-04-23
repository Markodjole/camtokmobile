import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { LiveMap } from "@/components/live/LiveMap";
import { BettingPanel } from "@/components/live/BettingPanel";
import { useDriverRoute, useLiveRoom } from "@/hooks/useLiveRoom";

/**
 * Full-screen live room — the mobile twin of `/live/rooms/[roomId]` on web.
 *
 * Layout (top → bottom):
 *   1. TopBar with back / host info / viewers
 *   2. Map filling the remaining vertical space
 *   3. BettingPanel pinned to the bottom (safe-area aware)
 *
 * All data flows through React Query hooks that poll the backend every
 * 1.5 s (room state) and 2 s (driver route). On slow connections the UI
 * simply stays on the last known frame rather than going blank.
 */
export default function RoomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const room = useLiveRoom(roomId ?? null);
  const driverRoute = useDriverRoute(roomId ?? null);

  return (
    <View className="flex-1 bg-black">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-1">
        {room.isLoading && !room.data ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#ffffff" />
          </View>
        ) : (
          <LiveMap
            routePoints={room.data?.routePoints ?? []}
            driverRoute={driverRoute.data ?? null}
          />
        )}

        <SafeAreaView
          edges={["top", "left", "right"]}
          className="absolute inset-x-0 top-0"
        >
          <View className="flex-row items-center gap-3 px-3 py-2">
            <Pressable
              accessibilityLabel="Close live room"
              onPress={() => router.back()}
              className="h-10 w-10 items-center justify-center rounded-full bg-black/60"
            >
              <Text className="text-xl text-white">✕</Text>
            </Pressable>
            {room.data?.characterAvatarUrl ? (
              <Image
                source={{ uri: room.data.characterAvatarUrl }}
                className="h-10 w-10 rounded-full"
              />
            ) : null}
            <View className="flex-1">
              <Text className="text-base font-semibold text-white">
                {room.data?.characterName ?? "Live room"}
              </Text>
              <View className="flex-row items-center gap-2">
                <View className="flex-row items-center gap-1 rounded-full bg-accent px-2 py-0.5">
                  <View className="h-1.5 w-1.5 rounded-full bg-white" />
                  <Text className="text-[10px] font-bold text-white">LIVE</Text>
                </View>
                <Text className="text-xs text-white/80">
                  {room.data?.viewers ?? 0} watching
                </Text>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <SafeAreaView edges={["bottom", "left", "right"]} className="bg-transparent">
        <BettingPanel
          roomId={roomId ?? ""}
          market={room.data?.currentMarket ?? null}
          balance={room.data?.walletBalance}
        />
      </SafeAreaView>
    </View>
  );
}
