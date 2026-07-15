import { describe, expect, it } from "vitest";
import { fuseVehicleDetections } from "../domain/leadVehicle.fusion";
import type { VehicleDetection } from "../domain/leadVehicle.types";

function det(
  x: number,
  y: number,
  w: number,
  h: number,
  confidence: number,
): VehicleDetection {
  return {
    vehicleType: "vehicle",
    confidence,
    boundingBox: { x, y, width: w, height: h },
  };
}

describe("leadVehicle.fusion", () => {
  it("boosts local confidence when remote agrees on same box", () => {
    const local = [det(0.4, 0.4, 0.2, 0.15, 0.52)];
    const remote = [det(0.41, 0.41, 0.19, 0.14, 0.78)];
    const fused = fuseVehicleDetections(local, remote);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.confidence).toBeGreaterThanOrEqual(0.78);
  });

  it("adds high-confidence remote-only vehicles", () => {
    const local = [det(0.4, 0.4, 0.2, 0.15, 0.6)];
    const remote = [
      det(0.41, 0.41, 0.19, 0.14, 0.8),
      det(0.7, 0.35, 0.12, 0.14, 0.72),
    ];
    const fused = fuseVehicleDetections(local, remote);
    expect(fused.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores weak remote-only noise", () => {
    const local: VehicleDetection[] = [];
    const remote = [det(0.5, 0.5, 0.1, 0.1, 0.4)];
    expect(fuseVehicleDetections(local, remote)).toHaveLength(0);
  });
});
