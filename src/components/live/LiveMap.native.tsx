import React, { useMemo } from "react";
import { View } from "react-native";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from "react-native-maps";
import type { DriverRouteInstruction, LiveRoutePoint } from "@/types/live";

type Props = {
  routePoints: LiveRoutePoint[];
  driverRoute?: DriverRouteInstruction | null;
  followDriver?: boolean;
};

export function LiveMap({ routePoints, driverRoute, followDriver = true }: Props) {
  const last = routePoints[routePoints.length - 1];

  const region: Region | undefined = useMemo(() => {
    if (!last) return undefined;
    return {
      latitude: last.lat,
      longitude: last.lng,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    };
  }, [last]);

  const historyCoords = useMemo(
    () => routePoints.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [routePoints],
  );

  const railCoords = useMemo(
    () =>
      (driverRoute?.routePolyline ?? []).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [driverRoute],
  );

  if (!region) {
    return <View className="flex-1 bg-black" />;
  }

  return (
    <MapView
      provider={PROVIDER_DEFAULT}
      style={{ flex: 1 }}
      initialRegion={region}
      region={followDriver ? region : undefined}
      showsUserLocation={false}
      showsCompass={false}
      toolbarEnabled={false}
    >
      {historyCoords.length > 1 ? (
        <Polyline coordinates={historyCoords} strokeColor="#10b981" strokeWidth={5} />
      ) : null}
      {railCoords.length > 1 ? (
        <>
          <Polyline
            coordinates={railCoords}
            strokeColor="rgba(29,78,216,0.35)"
            strokeWidth={14}
          />
          <Polyline coordinates={railCoords} strokeColor="#3b82f6" strokeWidth={7} />
        </>
      ) : null}
      {driverRoute?.turnPoint ? (
        <>
          <Circle
            center={{
              latitude: driverRoute.turnPoint.lat,
              longitude: driverRoute.turnPoint.lng,
            }}
            radius={16}
            strokeColor="#2563eb"
            strokeWidth={2}
            fillColor="rgba(59,130,246,0.22)"
          />
          <Marker
            coordinate={{
              latitude: driverRoute.turnPoint.lat,
              longitude: driverRoute.turnPoint.lng,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View className="h-4 w-4 rounded-full border-2 border-white bg-primary" />
          </Marker>
        </>
      ) : null}
      {last ? (
        <Marker
          coordinate={{ latitude: last.lat, longitude: last.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          rotation={last.heading ?? 0}
          flat
        >
          <View className="h-5 w-5 rounded-full border-2 border-white bg-accent" />
        </Marker>
      ) : null}
    </MapView>
  );
}
