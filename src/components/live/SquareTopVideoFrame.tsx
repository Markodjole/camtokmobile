import React from "react";
import { View, type ViewStyle } from "react-native";

/** Top-aligned fraction of the video frame shown before square crop (bottom clipped). */
export const STREAM_TOP_VISIBLE_FRACTION = 0.7;

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
};

/**
 * Clips a portrait video stream to a square showing only the top 70%.
 * E.g. 500×1000 → visible region 500×700, displayed as 500×500 (bottom cut off).
 */
export function SquareTopVideoFrame({ children, style }: Props) {
  return (
    <View style={[{ flex: 1, overflow: "hidden", backgroundColor: "#000" }, style]}>
      <View style={{ width: "100%", aspectRatio: STREAM_TOP_VISIBLE_FRACTION }}>
        {children}
      </View>
    </View>
  );
}
