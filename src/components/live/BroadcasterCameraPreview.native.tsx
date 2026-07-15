import React, { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import {
  CameraView,
} from "expo-camera";
import { checkBroadcastPermissions } from "@/lib/broadcastPermissions";
import { startBroadcasterP2p } from "@/lib/liveP2p.native";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import { TWO_WHEELED_MODES } from "@/lib/transportMode";
import { SquareTopVideoFrame } from "@/components/live/SquareTopVideoFrame";
import { prepareBroadcastStream } from "@/lib/streamTopCrop.native";
import { buildWideVideoConstraints } from "@/lib/wideCamera.native";

type MediaStream = {
  getTracks: () => Array<{ stop?: () => void }>;
  toURL: () => string;
};

type WebRtcRuntime = {
  mediaDevices: {
    getUserMedia: (constraints: unknown) => Promise<MediaStream>;
    enumerateDevices: () => Promise<
      Array<{ deviceId: string; kind: string; label: string; facing?: string }>
    >;
  };
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
  liveSessionId: string | null;
  facing?: "front" | "back";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
};

/**
 * Native broadcaster camera preview.
 *
 * - Dev client (react-native-webrtc available): full WebRTC publish via
 *   mediaDevices.getUserMedia + RTCView.
 * - Expo Go fallback: expo-camera for local preview only (video is not
 *   streamed to viewers, but broadcaster can still go live with GPS/heartbeat).
 */
export function BroadcasterCameraPreview({ liveSessionId, facing = "back", style }: Props) {
  // ── WebRTC path (dev client) ───────────────────────────────────────────
  if (rtc) {
    return (
      <WebRtcPreview
        rtc={rtc}
        liveSessionId={liveSessionId}
        facing={facing}
        style={style}
      />
    );
  }

  // ── Expo Go fallback: expo-camera local preview ────────────────────────
  return (
    <ExpoGoPreview liveSessionId={liveSessionId} facing={facing} style={style} />
  );
}

// ── WebRTC component (only rendered when react-native-webrtc is available) ──

function WebRtcPreview({
  rtc: runtime,
  liveSessionId,
  facing,
  style,
}: Props & { rtc: WebRtcRuntime }) {
  const setSession = useLiveBroadcastStore((s) => s.setSession);
  const setLocalStream = useLiveBroadcastStore((s) => s.setLocalStream);
  const transportMode = useLiveBroadcastStore((s) => s.transportMode);
  const [mediaGranted, setMediaGranted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cleanupBroadcast = useRef<(() => void) | null>(null);
  const cropCleanup = useRef<(() => void) | null>(null);
  const useWide = TWO_WHEELED_MODES.has(transportMode);

  useEffect(() => {
    let active = true;
    void (async () => {
      const snap = await checkBroadcastPermissions();
      if (!active) return;
      setMediaGranted(
        snap.permissions.find((p) => p.id === "camera")?.granted === true &&
          snap.permissions.find((p) => p.id === "microphone")?.granted === true,
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!mediaGranted) return;
    let active = true;
    let current: MediaStream | null = null;
    const start = async () => {
      try {
        const baseVideo: Record<string, unknown> = {
          facingMode: facing === "front" ? "user" : "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        };
        const videoConstraints =
          useWide && facing === "back"
            ? await buildWideVideoConstraints(runtime.mediaDevices, baseVideo)
            : baseVideo;
        const s = (await Promise.race([
          runtime.mediaDevices.getUserMedia({
            audio: true,
            video: videoConstraints,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "Camera startup timed out. Please ensure camera and microphone permissions are granted.",
                  ),
                ),
              12000,
            ),
          ),
        ])) as MediaStream;
        if (!active) { s.getTracks().forEach((t) => t.stop?.()); return; }
        cropCleanup.current?.();
        const { stream: broadcastStream, cleanup: releaseCrop } =
          await prepareBroadcastStream(s as unknown as globalThis.MediaStream);
        if (!active) {
          releaseCrop();
          broadcastStream.getTracks().forEach((t) => t.stop?.());
          return;
        }
        cropCleanup.current = releaseCrop;
        current = broadcastStream as unknown as MediaStream;
        setStream(current);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Could not access camera/mic.");
      }
    };
    void start();
    return () => {
      active = false;
      cropCleanup.current?.();
      cropCleanup.current = null;
      current?.getTracks().forEach((t) => t.stop?.());
      setStream(null);
    };
  }, [facing, mediaGranted, runtime, useWide]);

  // Push session id + local stream into the global broadcast store so the
  // room screen can render the broadcaster's own camera even if this preview
  // is briefly hidden behind another modal. We deliberately do NOT clear the
  // store on unmount — `endLive` on the Go Live screen owns that lifecycle.
  useEffect(() => {
    setSession(liveSessionId ?? null);
  }, [liveSessionId, setSession]);

  useEffect(() => {
    setLocalStream(stream as unknown as { toURL: () => string } | null);
  }, [setLocalStream, stream]);

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
        cleanupBroadcast.current = fn;
        useLiveBroadcastStore.getState().setP2pCleanup(liveSessionId, fn);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Broadcast failed.");
        }
      });
    return () => {
      cancelled = true;
      cleanupBroadcast.current = null;
      // Keep WebRTC alive when navigating to the driver room — cleared on end session.
    };
  }, [liveSessionId, stream]);

  // Phone calls can pause tracks — re-enable when the app is usable again.
  useEffect(() => {
    if (!stream) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && state !== "inactive") return;
      for (const track of stream.getTracks()) {
        const t = track as { enabled?: boolean; readyState?: string };
        if (t.readyState === "live") t.enabled = true;
      }
    });
    return () => sub.remove();
  }, [stream]);

  const streamURL = stream ? (stream as unknown as { toURL: () => string }).toURL() : null;

  if (!mediaGranted) {
    return (
      <View style={[{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 16 }, style]}>
        <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center" }}>
          Camera and microphone were not granted. Go back to Go Live and allow permissions first.
        </Text>
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, backgroundColor: "#000" }, style]}>
      {streamURL ? (
        <SquareTopVideoFrame style={{ flex: 1 }}>
          <runtime.RTCView
            streamURL={streamURL}
            style={{ flex: 1 }}
            objectFit="contain"
            mirror={facing === "front"}
            zOrder={0}
          />
        </SquareTopVideoFrame>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
            Starting camera…
          </Text>
        </View>
      )}
      {liveSessionId && streamURL ? (
        <View style={{
          position: "absolute", top: 12, left: 12,
          paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
          backgroundColor: "rgba(239,68,68,0.25)",
        }}>
          <Text style={{ color: "#f87171", fontSize: 11, fontWeight: "700" }}>● LIVE</Text>
        </View>
      ) : null}
      {error ? (
        <View style={{
          position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
          alignItems: "center", justifyContent: "center",
          padding: 16, backgroundColor: "rgba(0,0,0,0.75)",
        }}>
          <Text style={{ color: "#fca5a5", fontSize: 12, textAlign: "center" }}>{error}</Text>
          <Pressable onPress={() => setError(null)} style={{
            marginTop: 12, paddingHorizontal: 14, paddingVertical: 6,
            borderRadius: 999, backgroundColor: "rgba(255,255,255,0.15)",
          }}>
            <Text style={{ color: "white", fontSize: 11 }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ── Expo Go fallback: expo-camera ─────────────────────────────────────────────

function ExpoGoPreview({ liveSessionId, facing, style }: Props) {
  const [cameraGranted, setCameraGranted] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const snap = await checkBroadcastPermissions();
      if (!active) return;
      setCameraGranted(
        snap.permissions.find((p) => p.id === "camera")?.granted === true,
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!cameraGranted) {
    return (
      <View style={[{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 16 }, style]}>
        <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center" }}>
          Camera permission was not granted. Go back to Go Live and allow permissions first.
        </Text>
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, backgroundColor: "#000", overflow: "hidden" }, style]}>
      <CameraView style={{ flex: 1 }} facing={facing === "back" ? "back" : "front"} />
      {liveSessionId ? (
        <View style={{
          position: "absolute", top: 12, left: 12,
          paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
          backgroundColor: "rgba(239,68,68,0.25)",
        }}>
          <Text style={{ color: "#f87171", fontSize: 11, fontWeight: "700" }}>● LIVE (camera only)</Text>
        </View>
      ) : null}
      <View style={{
        position: "absolute", bottom: 10, left: 0, right: 0,
        alignItems: "center",
      }}>
        <Text style={{
          color: "rgba(255,255,255,0.5)", fontSize: 10,
          backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 8,
          paddingVertical: 3, borderRadius: 4, overflow: "hidden",
        }}>
          Install dev client for live video streaming
        </Text>
      </View>
    </View>
  );
}
