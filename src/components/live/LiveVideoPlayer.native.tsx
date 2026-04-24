import React from "react";
import { Text, View } from "react-native";

type Props = {
  liveSessionId?: string | null;
  // Accepted for API parity with the web component; ignored on native.
  localStream?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
};

/**
 * Native placeholder — real WebRTC playback needs a custom Expo
 * dev client with `react-native-webrtc` linked. In Expo Go we only
 * show the "live" status.
 */
export function LiveVideoPlayer({ liveSessionId, style }: Props) {
  return (
    <View
      style={[
        {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000",
        },
        style,
      ]}
    >
      <View
        style={{
          height: 96,
          width: 96,
          borderRadius: 48,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1f2937",
        }}
      >
        <Text style={{ fontSize: 36 }}>📡</Text>
      </View>
      <Text style={{ color: "white", fontSize: 15, marginTop: 16 }}>
        {liveSessionId ? "Live session is running" : "No stream"}
      </Text>
      <Text
        style={{
          color: "rgba(255,255,255,0.55)",
          fontSize: 11,
          marginTop: 24,
          paddingHorizontal: 24,
          textAlign: "center",
        }}
      >
        Native WebRTC video needs a custom dev client. Open this session on
        web to watch the live feed.
      </Text>
    </View>
  );
}
