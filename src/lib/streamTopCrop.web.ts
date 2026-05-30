import { STREAM_TOP_VISIBLE_FRACTION } from "@/components/live/SquareTopVideoFrame";

export const STREAM_TOP_CROP_EFFECT = "stream-top-crop";

export function applyStreamTopCrop(stream: MediaStream): MediaStream {
  return stream;
}

/** Canvas crop — keeps top fraction, drops bottom before WebRTC send. */
export async function prepareBroadcastStream(
  source: MediaStream,
  topFraction = STREAM_TOP_VISIBLE_FRACTION,
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const videoTrack = source.getVideoTracks()[0];
  if (!videoTrack) {
    return { stream: source, cleanup: () => undefined };
  }

  const video = document.createElement("video");
  video.srcObject = source;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Video metadata failed"));
    void video.play().catch(reject);
  });

  const w = video.videoWidth;
  const h = video.videoHeight;
  const cropH = Math.max(1, Math.round(h * topFraction));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    video.srcObject = null;
    return { stream: source, cleanup: () => undefined };
  }

  let raf = 0;
  const draw = () => {
    ctx.drawImage(video, 0, 0, w, cropH, 0, 0, w, cropH);
    raf = requestAnimationFrame(draw);
  };
  draw();

  const cropped = canvas.captureStream(30);
  source.getAudioTracks().forEach((t) => cropped.addTrack(t));

  const cleanup = () => {
    cancelAnimationFrame(raf);
    cropped.getVideoTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  return { stream: cropped, cleanup };
}

export { STREAM_TOP_VISIBLE_FRACTION };
