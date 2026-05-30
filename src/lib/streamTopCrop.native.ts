import { STREAM_TOP_VISIBLE_FRACTION } from "@/components/live/SquareTopVideoFrame";

export const STREAM_TOP_CROP_EFFECT = "stream-top-crop";

type CroppableTrack = MediaStreamTrack & {
  _setVideoEffect?: (name: string) => void;
};

/** Applies native VideoFrameProcessor crop (requires dev client + config plugin). */
export function applyStreamTopCrop(stream: MediaStream): MediaStream {
  const track = stream.getVideoTracks()[0] as CroppableTrack | undefined;
  track?._setVideoEffect?.(STREAM_TOP_CROP_EFFECT);
  return stream;
}

export async function prepareBroadcastStream(
  stream: MediaStream,
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  applyStreamTopCrop(stream);
  return { stream, cleanup: () => undefined };
}

export { STREAM_TOP_VISIBLE_FRACTION };
