import { Text, View } from "react-native";
import { Screen } from "@/components/ui/Screen";

export default function FeedTab() {
  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-2">
        <Text className="text-2xl font-bold text-white">Feed</Text>
        <Text className="text-center text-sm text-muted-foreground">
          Clips, stories, and highlights show up here.{"\n"}
          Coming soon on mobile.
        </Text>
      </View>
    </Screen>
  );
}
