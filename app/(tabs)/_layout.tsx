import { Tabs } from "expo-router";
import { Text } from "react-native";

/**
 * Bottom tab bar.
 *
 * Tabs: Live · Go · Wallet · Profile
 * "Go" is a top-level action that lands on the character picker.
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
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>●</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="go"
        options={{
          title: "Go Live",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>＋</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>$</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>☺</Text>
          ),
        }}
      />
    </Tabs>
  );
}
