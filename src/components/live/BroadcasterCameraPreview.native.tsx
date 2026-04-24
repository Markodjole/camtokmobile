import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  mediaDevices,
  RTCView,
  type MediaStream,
} from "react-native-webrtc";
import { startBroadcasterP2p } from "@/lib/liveP2p.native";

type Props = {
  liveSessionId: string | null;
  facing?: "front" | "back";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
};

/**
 * Native broadcaster preview + WebRTC publisher.
 *
 * - Opens the camera via react-native-webrtc's `mediaDevices.getUserMedia`
 *   (returns a proper MediaStream that RTCView and RTCPeerConnection both
 *   understand natively).
 * - Once `liveSessionId` is set, starts the Supabase Realtime WebRTC
 *   broadcaster so viewers receive the stream end-to-end.
 */
export function BroadcasterCameraPreview({ liveSessionId, facing = "front", style }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cleanupBroadcast = useRef<(() => void) | null>(null);

  // ── Open camera ──────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    let current: MediaStream | null = null;

    const start = async () => {
      try {
        const constraints = {
          audio: true,
          video: {
            facingMode: facing === "front" ? "user" : "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };
        const s = (await mediaDevices.getUserMedia(constraints)) as MediaStream;
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        current = s;
        setStream(s);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Could not access camera/mic.");
      }
    };
    void start();

    return () => {
      active = false;
      current?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [facing]);

  // ── Start / stop WebRTC broadcast when session goes live ─────────────────
  useEffect(() => {
    if (!liveSessionId || !stream) return;
    let cancelled = false;

    startBroadcasterP2p(liveSessionId, stream)
      .then((cleanup) => {
        if (cancelled) cleanup();
        else cleanupBroadcast.current = cleanup;
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Broadcast start failed.");
      });

    return () => {
      cancelled = true;
      cleanupBroadcast.current?.();
      cleanupBroadcast.current = null;
    };
  }, [liveSessionId, stream]);

  const streamURL = stream ? (stream as unknown as { toURL: () => string }).toURL() : null;

  return (
    <View style={[{ flex: 1, backgroundColor: "#000" }, style]}>
      {streamURL ? (
        <RTCView
          streamURL={streamURL}
          style={{ flex: 1 }}
          objectFit="cover"
          mirror={facing === "front"}
          zOrder={0}
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
            Starting camera…
          </Text>
        </View>
      )}

      {liveSessionId && streamURL ? (
        <View
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: "rgba(239,68,68,0.25)",
          }}
        >
          <Text style={{ color: "#f87171", fontSize: 11, fontWeight: "700" }}>
            ● LIVE
          </Text>
        </View>
      ) : null}

      {error ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            backgroundColor: "rgba(0,0,0,0.75)",
          }}
        >
          <Text style={{ color: "#fca5a5", fontSize: 12, textAlign: "center" }}>
            {error}
          </Text>
          <Pressable
            onPress={() => setError(null)}
            style={{
              marginTop: 12,
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.15)",
            }}
          >
            <Text style={{ color: "white", fontSize: 11 }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
