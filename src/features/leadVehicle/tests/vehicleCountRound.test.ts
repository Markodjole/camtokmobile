import { describe, expect, it } from "vitest";
import { VehicleCountRoundCounter } from "../domain/vehicleCountRound.counter";
import type { VehicleDetection } from "../domain/leadVehicle.types";

function det(y: number, h: number, conf = 0.72): VehicleDetection {
  return {
    vehicleType: "vehicle",
    confidence: conf,
    boundingBox: { x: 0.42, y, width: 0.16, height: h },
  };
}

describe("VehicleCountRoundCounter", () => {
  it("counts a stable vehicle in the counting zone once per round", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");

    let snap = c.observeDetections([det(0.42, 0.14)], 0);
    expect(snap.count).toBe(0);

    snap = c.observeDetections([det(0.42, 0.14)], 100);
    expect(snap.count).toBe(1);

    snap = c.observeDetections([det(0.44, 0.14)], 200);
    expect(snap.count).toBe(1);
  });

  it("counts a vehicle crossing the line once per round", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");

    c.observeDetections([det(0.38, 0.12)], 0);
    c.observeDetections([det(0.44, 0.14)], 100);
    const snap = c.observeDetections([det(0.56, 0.18)], 300);
    expect(snap.count).toBe(1);
  });

  it("resets between rounds", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    c.observeDetections([det(0.42, 0.14)], 0);
    c.observeDetections([det(0.42, 0.14)], 100);
    c.endRound();
    c.beginRound("r2");
    expect(c.snapshot().count).toBe(0);
  });
});
