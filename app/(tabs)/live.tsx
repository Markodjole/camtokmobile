import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import { formatRelativeTime } from "@/lib/format";
import type { LiveFeedItem } from "@/types/live";

export default function LiveTab() {
  const { data, isLoading, refetch, isRefetching, error } = useLiveFeed();
  const router = useRouter();

  if (isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#ffffff" />
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-2">
          <Text className="text-lg font-semibold text-white">
            Couldn't load the live feed
          </Text>
          <Text className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </Text>
        </View>
      </Screen>
    );
  }

  const items = data ?? [];

  return (
    <Screen padded={false}>
      <View className="px-4 pb-2 pt-2">
        <Text className="text-2xl font-bold text-white">Live now</Text>
        <Text className="text-sm text-muted-foreground">
          Drivers streaming in real time
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(it) => it.roomId}
        ItemSeparatorComponent={() => <View className="h-3" />}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            tintColor="#ffffff"
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
          />
        }
        renderItem={({ item }) => (
          <LiveRoomCard
            item={item}
            onPress={() => router.push(`/room/${item.roomId}`)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center pt-16">
            <Text className="text-muted-foreground">
              Nobody is live right now.
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

function LiveRoomCard({
  item,
  onPress,
}: {
  item: LiveFeedItem;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="overflow-hidden rounded-3xl border border-border bg-muted active:opacity-80"
    >
      <View className="aspect-video w-full bg-black">
        {item.thumbnailUrl ? (
          <Image
            source={{ uri: item.thumbnailUrl }}
            className="h-full w-full"
            resizeMode="cover"
          />
        ) : (
          <View className="h-full w-full items-center justify-center">
            <Text className="text-4xl">🚗</Text>
          </View>
        )}
        <View className="absolute left-3 top-3 flex-row items-center gap-1 rounded-full bg-accent px-2 py-1">
          <View className="h-2 w-2 rounded-full bg-white" />
          <Text className="text-xs font-bold text-white">LIVE</Text>
        </View>
        <View className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-1">
          <Text className="text-xs text-white">{item.viewers} watching</Text>
        </View>
      </View>
      <View className="flex-row items-center gap-3 p-3">
        {item.characterAvatarUrl ? (
          <Image
            source={{ uri: item.characterAvatarUrl }}
            className="h-10 w-10 rounded-full"
          />
        ) : (
          <View className="h-10 w-10 items-center justify-center rounded-full bg-border">
            <Text className="font-bold text-white">
              {item.characterName.slice(0, 1)}
            </Text>
          </View>
        )}
        <View className="flex-1">
          <Text numberOfLines={1} className="text-base font-semibold text-white">
            {item.title || item.characterName}
          </Text>
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {item.characterName}
            {item.city ? ` • ${item.city}` : ""} •{" "}
            {formatRelativeTime(item.startedAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
