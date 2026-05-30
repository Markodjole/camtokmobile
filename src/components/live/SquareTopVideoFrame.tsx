import React from "react";
import { View, type ViewStyle } from "react-native";

/** Top-aligned fraction of the full camera frame kept before square crop (bottom clipped). */
export const STREAM_TOP_VISIBLE_FRACTION = 0.5;

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
  /**
   * When true the stream is already top-cropped at encode time (full width kept).
   * Fits width inside the square — no side crop.
   */
  sourceCropped?: boolean;
};

/**
 * Square viewport. Encoded streams use width-first fit (full ultra-wide FOV).
 * Uncropped fallback uses a tall inner clip so cover keeps full width and cuts bottom.
 */
export function SquareTopVideoFrame({
  children,
  style,
  sourceCropped = true,
}: Props) {
  if (sourceCropped) {
    return (
      <View
        style={[
          { flex: 1, aspectRatio: 1, overflow: "hidden", backgroundColor: "#000" },
          style,
        ]}
      >
        <View style={{ width: "100%", height: "100%", justifyContent: "flex-start" }}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, overflow: "hidden", backgroundColor: "#000" }, style]}>
      <View style={{ width: "100%", aspectRatio: STREAM_TOP_VISIBLE_FRACTION }}>
        {children}
      </View>
    </View>
  );
}
