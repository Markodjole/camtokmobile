import React from "react";
import { usePathname, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type NavItem = {
  label: string;
  icon: string;
  isActive: (path: string) => boolean;
  onPress: () => void;
};

export function AppTopBar() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 14,
        paddingBottom: 10,
        backgroundColor: "#0a0a0a",
        borderBottomWidth: 1,
        borderBottomColor: "#27272a",
      }}
    >
      <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>CamTok</Text>
    </View>
  );
}

export function AppBottomBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();

  const items: NavItem[] = [
    {
      label: "Live",
      icon: "●",
      isActive: (path) => path.startsWith("/live") || path.startsWith("/room/"),
      onPress: () => router.push("/(tabs)/live"),
    },
    {
      label: "Go",
      icon: "＋",
      isActive: (path) => path.startsWith("/live/go"),
      onPress: () => router.push("/live/go"),
    },
    {
      label: "Wallet",
      icon: "$",
      isActive: (path) => path.startsWith("/wallet"),
      onPress: () => router.push("/(tabs)/wallet"),
    },
    {
      label: "Profile",
      icon: "☺",
      isActive: (path) => path.startsWith("/profile"),
      onPress: () => router.push("/(tabs)/profile"),
    },
  ];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 8),
        backgroundColor: "#0a0a0a",
        borderTopWidth: 1,
        borderTopColor: "#27272a",
      }}
    >
      {items.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Pressable
            key={item.label}
            onPress={item.onPress}
            style={{
              alignItems: "center",
              justifyContent: "center",
              minWidth: 68,
              paddingVertical: 4,
              opacity: active ? 1 : 0.8,
            }}
          >
            <Text style={{ color: active ? "#3b82f6" : "#a1a1aa", fontSize: 18 }}>
              {item.icon}
            </Text>
            <Text
              style={{
                color: active ? "#3b82f6" : "#a1a1aa",
                fontSize: 12,
                marginTop: 2,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
