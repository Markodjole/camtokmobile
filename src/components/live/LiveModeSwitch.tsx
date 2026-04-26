import React from "react";
import { usePathname, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

export function LiveModeSwitch() {
  const pathname = usePathname();
  const router = useRouter();
  const viewerActive = pathname.startsWith("/live") && !pathname.startsWith("/live/go");
  const driverActive = pathname.startsWith("/live/go");

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(82,82,91,0.95)",
        backgroundColor: "rgba(24,24,27,0.92)",
        padding: 3,
        gap: 4,
      }}
    >
      <Pressable
        onPress={() => router.push("/(tabs)/live")}
        style={{
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: viewerActive ? "rgba(59,130,246,0.25)" : "transparent",
        }}
      >
        <Text
          style={{
            color: viewerActive ? "#bfdbfe" : "#a1a1aa",
            fontSize: 12,
            fontWeight: "700",
          }}
        >
          Viewer
        </Text>
      </Pressable>
      <Pressable
        onPress={() => router.push("/live/go")}
        style={{
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: driverActive ? "rgba(16,185,129,0.24)" : "transparent",
        }}
      >
        <Text
          style={{
            color: driverActive ? "#bbf7d0" : "#a1a1aa",
            fontSize: 12,
            fontWeight: "700",
          }}
        >
          Driver
        </Text>
      </Pressable>
    </View>
  );
}
