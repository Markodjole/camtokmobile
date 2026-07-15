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
  it("counts a vehicle that approaches the camera once per round", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");

    // Approaching from the horizon, growing and moving down each frame.
    let snap = c.observeDetections([det(0.3, 0.08)], 0);
    expect(snap.count).toBe(0);
    snap = c.observeDetections([det(0.36, 0.12)], 100);
    snap = c.observeDetections([det(0.44, 0.16)], 200);
    // bottom now ~0.6 (near field) with clear downward travel → counts.
    snap = c.observeDetections([det(0.5, 0.2)], 300);
    expect(snap.count).toBe(1);

    // Still tracked closer — must not double count.
    snap = c.observeDetections([det(0.6, 0.24)], 400);
    expect(snap.count).toBe(1);
  });

  it("does not count a distant vehicle that never approaches", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    for (let t = 0; t < 800; t += 100) {
      // Stays high in frame (far away), bottom well above near field.
      c.observeDetections([det(0.2, 0.06)], t);
    }
    expect(c.snapshot().count).toBe(0);
  });

  it("does not count a static near-field false positive", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    for (let t = 0; t < 800; t += 100) {
      // Near field but never moves (e.g. a mislabeled fixed object).
      c.observeDetections([det(0.55, 0.2)], t);
    }
    expect(c.snapshot().count).toBe(0);
  });

  it("does not count low-confidence flicker", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    c.observeDetections([det(0.4, 0.14, 0.3)], 0);
    c.observeDetections([det(0.46, 0.16, 0.3)], 100);
    const snap = c.observeDetections([det(0.52, 0.2, 0.3)], 200);
    expect(snap.count).toBe(0);
  });

  it("counts two distinct vehicles separately", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    // First vehicle on the left approaching.
    for (let t = 0; t <= 300; t += 100) {
      c.observeDetections(
        [
          {
            vehicleType: "vehicle",
            confidence: 0.8,
            boundingBox: { x: 0.2, y: 0.3 + t / 1000, width: 0.14, height: 0.12 + t / 2000 },
          },
        ],
        t,
      );
    }
    // Second vehicle on the right approaching.
    for (let t = 400; t <= 700; t += 100) {
      c.observeDetections(
        [
          {
            vehicleType: "vehicle",
            confidence: 0.8,
            boundingBox: { x: 0.7, y: 0.3 + (t - 400) / 1000, width: 0.14, height: 0.12 + (t - 400) / 2000 },
          },
        ],
        t,
      );
    }
    expect(c.snapshot().count).toBe(2);
  });

  it("resets between rounds", () => {
    const c = new VehicleCountRoundCounter();
    c.beginRound("r1");
    c.observeDetections([det(0.3, 0.1)], 0);
    c.observeDetections([det(0.44, 0.16)], 100);
    c.observeDetections([det(0.5, 0.2)], 200);
    c.endRound();
    c.beginRound("r2");
    expect(c.snapshot().count).toBe(0);
  });
});
