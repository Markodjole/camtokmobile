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
  it("counts a vehicle crossing the line downward once per round", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");

    // Approaching from above the line, growing as it nears the camera.
    let snap = c.observeDetections([det(0.3, 0.1)], 0);
    expect(snap.count).toBe(0);
    snap = c.observeDetections([det(0.36, 0.12)], 100);
    snap = c.observeDetections([det(0.42, 0.14)], 200);
    // bottom = y+h crosses 0.55 here.
    snap = c.observeDetections([det(0.46, 0.16)], 300);
    expect(snap.count).toBe(1);

    // Still tracked past the line — must not double count.
    snap = c.observeDetections([det(0.6, 0.2)], 400);
    expect(snap.count).toBe(1);
  });

  it("does not count a static box that never crosses the line", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    for (let t = 0; t < 800; t += 100) {
      c.observeDetections([det(0.2, 0.1)], t);
    }
    expect(c.snapshot().count).toBe(0);
  });

  it("does not count low-confidence flicker", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    c.observeDetections([det(0.42, 0.14, 0.3)], 0);
    const snap = c.observeDetections([det(0.46, 0.16, 0.3)], 100);
    expect(snap.count).toBe(0);
  });

  it("resets between rounds", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    c.observeDetections([det(0.42, 0.14)], 0);
    c.observeDetections([det(0.46, 0.16)], 100);
    c.endRound();
    c.beginRound("r2");
    expect(c.snapshot().count).toBe(0);
  });
});
