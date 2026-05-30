/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { startBroadcasterP2p } from "@/lib/liveP2p.web";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import { TWO_WHEELED_MODES } from "@/lib/transportMode";
import { SquareTopVideoFrame } from "@/components/live/SquareTopVideoFrame";
import { prepareBroadcastStream } from "@/lib/streamTopCrop.web";
import { buildWideVideoConstraints } from "@/lib/wideCamera.web";

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
  const cropCleanup = useRef<(() => void) | null>(null);
  const transportMode = useLiveBroadcastStore((s) => s.transportMode);
  const useWide = TWO_WHEELED_MODES.has(transportMode);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let current: MediaStream | null = null;

    const start = async () => {
      try {
        const baseVideo = {
          facingMode: facing === "front" ? "user" : "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        };
        const video =
          useWide && facing === "back"
            ? ((await buildWideVideoConstraints(
                navigator.mediaDevices,
                baseVideo,
              )) as MediaTrackConstraints)
            : (baseVideo as MediaTrackConstraints);

        let s: MediaStream;
        try {
          s = await navigator.mediaDevices.getUserMedia({ video, audio: true });
        } catch {
          s = await navigator.mediaDevices.getUserMedia({
            video: baseVideo,
            audio: true,
          });
        }
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        current = s;
        cropCleanup.current?.();
        const { stream: broadcastStream, cleanup } = await prepareBroadcastStream(s);
        if (!active) {
          cleanup();
          broadcastStream.getTracks().forEach((t) => t.stop());
          return;
        }
        cropCleanup.current = cleanup;
        current = broadcastStream;
        setStream(broadcastStream);
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
      cropCleanup.current?.();
      cropCleanup.current = null;
      current?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [facing, useWide]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream as unknown as MediaProvider | null;
    el.muted = true;
    void el.play().catch(() => undefined);
  }, [stream]);

  useEffect(() => {
    if (!liveSessionId || !stream) return;

    const store = useLiveBroadcastStore.getState();
    if (store.p2pSessionId === liveSessionId && store.p2pCleanup) {
      return;
    }

    store.p2pCleanup?.();
    let cancelled = false;
    startBroadcasterP2p(liveSessionId, stream)
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        useLiveBroadcastStore.getState().setP2pCleanup(liveSessionId, fn);
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Could not start broadcast.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [liveSessionId, stream]);

  return (
    <View
      style={[
        { flex: 1, backgroundColor: "#000", overflow: "hidden" },
        style,
      ]}
    >
      <SquareTopVideoFrame style={{ flex: 1 }}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {React.createElement("video" as any, {
          ref,
          playsInline: true,
          autoPlay: true,
          muted: true,
          style: {
            width: "100%",
            height: "100%",
            objectFit: "contain",
            transform: facing === "front" ? "scaleX(-1)" : undefined,
          },
        })}
      </SquareTopVideoFrame>
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
