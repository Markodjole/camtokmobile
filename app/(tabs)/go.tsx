import React, { useEffect } from "react";
import { useRouter } from "expo-router";
import { View } from "react-native";

/**
 * Tab entry that routes to `/live/go`. Kept as a separate tab file so
 * expo-router can register it in the bottom tab bar.
 */
export default function GoTabRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/live/go");
  }, [router]);
  return <View className="flex-1 bg-black" />;
}
