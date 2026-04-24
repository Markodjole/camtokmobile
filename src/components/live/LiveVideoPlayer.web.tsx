/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { startViewerP2p } from "@/lib/liveP2p.web";

type Props = {
  /** Broadcaster: the local MediaStream (getUserMedia). */
  localStream?: MediaStream | null;
  /** Viewer: the live session id to connect to via Supabase Realtime signaling. */
  liveSessionId?: string | null;
  /** Extra class name for sizing. */
  style?: any;
};

/**
 * Web implementation of the live video player — a direct port of the
 * reference repo's `LiveVideoPlayer.tsx`. Renders an HTMLVideoElement
 * wrapped inside a react-native-web View so it layers correctly with
 * the rest of the UI.
 */
export function LiveVideoPlayer({ localStream, liveSessionId, style }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (localStream) {
      el.srcObject = localStream as unknown as MediaProvider;
      el.muted = true;
      void el.play().catch(() => undefined);
      return;
    }
    el.srcObject = null;
  }, [localStream]);

  useEffect(() => {
    if (localStream || !liveSessionId) {
      setRemoteStream(null);
      setSignalError(null);
      setSoundOn(false);
      return;
    }

    let cancelled = false;
    const cleanupRef: { fn: (() => void) | undefined } = { fn: undefined };

    const startDelay = setTimeout(() => {
      if (cancelled) return;
      startViewerP2p(
        liveSessionId,
        (stream) => {
          if (!cancelled) {
            setRemoteStream(stream);
            setSignalError(null);
          }
        },
        (msg) => {
          if (!cancelled) setSignalError(msg);
        },
      )
        .then((cleanup) => {
          if (cancelled) cleanup();
          else cleanupRef.fn = cleanup;
        })
        .catch((e) => {
          if (!cancelled)
            setSignalError(e instanceof Error ? e.message : "Could not connect");
        });
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(startDelay);
      cleanupRef.fn?.();
      cleanupRef.fn = undefined;
      setRemoteStream(null);
    };
  }, [liveSessionId, localStream]);

  useEffect(() => {
    const el = ref.current;
    if (!el || localStream) return;
    el.srcObject = remoteStream as unknown as MediaProvider | null;
    el.muted = !soundOn;
    void el.play().catch(() => undefined);
  }, [remoteStream, localStream, soundOn]);

  const viewerConnecting =
    !localStream && liveSessionId && !remoteStream && !signalError;

  return (
    <View style={[{ flex: 1, backgroundColor: "#000", overflow: "hidden" }, style]}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {React.createElement("video" as any, {
        ref,
        playsInline: true,
        autoPlay: true,
        muted: true,
        style: {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          background: "#000",
        },
      })}
      {viewerConnecting ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
        >
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
            Connecting to live stream…
          </Text>
        </View>
      ) : null}
      {!localStream && liveSessionId && remoteStream && !soundOn ? (
        <Pressable
          onPress={() => setSoundOn(true)}
          style={{
            position: "absolute",
            alignSelf: "center",
            bottom: 12,
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: "rgba(255,255,255,0.15)",
            borderRadius: 999,
          }}
        >
          <Text style={{ color: "white", fontSize: 11 }}>Tap for sound</Text>
        </Pressable>
      ) : null}
      {signalError ? (
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
            backgroundColor: "rgba(0,0,0,0.8)",
          }}
        >
          <Text style={{ color: "#fca5a5", fontSize: 12, textAlign: "center" }}>
            {signalError}
          </Text>
        </View>
      ) : null}
      {!localStream && !liveSessionId ? (
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
          <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
            No stream
          </Text>
        </View>
      ) : null}
    </View>
  );
}
