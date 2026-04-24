/**
 * Native stub for WebRTC P2P. Expo Go does not ship `react-native-webrtc`
 * so RTCPeerConnection isn't available there. When we move to a custom dev
 * client we'll swap this for a real implementation (mirroring liveP2p.web.ts
 * but using react-native-webrtc's APIs).
 *
 * For now, returning a noop cleanup keeps the rest of the app working and
 * callers fall through to the placeholder UI in LiveVideoPlayer.native.tsx.
 */

const NATIVE_UNSUPPORTED =
  "Live WebRTC streaming requires a custom Expo dev client (react-native-webrtc). Open this session in the web build for full video.";

export async function startBroadcasterP2p(
  _liveSessionId: string,
  _stream: unknown,
): Promise<() => void> {
  console.warn(NATIVE_UNSUPPORTED);
  return () => undefined;
}

export async function startViewerP2p(
  _liveSessionId: string,
  _onRemoteStream: (stream: unknown) => void,
  onFailure?: (message: string) => void,
): Promise<() => void> {
  onFailure?.(NATIVE_UNSUPPORTED);
  return () => undefined;
}
