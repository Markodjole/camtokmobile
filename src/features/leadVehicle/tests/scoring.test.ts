import { describe, expect, it } from "vitest";
import { scoreLeadVehicle } from "../domain/leadVehicle.scoring";
import type { TrackedVehicle } from "../domain/leadVehicle.types";

function track(
  partial: Partial<TrackedVehicle> & Pick<TrackedVehicle, "trackId">,
): TrackedVehicle {
  const box = partial.boundingBox ?? {
    x: 0.44,
    y: 0.4,
    width: 0.12,
    height: 0.16,
  };
  return {
    vehicleType: "motorcycle",
    classConfidence: 0.9,
    trackingConfidence: 0.85,
    boundingBox: box,
    bottomCenter: {
      x: box.x + box.width / 2,
      y: box.y + box.height,
    },
    firstSeenAtMs: 0,
    lastSeenAtMs: 2000,
    visibleDurationMs: 2000,
    missedFrameCount: 0,
    trajectory: [
      {
        timestampMs: 0,
        centerX: 0.5,
        centerY: 0.48,
        width: 0.11,
        height: 0.15,
      },
      {
        timestampMs: 1000,
        centerX: 0.5,
        centerY: 0.48,
        width: 0.12,
        height: 0.16,
      },
      {
        timestampMs: 2000,
        centerX: 0.5,
        centerY: 0.48,
        width: 0.12,
        height: 0.16,
      },
    ],
    ...partial,
  };
}

describe("leadVehicle.scoring", () => {
  it("scores centered persistent motorcycle higher than large side car", () => {
    const moto = track({
      trackId: "vehicle_1",
      vehicleType: "motorcycle",
      boundingBox: { x: 0.45, y: 0.38, width: 0.1, height: 0.16 },
    });
    const parked = track({
      trackId: "vehicle_2",
      vehicleType: "car",
      boundingBox: { x: 0.78, y: 0.55, width: 0.2, height: 0.28 },
      bottomCenter: { x: 0.88, y: 0.83 },
      visibleDurationMs: 400,
      trajectory: [
        {
          timestampMs: 1600,
          centerX: 0.88,
          centerY: 0.69,
          width: 0.2,
          height: 0.28,
        },
        {
          timestampMs: 1800,
          centerX: 0.88,
          centerY: 0.69,
          width: 0.2,
          height: 0.28,
        },
        {
          timestampMs: 2000,
          centerX: 0.88,
          centerY: 0.69,
          width: 0.2,
          height: 0.28,
        },
      ],
    });

    const motoScore = scoreLeadVehicle(moto).totalScore;
    const parkedScore = scoreLeadVehicle(parked).totalScore;
    expect(motoScore).toBeGreaterThan(parkedScore);
  });

  it("returns full score breakdown", () => {
    const s = scoreLeadVehicle(track({ trackId: "vehicle_3" }));
    expect(s.corridorScore).toBeGreaterThan(0);
    expect(s.penalties).toBeDefined();
    expect(s.totalScore).toBeGreaterThan(0);
  });
});
