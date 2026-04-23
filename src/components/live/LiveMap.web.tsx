import React from "react";
import { Text, View } from "react-native";
import type { DriverRouteInstruction, LiveRoutePoint } from "@/types/live";

type Props = {
  routePoints: LiveRoutePoint[];
  driverRoute?: DriverRouteInstruction | null;
  followDriver?: boolean;
};

export function LiveMap({ routePoints }: Props) {
  const last = routePoints[routePoints.length - 1];
  return (
    <View className="flex-1 items-center justify-center bg-black px-6">
      <Text className="text-center text-base font-semibold text-white">
        Map preview is available on iOS/Android dev client.
      </Text>
      {last ? (
        <Text className="mt-2 text-center text-sm text-muted-foreground">
          Driver position: {last.lat.toFixed(5)}, {last.lng.toFixed(5)}
        </Text>
      ) : (
        <Text className="mt-2 text-center text-sm text-muted-foreground">
          Waiting for route points...
        </Text>
      )}
    </View>
  );
}
