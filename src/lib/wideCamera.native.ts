import type { VideoInputDevice, WideVideoConstraints } from "./wideCamera";

const ULTRA_WIDE_LABEL = /ultra.?wide|wide.?angle|0\.5x|0\.6x|fisheye/i;
const TELE_LABEL = /tele|telephoto|\b2x\b|\b3x\b|\b5x\b|\b10x\b|zoom/i;

type MediaDevicesLike = {
  enumerateDevices: () => Promise<VideoInputDevice[]>;
};

/** Pick the rear ultra-wide camera when the phone exposes multiple back lenses. */
export async function pickWideRearDeviceId(
  mediaDevices: MediaDevicesLike,
): Promise<string | null> {
  const devices = await mediaDevices.enumerateDevices();
  const rear = devices.filter(
    (d) => d.kind === "videoinput" && d.facing === "environment",
  );
  if (rear.length <= 1) return null;

  const labeled = rear.find(
    (d) => ULTRA_WIDE_LABEL.test(d.label) && !TELE_LABEL.test(d.label),
  );
  if (labeled) return labeled.deviceId;

  const nonTele = rear.filter((d) => !TELE_LABEL.test(d.label));
  if (nonTele.length >= 2) {
    // Common Android order: main first, ultra-wide second.
    return nonTele[1]?.deviceId ?? nonTele[nonTele.length - 1]?.deviceId ?? null;
  }

  return rear[rear.length - 1]?.deviceId ?? null;
}

export async function buildWideVideoConstraints(
  mediaDevices: MediaDevicesLike,
  base: WideVideoConstraints,
): Promise<WideVideoConstraints> {
  const deviceId = await pickWideRearDeviceId(mediaDevices);
  if (!deviceId) return base;
  return { ...base, deviceId };
}
