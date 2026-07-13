import { Tabs, useRouter } from "expo-router";
import { Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Bottom tab bar.
 *
 * Tabs: Live · Go · Wallet · Profile
 *
 * "Go" intercepts the tab press and navigates to the /live/go modal directly
 * (without mounting a tab screen). Doing it via a tabPress listener avoids the
 * useEffect-based redirect race that crashes Fabric (`addViewAt: failed to
 * insert view into parent`) on Android dev clients.
 */
export default function TabsLayout() {
  const router = useRouter();

  return (
    <Tabs
      initialRouteName="go"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          display: "none",
        },
        tabBarActiveTintColor: "#3b82f6",
        tabBarInactiveTintColor: "#a1a1aa",
      }}
    >
      <Tabs.Screen
        name="go"
        options={{
          title: "Go Live",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>＋</Text>
          ),
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push("/live/go");
          },
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          href: null,
          title: "Live",
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
            <Ionicons name="person-outline" size={20} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
