import "../global.css";
import "@/tasks/liveLocationTask";
import { Redirect, Stack, usePathname, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ShareIntentProvider } from "expo-share-intent";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { AppBottomBar, AppTopBar } from "@/components/navigation/AppChrome";
import { ShareDestinationBridge } from "@/components/live/ShareDestinationBridge";
import { useBroadcasterTelemetry } from "@/hooks/useBroadcasterTelemetry";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import type { TransportMode } from "@/types/live";

export default function RootLayout() {
  return (
    <ShareIntentProvider
      options={{
        debug: __DEV__,
        resetOnBackground: false,
        disabled: Platform.OS === "web",
        scheme: "camtok",
      }}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryProvider>
            <AuthProvider>
              <StatusBar style="light" />
              <AuthGate />
            </AuthProvider>
          </QueryProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}

function AuthGate() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  }

  const inAuthGroup = segments[0] === "(auth)";
  if (!session && !inAuthGroup) {
    return <Redirect href="/(auth)/login" />;
  }
  if (session && inAuthGroup) {
    return <Redirect href="/live/go" />;
  }

  // Fullscreen room owns its own chrome; go-live uses app top/bottom bars.
  const isFullscreen = pathname.startsWith("/room/");

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <GlobalLiveTelemetry />
      <ShareDestinationBridge />
      {!isFullscreen && <AppTopBar />}
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#000" },
          }}
        >
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="room/[roomId]"
            options={{ presentation: "fullScreenModal" }}
          />
          <Stack.Screen name="live/go/index" options={{ presentation: "card" }} />
          <Stack.Screen
            name="live/go/[characterId]"
            options={{ presentation: "card" }}
          />
        </Stack>
      </View>
      {!isFullscreen && <AppBottomBar />}
    </View>
  );
}

function GlobalLiveTelemetry() {
  const sessionId = useLiveBroadcastStore((s) => s.sessionId);
  const transportMode = useLiveBroadcastStore((s) => s.transportMode as TransportMode);
  useBroadcasterTelemetry({
    sessionId,
    transportMode,
    active: true,
    onError: (message) => console.warn("[mobile-live-telemetry]", message),
  });
  return null;
}
