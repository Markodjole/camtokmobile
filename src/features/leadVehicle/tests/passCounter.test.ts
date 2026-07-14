import { describe, expect, it } from "vitest";
import { VehiclePassCounter } from "../domain/leadVehicle.passCounter";
import type { VehicleDetection } from "../domain/leadVehicle.types";

function det(
  x: number,
  y: number,
  w: number,
  h: number,
  confidence = 0.7,
): VehicleDetection {
  return {
    vehicleType: "car",
    confidence,
    boundingBox: { x, y, width: w, height: h },
  };
}

describe("VehiclePassCounter accuracy-first", () => {
  it("+1 for clear grow + move-down overtake", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.32, 0.1, 0.1)], 0);
    c.observeDetections([det(0.4, 0.42, 0.13, 0.13)], 60);
    c.observeDetections([det(0.4, 0.55, 0.17, 0.17)], 120);
    c.observeDetections([det(0.4, 0.72, 0.22, 0.22)], 180);
    c.observeDetections([det(0.4, 0.86, 0.26, 0.26)], 240);
    expect(c.snapshot().vehiclesPassed).toBe(1);
  });

  it("-1 for linger + multi-step shrink (they passed us)", () => {
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

  it("does not score weak / no-motion tracks", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.4, 0.14, 0.14)], 0);
    c.observeDetections([det(0.4, 0.4, 0.14, 0.14)], 60);
    c.observeDetections([det(0.4, 0.4, 0.14, 0.14)], 120);
    c.observeDetections([det(0.4, 0.4, 0.14, 0.14)], 180);
    c.observeDetections([], 300);
    expect(c.observeDetections([], 400).vehiclesPassed).toBe(0);
  });

  it("does not score single-frame or low-confidence noise", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.5, 0.2, 0.2, 0.3)], 0);
    c.observeDetections([], 50);
    expect(c.observeDetections([], 100).vehiclesPassed).toBe(0);
  });

  it("skips mass camera-cover wipe", () => {
    const c = new VehiclePassCounter();
    const frame = [
      det(0.2, 0.4, 0.13, 0.14),
      det(0.45, 0.4, 0.13, 0.14),
      det(0.7, 0.4, 0.13, 0.14),
    ];
    c.observeDetections(frame, 0);
    c.observeDetections(frame, 60);
    c.observeDetections(frame, 120);
    c.observeDetections(frame, 180);
    c.observeDetections([], 300);
    expect(c.observeDetections([], 400).vehiclesPassed).toBe(0);
  });
});
