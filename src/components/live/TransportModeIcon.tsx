import React from "react";
import { Text, type TextProps } from "react-native";

/** Tiny emoji mapping — keeps us icon-library free. */
export function transportEmoji(mode: string | null | undefined): string {
  switch (mode) {
    case "walking":
    case "walk":
      return "🚶";
    case "run":
      return "🏃";
    case "bike":
      return "🚴";
    case "scooter":
      return "🛴";
    case "motorcycle":
      return "🏍️";
    case "car":
      return "🚗";
    default:
      return "📍";
  }
}

export function TransportModeIcon({
  mode,
  ...rest
}: { mode: string | null | undefined } & TextProps) {
  return <Text {...rest}>{transportEmoji(mode)}</Text>;
}
