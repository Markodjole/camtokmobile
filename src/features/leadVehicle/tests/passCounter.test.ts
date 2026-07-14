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

describe("VehiclePassCounter (detection-based)", () => {
  it("counts many brief flybys as separate +1s", () => {
    const c = new VehiclePassCounter();
    let score = 0;
    for (let i = 0; i < 12; i += 1) {
      const x = 0.2 + (i % 5) * 0.12;
      // Appear growing toward bottom, then gone.
      c.observeDetections([det(x, 0.4, 0.1, 0.12)], i * 200);
      c.observeDetections([det(x, 0.55, 0.14, 0.16)], i * 200 + 70);
      c.observeDetections([det(x, 0.7, 0.18, 0.2)], i * 200 + 140);
      c.observeDetections([], i * 200 + 220);
      const snap = c.observeDetections([], i * 200 + 300);
      score = snap.vehiclesPassed;
    }
    expect(score).toBeGreaterThanOrEqual(10);
  });

  it("+1 when a vehicle grows then disappears", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.35, 0.1, 0.1)], 0);
    c.observeDetections([det(0.4, 0.45, 0.16, 0.16)], 80);
    c.observeDetections([det(0.4, 0.55, 0.22, 0.22)], 160);
    const after = c.observeDetections([], 400);
    expect(after.vehiclesPassed).toBe(1);
    expect(after.lastPass?.delta).toBe(1);
  });

  it("-1 when a vehicle shrinks / pulls ahead then disappears", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.45, 0.22, 0.22)], 0);
    c.observeDetections([det(0.4, 0.42, 0.16, 0.16)], 80);
    c.observeDetections([det(0.4, 0.4, 0.1, 0.1)], 160);
    const after = c.observeDetections([], 400);
    expect(after.vehiclesPassed).toBe(-1);
    expect(after.lastPass?.delta).toBe(-1);
  });

  it("counts a single-frame sizable flyby as +1", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.35, 0.5, 0.12, 0.14)], 0);
    expect(c.observeDetections([], 80).vehiclesPassed).toBe(1);
  });

  it("ignores tiny single-frame flicker", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.4, 0.04, 0.04)], 0);
    expect(c.observeDetections([], 80).vehiclesPassed).toBe(0);
  });

  it("ignores weak single-frame flicker below size floor", () => {
    const c = new VehiclePassCounter();
    // area 0.04*0.04 = 0.0016 < single-hit floor
    c.observeDetections([det(0.45, 0.45, 0.05, 0.05, 0.9)], 0);
    expect(c.observeDetections([], 100).vehiclesPassed).toBe(0);
  });
});
