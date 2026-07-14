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

describe("VehiclePassCounter (reliable)", () => {
  it("+1 when a vehicle grows then disappears", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.35, 0.1, 0.1)], 0);
    c.observeDetections([det(0.4, 0.45, 0.14, 0.14)], 80);
    c.observeDetections([det(0.4, 0.55, 0.2, 0.2)], 160);
    c.observeDetections([], 280);
    const after = c.observeDetections([], 400);
    expect(after.vehiclesPassed).toBe(1);
    expect(after.lastPass?.delta).toBe(1);
  });

  it("-1 when a vehicle lingers then shrinks (they passed us)", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.5, 0.22, 0.22)], 0);
    c.observeDetections([det(0.4, 0.48, 0.18, 0.18)], 100);
    c.observeDetections([det(0.4, 0.46, 0.15, 0.15)], 200);
    c.observeDetections([det(0.4, 0.44, 0.12, 0.12)], 350);
    c.observeDetections([det(0.4, 0.42, 0.09, 0.09)], 500);
    c.observeDetections([], 600);
    const after = c.observeDetections([], 700);
    expect(after.vehiclesPassed).toBe(-1);
  });

  it("ignores single-frame flash", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.35, 0.5, 0.15, 0.15)], 0);
    expect(c.observeDetections([], 80).vehiclesPassed).toBe(0);
  });

  it("ignores disappearance with no grow/shrink evidence", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.4, 0.12, 0.12)], 0);
    c.observeDetections([det(0.4, 0.4, 0.12, 0.12)], 80);
    c.observeDetections([det(0.4, 0.4, 0.12, 0.12)], 160);
    c.observeDetections([], 280);
    expect(c.observeDetections([], 400).vehiclesPassed).toBe(0);
  });

  it("ignores mass wipe when covering the camera", () => {
    const c = new VehiclePassCounter();
    // Three stable-ish cars that all vanish together.
    const a = [det(0.2, 0.4, 0.12, 0.14), det(0.45, 0.4, 0.12, 0.14), det(0.7, 0.4, 0.12, 0.14)];
    c.observeDetections(a, 0);
    c.observeDetections(a, 80);
    c.observeDetections(a, 160);
    c.observeDetections([], 280);
    expect(c.observeDetections([], 400).vehiclesPassed).toBe(0);
  });

  it("still counts a real grow flyby among traffic", () => {
    const c = new VehiclePassCounter();
    c.observeDetections([det(0.4, 0.35, 0.1, 0.1)], 0);
    c.observeDetections([det(0.4, 0.5, 0.16, 0.16)], 70);
    c.observeDetections([det(0.4, 0.65, 0.22, 0.22)], 140);
    c.observeDetections([], 260);
    expect(c.observeDetections([], 380).vehiclesPassed).toBe(1);
  });
});
