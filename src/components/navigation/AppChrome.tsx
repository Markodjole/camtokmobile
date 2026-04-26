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
  const pathname = usePathname();
  const modeLabel = pathname.startsWith("/live/go")
    ? "DRIVER"
    : pathname.startsWith("/live") || pathname.startsWith("/room/")
      ? "VIEWER"
      : "APP";

  return (
    <View
      style={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 14,
        paddingBottom: 12,
        backgroundColor: "#09090b",
        borderBottomWidth: 1,
        borderBottomColor: "rgba(63,63,70,0.8)",
      }}
    >
      <View
        style={{
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "rgba(59,130,246,0.32)",
          backgroundColor: "rgba(17,24,39,0.84)",
          paddingHorizontal: 12,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>CamTok</Text>
        <Text style={{ color: "rgba(147,197,253,0.95)", fontSize: 11, fontWeight: "700" }}>
          {modeLabel}
        </Text>
      </View>
    </View>
  );
}

export function AppBottomBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();

  const items: NavItem[] = [
    {
      label: "Viewer",
      icon: "●",
      isActive: (path) => path.startsWith("/live") || path.startsWith("/room/"),
      onPress: () => router.push("/(tabs)/live"),
    },
    {
      label: "Driver",
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
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 8),
        backgroundColor: "#09090b",
        borderTopWidth: 1,
        borderTopColor: "rgba(63,63,70,0.8)",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "rgba(63,63,70,0.85)",
          backgroundColor: "rgba(24,24,27,0.95)",
          paddingVertical: 4,
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
                borderRadius: 12,
                paddingVertical: 6,
                paddingHorizontal: 8,
                backgroundColor: active ? "rgba(59,130,246,0.18)" : "transparent",
                opacity: 1,
              }}
            >
              <Text style={{ color: active ? "#60a5fa" : "#a1a1aa", fontSize: 18 }}>
                {item.icon}
              </Text>
              <Text
                style={{
                  color: active ? "#93c5fd" : "#a1a1aa",
                  fontSize: 12,
                  marginTop: 2,
                  fontWeight: active ? "700" : "500",
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
