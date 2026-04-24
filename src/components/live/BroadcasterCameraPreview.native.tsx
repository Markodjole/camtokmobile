import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type CameraType,
} from "expo-camera";

type Props = {
  /** Accepted for parity with the web version; native Expo Go can't WebRTC. */
  liveSessionId?: string | null;
  facing?: "front" | "back";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
};

/**
 * Native broadcaster camera preview. In Expo Go we can render the camera
 * locally with `expo-camera` but cannot push it over WebRTC (needs a custom
 * dev client with `react-native-webrtc`). The preview at least gives the
 * broadcaster immediate feedback that their camera works.
 */
export function BroadcasterCameraPreview({
  liveSessionId,
  facing = "front",
  style,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission) {
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
        <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
          Preparing camera…
        </Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={[
          {
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#000",
            padding: 16,
          },
          style,
        ]}
      >
        <Text
          style={{
            color: "white",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          Camera permission is required to go live.
        </Text>
        <Pressable
          onPress={() => void requestPermission()}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.15)",
          }}
        >
          <Text style={{ color: "white", fontSize: 12 }}>
            Grant permission
          </Text>
        </Pressable>
      </View>
    );
  }

  const cameraFacing: CameraType = facing === "back" ? "back" : "front";

  return (
    <View
      style={[
        { flex: 1, backgroundColor: "#000", overflow: "hidden" },
        style,
      ]}
    >
      <CameraView
        style={{ flex: 1 }}
        facing={cameraFacing}
        mute={false}
      />
      {liveSessionId ? (
        <View
          style={{
            position: "absolute",
            left: 12,
            top: 12,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
        >
          <Text style={{ color: "#fecaca", fontSize: 10, fontWeight: "700" }}>
            CAMERA ONLY (Expo Go)
          </Text>
        </View>
      ) : null}
    </View>
  );
}
