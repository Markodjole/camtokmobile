import { Tabs } from "expo-router";
import { Text } from "react-native";

/**
 * Bottom tab bar. Each tab renders a small emoji glyph as its icon — we keep
 * this free of icon-library dependencies to minimise native modules.
 * Replace with `@expo/vector-icons` when you want real icons.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0a0a0a",
          borderTopColor: "#27272a",
        },
        tabBarActiveTintColor: "#3b82f6",
        tabBarInactiveTintColor: "#a1a1aa",
      }}
    >
      <Tabs.Screen
        name="live"
        options={{
          title: "Live",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>●</Text>,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>▤</Text>,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>$</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>☺</Text>,
        }}
      />
    </Tabs>
  );
}
