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
  it("counts a vehicle crossing the line once per round", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");

    let snap = c.observeDetections([det(0.38, 0.12)], 0);
    expect(snap.count).toBe(0);

    snap = c.observeDetections([det(0.44, 0.14)], 100);
    snap = c.observeDetections([det(0.5, 0.16)], 200);
    snap = c.observeDetections([det(0.56, 0.18)], 300);
    expect(snap.count).toBe(1);

    snap = c.observeDetections([det(0.62, 0.2)], 400);
    expect(snap.count).toBe(1);
  });

  it("resets between rounds", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    c.observeDetections([det(0.56, 0.18)], 300);
    c.endRound();
    c.beginRound("r2");
    expect(c.snapshot().count).toBe(0);
  });
});
