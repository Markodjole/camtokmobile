import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { RTCView, type MediaStream } from "react-native-webrtc";
import { startViewerP2p } from "@/lib/liveP2p.native";

type Props = {
  liveSessionId?: string | null;
  localStream?: MediaStream | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
};

/**
 * Native viewer component. Connects to the broadcaster via Supabase
 * Realtime WebRTC signaling (react-native-webrtc) and renders the
 * incoming stream in an RTCView.
 */
export function LiveVideoPlayer({ liveSessionId, localStream, style }: Props) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Local stream (broadcaster self-preview) takes priority
  const activeStream = localStream ?? remoteStream;

  useEffect(() => {
    if (!liveSessionId || localStream) {
      setRemoteStream(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      startViewerP2p(
        liveSessionId,
        (s) => {
          if (!cancelled) {
            setRemoteStream(s as MediaStream);
            setError(null);
          }
        },
        (msg) => {
          if (!cancelled) setError(msg);
        },
      )
        .then((cleanup) => {
          if (cancelled) cleanup();
          else cleanupRef.current = cleanup;
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Connection error");
        });
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cleanupRef.current?.();
      cleanupRef.current = null;
      setRemoteStream(null);
    };
  }, [liveSessionId, localStream]);

  const streamURL = activeStream
    ? (activeStream as unknown as { toURL: () => string }).toURL()
    : null;

  const connecting = !localStream && liveSessionId && !remoteStream && !error;

  return (
    <View style={[{ flex: 1, backgroundColor: "#000" }, style]}>
      {streamURL ? (
        <RTCView
          streamURL={streamURL}
          style={{ flex: 1 }}
          objectFit="cover"
          mirror={false}
          zOrder={0}
        />
      ) : null}

      {connecting ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.65)",
          }}
        >
          <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
            Connecting to live stream…
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
            padding: 24,
            backgroundColor: "rgba(0,0,0,0.75)",
          }}
        >
          <Text style={{ color: "#fca5a5", fontSize: 12, textAlign: "center" }}>
            {error}
          </Text>
        </View>
      ) : null}

      {!liveSessionId && !localStream ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
            No stream
          </Text>
        </View>
      ) : null}
    </View>
  );
}
