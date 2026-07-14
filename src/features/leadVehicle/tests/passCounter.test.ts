import { describe, expect, it } from "vitest";
import { VehiclePassCounter } from "../domain/leadVehicle.passCounter";
import type { VehicleDetection, SupportedVehicleType } from "../domain/leadVehicle.types";

function det(
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: { confidence?: number; vehicleType?: SupportedVehicleType },
): VehicleDetection {
  return {
    vehicleType: opts?.vehicleType ?? "car",
    confidence: opts?.confidence ?? 0.7,
    boundingBox: { x, y, width: w, height: h },
  };
}

describe("VehiclePassCounter vehicle-certainty first", () => {
  it("+1 for a sure vehicle that leaves (no growth required)", () => {
    const c = new VehiclePassCounter();
    // Middle of column, similar size — still a real car we clear past.
    c.observeDetections([det(0.45, 0.4, 0.12, 0.14)], 0);
    c.observeDetections([det(0.45, 0.42, 0.12, 0.14)], 60);
    c.observeDetections([det(0.46, 0.45, 0.13, 0.14)], 120);
    c.observeDetections([], 220);
    expect(c.observeDetections([], 320).vehiclesPassed).toBe(1);
  });

  it("+1 fast flyby with high vehicle confidence in 2 frames", () => {
    const c = new VehiclePassCounter();
    c.observeDetections(
      [det(0.4, 0.5, 0.14, 0.16, { confidence: 0.8 })],
      0,
    );
    c.observeDetections(
      [det(0.42, 0.62, 0.15, 0.17, { confidence: 0.82 })],
      50,
    );
    c.observeDetections([], 120);
    expect(c.observeDetections([], 200).vehiclesPassed).toBe(1);
  });

  it("rejects low-confidence / non-vehicle detections", () => {
    const c = new VehiclePassCounter();
    c.observeDetections(
      [det(0.4, 0.5, 0.2, 0.2, { confidence: 0.35 })],
      0,
    );
    c.observeDetections(
      [det(0.4, 0.5, 0.2, 0.2, { confidence: 0.35 })],
      60,
    );
    c.observeDetections(
      [det(0.4, 0.5, 0.2, 0.2, { confidence: 0.35 })],
      120,
    );
    c.observeDetections([], 220);
    expect(c.observeDetections([], 320).vehiclesPassed).toBe(0);
  });

  it("rejects unknown_vehicle even if large", () => {
    const c = new VehiclePassCounter();
    c.observeDetections(
      [det(0.4, 0.5, 0.2, 0.2, { vehicleType: "unknown_vehicle", confidence: 0.9 })],
      0,
    );
    c.observeDetections(
      [det(0.4, 0.5, 0.2, 0.2, { vehicleType: "unknown_vehicle", confidence: 0.9 })],
      60,
    );
    c.observeDetections([], 160);
    expect(c.observeDetections([], 260).vehiclesPassed).toBe(0);
  });

  it("-1 when a sure vehicle lingers and shrinks ahead", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.48, 0.24, 0.24)], 0);
    c.observeDetections([det(0.4, 0.47, 0.2, 0.2)], 80);
    c.observeDetections([det(0.4, 0.46, 0.17, 0.17)], 160);
    c.observeDetections([det(0.4, 0.45, 0.14, 0.14)], 280);
    c.observeDetections([det(0.4, 0.44, 0.11, 0.11)], 400);
    c.observeDetections([det(0.4, 0.43, 0.09, 0.09)], 520);
    c.observeDetections([], 620);
    expect(c.observeDetections([], 720).vehiclesPassed).toBe(-1);
  });

  it("counts multiple vehicles in a column independently", () => {
    const c = new VehiclePassCounter();
    const left = det(0.25, 0.4, 0.12, 0.14);
    const mid = det(0.45, 0.4, 0.12, 0.14);
    const right = det(0.65, 0.4, 0.12, 0.14);
    c.observeDetections([left, mid, right], 0);
    c.observeDetections([left, mid, right], 60);
    c.observeDetections([left, mid, right], 120);
    // Only mid leaves first.
    c.observeDetections([left, right], 200);
    c.observeDetections([left, right], 280);
    expect(c.snapshot().vehiclesPassed).toBe(1);
  });

  it("skips camera-cover mass wipe", () => {
    const c = new VehiclePassCounter();
    const frame = [
      det(0.2, 0.4, 0.13, 0.14),
      det(0.45, 0.4, 0.13, 0.14),
      det(0.7, 0.4, 0.13, 0.14),
    ];
    c.observeDetections(frame, 0);
    c.observeDetections(frame, 60);
    c.observeDetections(frame, 120);
    c.observeDetections([], 220);
    expect(c.observeDetections([], 320).vehiclesPassed).toBe(0);
  });
});
