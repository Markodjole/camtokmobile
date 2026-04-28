import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { startViewerP2p } from "@/lib/liveP2p.native";

type MediaStream = { toURL: () => string };
type WebRtcRuntime = {
  RTCView: React.ComponentType<{
    streamURL: string;
    style?: unknown;
    objectFit?: "cover" | "contain";
    mirror?: boolean;
    zOrder?: number;
  }>;
};

let rtc: WebRtcRuntime | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  rtc = require("react-native-webrtc") as WebRtcRuntime;
} catch {
  rtc = null;
}

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
  const [retryKey, setRetryKey] = useState(0);
  const [connectingSec, setConnectingSec] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Local stream (broadcaster self-preview) takes priority
  const activeStream = localStream ?? remoteStream;

  useEffect(() => {
    if (!liveSessionId || localStream) {
      setRemoteStream(null);
      setError(null);
      setConnectingSec(0);
      return;
    }
    if (!rtc) {
      return;
    }

    let cancelled = false;
    setConnectingSec(0);

    // Connecting elapsed-seconds counter
    timerRef.current = setInterval(() => {
      setConnectingSec((n) => n + 1);
    }, 1000);

    const timer = setTimeout(() => {
      if (cancelled) return;
      startViewerP2p(
        liveSessionId,
        (s) => {
          if (!cancelled) {
            setRemoteStream(s as unknown as MediaStream);
            setError(null);
            setConnectingSec(0);
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          }
        },
        (msg) => {
          if (!cancelled) {
            setError(msg);
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          }
        },
      )
        .then((cleanup) => {
          if (cancelled) cleanup();
          else cleanupRef.current = cleanup;
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "Connection error");
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          }
        });
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      cleanupRef.current?.();
      cleanupRef.current = null;
      setRemoteStream(null);
      setConnectingSec(0);
    };
  // retryKey forces a full reconnect when the user taps Retry
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSessionId, localStream, retryKey]);

  const streamURL = activeStream
    ? (activeStream as unknown as { toURL: () => string }).toURL()
    : null;

  // In Expo Go (no rtc) we never connect, so never show the spinner
  const connecting = !!rtc && !localStream && liveSessionId && !remoteStream && !error;
  const timedOut = connecting && connectingSec >= 30;

  return (
    <View style={[{ flex: 1, backgroundColor: "#000" }, style]}>
      {streamURL ? (
        rtc ? (
        <rtc.RTCView
          streamURL={streamURL}
          style={{ flex: 1 }}
          objectFit="cover"
          mirror={false}
          zOrder={0}
        />
        ) : null
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
            padding: 12,
          }}
        >
          {timedOut ? (
            <>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, textAlign: "center" }}>
                Stream offline or not yet started
              </Text>
              <Pressable
                onPress={() => { setError(null); setRetryKey((k) => k + 1); }}
                style={{
                  marginTop: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.15)",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 12 }}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, textAlign: "center" }}>
              Connecting… ({connectingSec}s)
            </Text>
          )}
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
          <Pressable
            onPress={() => { setError(null); setRetryKey((k) => k + 1); }}
            style={{
              marginTop: 10,
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.15)",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 12 }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {/* When no stream is active show a quiet indicator */}
      {!streamURL && !connecting ? (
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
          <Text style={{ fontSize: 24 }}>📡</Text>
          {!rtc && liveSessionId ? (
            <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, marginTop: 4, textAlign: "center", paddingHorizontal: 8 }}>
              Video needs dev client
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
