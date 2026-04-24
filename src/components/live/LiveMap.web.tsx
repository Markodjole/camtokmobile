import React from "react";
import { Text, View } from "react-native";
import type { RoutePoint } from "@/types/live";

type Props = {
  routePoints: RoutePoint[];
  driverRoute?: unknown;
  followDriver?: boolean;
};

/**
 * Web stub for the native map. `react-native-maps` is native-only, so on
 * web we render a simple panel showing the latest driver position — the
 * user mainly sees the video PiP anyway.
 */
export function LiveMap({ routePoints }: Props) {
  const last = routePoints[routePoints.length - 1];
  return (
    <View className="flex-1 items-center justify-center bg-neutral-900 px-6">
      <Text className="text-center text-base font-semibold text-white">
        Live map
      </Text>
      {last ? (
        <Text className="mt-2 text-center text-sm text-white/60">
          {last.lat.toFixed(5)}, {last.lng.toFixed(5)}
        </Text>
      ) : (
        <Text className="mt-2 text-center text-sm text-white/60">
          Waiting for GPS…
        </Text>
      )}
    </View>
  );
}
