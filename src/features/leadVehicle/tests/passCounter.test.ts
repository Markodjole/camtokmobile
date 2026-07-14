import { describe, expect, it } from "vitest";
import { VehiclePassCounter } from "../domain/leadVehicle.passCounter";
import type { TrackedVehicle } from "../domain/leadVehicle.types";

function track(opts: {
  id: string;
  t0: number;
  t1: number;
  missed?: number;
  vehicleType?: TrackedVehicle["vehicleType"];
}): TrackedVehicle {
  return {
    trackId: opts.id,
    vehicleType: opts.vehicleType ?? "unknown_vehicle",
    classConfidence: 0.9,
    trackingConfidence: 0.9,
    boundingBox: { x: 0.4, y: 0.4, width: 0.12, height: 0.14 },
    bottomCenter: { x: 0.5, y: 0.58 },
    firstSeenAtMs: opts.t0,
    lastSeenAtMs: opts.t1,
    visibleDurationMs: opts.t1 - opts.t0,
    missedFrameCount: opts.missed ?? 0,
    trajectory: [
      {
        timestampMs: opts.t0,
        centerX: 0.5,
        centerY: 0.5,
        width: 0.12,
        height: 0.14,
      },
      {
        timestampMs: opts.t1,
        centerX: 0.5,
        centerY: 0.5,
        width: 0.12,
        height: 0.14,
      },
    ],
  };
}

describe("VehiclePassCounter", () => {
  it("counts vehicles on screen", () => {
    const c = new VehiclePassCounter();
    const snap = c.observe(
      [
        track({ id: "vehicle_1", t0: 0, t1: 200 }),
        track({ id: "vehicle_2", t0: 0, t1: 200 }),
      ],
      [],
      200,
    );
    expect(snap.vehiclesOnScreen).toBe(2);
    expect(snap.vehiclesPassed).toBe(0);
  });

  it("counts any vehicle that disappears (type irrelevant)", () => {
    const c = new VehiclePassCounter();
    const bike = track({
      id: "vehicle_1",
      t0: 0,
      t1: 200,
      vehicleType: "bicycle",
    });
    c.observe([bike], [], 200);
    const after = c.observe([], [bike], 400);
    expect(after.vehiclesPassed).toBe(1);
    expect(after.lastPass?.reason).toBe("vehicle_lost");
  });

  it("counts shrink-away / fast pass the same as grow", () => {
    const c = new VehiclePassCounter();
    const v = track({ id: "vehicle_1", t0: 0, t1: 180 });
    c.observe([v], [], 180);
    expect(c.observe([], [v], 300).vehiclesPassed).toBe(1);
  });

  it("ignores one-frame flicker", () => {
    const c = new VehiclePassCounter();
    const flash = track({ id: "vehicle_1", t0: 100, t1: 150 });
    c.observe([flash], [], 150);
    expect(c.observe([], [flash], 200).vehiclesPassed).toBe(0);
  });
});
