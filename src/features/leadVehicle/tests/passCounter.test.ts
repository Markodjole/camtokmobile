import { describe, expect, it } from "vitest";
import { VehiclePassCounter } from "../domain/leadVehicle.passCounter";
import type { TrackedVehicle } from "../domain/leadVehicle.types";

function track(opts: {
  id: string;
  t0: number;
  t1: number;
  w0: number;
  h0: number;
  w1: number;
  h1: number;
  missed?: number;
}): TrackedVehicle {
  const traj = [
    {
      timestampMs: opts.t0,
      centerX: 0.5,
      centerY: 0.5,
      width: opts.w0,
      height: opts.h0,
    },
    {
      timestampMs: opts.t0 + 400,
      centerX: 0.5,
      centerY: 0.5,
      width: (opts.w0 + opts.w1) / 2,
      height: (opts.h0 + opts.h1) / 2,
    },
    {
      timestampMs: opts.t1,
      centerX: 0.5,
      centerY: 0.5,
      width: opts.w1,
      height: opts.h1,
    },
  ];
  return {
    trackId: opts.id,
    vehicleType: "car",
    classConfidence: 0.9,
    trackingConfidence: 0.9,
    boundingBox: {
      x: 0.4,
      y: 0.4,
      width: opts.w1,
      height: opts.h1,
    },
    bottomCenter: { x: 0.5, y: 0.58 },
    firstSeenAtMs: opts.t0,
    lastSeenAtMs: opts.t1,
    visibleDurationMs: opts.t1 - opts.t0,
    missedFrameCount: opts.missed ?? 0,
    trajectory: traj,
  };
}

describe("VehiclePassCounter", () => {
  it("counts vehicles on screen", () => {
    const c = new VehiclePassCounter();
    const a = track({
      id: "vehicle_1",
      t0: 0,
      t1: 800,
      w0: 0.1,
      h0: 0.1,
      w1: 0.12,
      h1: 0.12,
    });
    const b = track({
      id: "vehicle_2",
      t0: 0,
      t1: 800,
      w0: 0.08,
      h0: 0.08,
      w1: 0.09,
      h1: 0.09,
    });
    const snap = c.observe([a, b], [], 800);
    expect(snap.vehiclesOnScreen).toBe(2);
    expect(snap.vehiclesPassed).toBe(0);
  });

  it("counts a pass when a growing track disappears", () => {
    const c = new VehiclePassCounter();
    const growing = track({
      id: "vehicle_1",
      t0: 0,
      t1: 1200,
      w0: 0.1,
      h0: 0.1,
      w1: 0.22,
      h1: 0.22,
    });
    c.observe([growing], [], 1200);
    const after = c.observe([], [growing], 1400);
    expect(after.vehiclesPassed).toBe(1);
    expect(after.lastPass?.trackId).toBe("vehicle_1");
    expect(after.lastPass?.reason).toMatch(/lost/);
  });

  it("does not count a shrink-away as a pass", () => {
    const c = new VehiclePassCounter();
    const fading = track({
      id: "vehicle_1",
      t0: 0,
      t1: 1200,
      w0: 0.2,
      h0: 0.2,
      w1: 0.08,
      h1: 0.08,
    });
    c.observe([fading], [], 1200);
    const after = c.observe([], [fading], 1400);
    expect(after.vehiclesPassed).toBe(0);
  });
});
