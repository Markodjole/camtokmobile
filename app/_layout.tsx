import "../global.css";
import { Redirect, Stack, usePathname, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { View } from "react-native";
import { AppBottomBar, AppTopBar } from "@/components/navigation/AppChrome";

export default function RootLayout() {
  return (
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
    return <Redirect href="/(tabs)/live" />;
  }

  // Fullscreen screens manage their own chrome
  const isFullscreen =
    pathname.startsWith("/room/") || pathname.startsWith("/live/go/");

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
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
          <Stack.Screen name="live/go/index" options={{ presentation: "modal" }} />
          <Stack.Screen
            name="live/go/[characterId]"
            options={{ presentation: "fullScreenModal" }}
          />
        </Stack>
      </View>
      {!isFullscreen && <AppBottomBar />}
    </View>
  );
}
