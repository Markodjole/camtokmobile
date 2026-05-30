import React from "react";
import { View, type ViewStyle } from "react-native";

/** Top-aligned fraction of the full camera frame kept before square crop (bottom clipped). */
export const STREAM_TOP_VISIBLE_FRACTION = 0.5;

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
  /** When true the stream is already top-cropped before WebRTC encode (square display). */
  sourceCropped?: boolean;
};

/**
 * Square video frame. With `sourceCropped` (default) the stream already has the bottom
 * half removed at encode time — show it in a 1:1 box. Otherwise clip display-only to the
 * top 50% of a full portrait frame.
 */
export function SquareTopVideoFrame({
  children,
  style,
  sourceCropped = true,
}: Props) {
  const aspectRatio = sourceCropped ? 1 : STREAM_TOP_VISIBLE_FRACTION;

  return (
    <View style={[{ flex: 1, overflow: "hidden", backgroundColor: "#000" }, style]}>
      <View style={{ width: "100%", aspectRatio }}>
        {children}
      </View>
    </View>
  );
}
