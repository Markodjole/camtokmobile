import { describe, expect, it } from "vitest";
import { classifyRelativeMovement } from "../domain/leadVehicle.motion";
import type { TrackedVehicle } from "../domain/leadVehicle.types";

function base(traj: TrackedVehicle["trajectory"]): TrackedVehicle {
  return {
    trackId: "vehicle_1",
    vehicleType: "vehicle",
    classConfidence: 0.8,
    trackingConfidence: 0.8,
    boundingBox: { x: 0.4, y: 0.4, width: 0.15, height: 0.18 },
    bottomCenter: { x: 0.475, y: 0.58 },
    firstSeenAtMs: traj[0]?.timestampMs ?? 0,
    lastSeenAtMs: traj[traj.length - 1]?.timestampMs ?? 0,
    visibleDurationMs: 1000,
    missedFrameCount: 0,
    trajectory: traj,
  };
}

describe("leadVehicle.motion", () => {
  it("classifies approaching when box grows", () => {
    const state = classifyRelativeMovement(
      base([
        { timestampMs: 0, centerX: 0.5, centerY: 0.5, width: 0.1, height: 0.1 },
        {
          timestampMs: 400,
          centerX: 0.5,
          centerY: 0.5,
          width: 0.14,
          height: 0.14,
        },
        {
          timestampMs: 800,
          centerX: 0.5,
          centerY: 0.5,
          width: 0.22,
          height: 0.22,
        },
      ]),
    );
    expect(state).toBe("approaching");
  });

  it("classifies moving left", () => {
    const state = classifyRelativeMovement(
      base([
        { timestampMs: 0, centerX: 0.55, centerY: 0.5, width: 0.12, height: 0.14 },
        {
          timestampMs: 400,
          centerX: 0.48,
          centerY: 0.5,
          width: 0.12,
          height: 0.14,
        },
        {
          timestampMs: 800,
          centerX: 0.4,
          centerY: 0.5,
          width: 0.12,
          height: 0.14,
        },
      ]),
    );
    expect(state).toBe("moving_left");
  });

  it("marks occluded", () => {
    expect(classifyRelativeMovement(base([]), { occluded: true })).toBe(
      "temporarily_occluded",
    );
  });
});
