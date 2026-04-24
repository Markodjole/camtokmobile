/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { startBroadcasterP2p } from "@/lib/liveP2p.web";

type Props = {
  /** When set, the broadcaster connects WebRTC to this session id. */
  liveSessionId: string | null;
  /** Camera facing — front is the typical streamer self-view. */
  facing?: "front" | "back";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
};

/**
 * Web broadcaster preview — opens getUserMedia, renders the stream in an
 * HTMLVideoElement, and (once `liveSessionId` is set) publishes it via
 * Supabase Realtime WebRTC signaling for any viewers.
 */
export function BroadcasterCameraPreview({
  liveSessionId,
  facing = "front",
  style,
}: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let current: MediaStream | null = null;

    const start = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing === "front" ? "user" : "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: true,
        });
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        current = s;
        setStream(s);
      } catch (e) {
        if (!active) return;
        setError(
          e instanceof Error ? e.message : "Could not access camera/mic.",
        );
      }
    };
    void start();

    return () => {
      active = false;
      current?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [facing]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream as unknown as MediaProvider | null;
    el.muted = true;
    void el.play().catch(() => undefined);
  }, [stream]);

  useEffect(() => {
    if (!liveSessionId || !stream) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    startBroadcasterP2p(liveSessionId, stream)
      .then((fn) => {
        if (cancelled) fn();
        else cleanup = fn;
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Could not start broadcast.",
          );
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [liveSessionId, stream]);

  return (
    <View
      style={[
        { flex: 1, backgroundColor: "#000", overflow: "hidden" },
        style,
      ]}
    >
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
          transform: facing === "front" ? "scaleX(-1)" : undefined,
        },
      })}
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
            backgroundColor: "rgba(0,0,0,0.7)",
          }}
        >
          <Text
            style={{ color: "#fca5a5", fontSize: 12, textAlign: "center" }}
          >
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
      ) : !stream ? (
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
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
            Starting camera…
          </Text>
        </View>
      ) : null}
    </View>
  );
}
