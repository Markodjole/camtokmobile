import React from "react";
import { Text, View } from "react-native";

/** Rider-only badge — viewer mode is not offered in the mobile app. */
export function LiveModeSwitch() {
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
      }}
    >
      <View
        style={{
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: "rgba(16,185,129,0.24)",
        }}
      >
        <Text
          style={{
            color: "#bbf7d0",
            fontSize: 12,
            fontWeight: "700",
          }}
        >
          Driver
        </Text>
      </View>
    </View>
  );
}
