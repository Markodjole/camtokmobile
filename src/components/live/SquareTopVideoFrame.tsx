import React from "react";
import { View, type ViewStyle } from "react-native";

/** Fraction of frame height kept (top). 1.0 = full frame streamed (no crop). */
export const STREAM_TOP_VISIBLE_FRACTION = 1.0;

/** Typical portrait width/height before crop (9:16). */
export const PORTRAIT_FRAME_ASPECT = 9 / 16;

/** Encoded stream width/height after top crop at full width. */
export const CROPPED_STREAM_ASPECT_RATIO =
  PORTRAIT_FRAME_ASPECT / STREAM_TOP_VISIBLE_FRACTION;

export function streamPipDimensions(maxWidth: number) {
  return {
    width: maxWidth,
    height: Math.round(maxWidth / CROPPED_STREAM_ASPECT_RATIO),
  };
}

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
  /** When true the stream is already top-cropped at encode time (full width kept). */
  sourceCropped?: boolean;
};

/**
 * Video frame at the encoded stream's natural aspect (wide, top-cropped).
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
          {
            flex: 1,
            width: "100%",
            aspectRatio: CROPPED_STREAM_ASPECT_RATIO,
            overflow: "hidden",
            backgroundColor: "#000",
          },
          style,
        ]}
      >
        {children}
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
