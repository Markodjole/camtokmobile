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
}): TrackedVehicle {
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
    missedFrameCount: 0,
    trajectory: [
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
    ],
  };
}

describe("VehiclePassCounter signed score", () => {
  it("+1 when a vehicle grows then disappears (we passed them)", () => {
    const c = new VehiclePassCounter();
    const v = track({
      id: "vehicle_1",
      t0: 0,
      t1: 1200,
      w0: 0.1,
      h0: 0.1,
      w1: 0.24,
      h1: 0.24,
    });
    c.observe([v], [], 1200);
    const after = c.observe([], [v], 1400);
    expect(after.vehiclesPassed).toBe(1);
    expect(after.lastPass?.delta).toBe(1);
  });

  it("-1 when a vehicle shrinks then disappears (they passed us)", () => {
    const c = new VehiclePassCounter();
    const v = track({
      id: "vehicle_1",
      t0: 0,
      t1: 1200,
      w0: 0.22,
      h0: 0.22,
      w1: 0.08,
      h1: 0.08,
    });
    c.observe([v], [], 1200);
    const after = c.observe([], [v], 1400);
    expect(after.vehiclesPassed).toBe(-1);
    expect(after.lastPass?.delta).toBe(-1);
  });

  it("nets +1 and -1 across two vehicles", () => {
    const c = new VehiclePassCounter();
    const grow = track({
      id: "a",
      t0: 0,
      t1: 1000,
      w0: 0.1,
      h0: 0.1,
      w1: 0.2,
      h1: 0.2,
    });
    const shrink = track({
      id: "b",
      t0: 0,
      t1: 1000,
      w0: 0.2,
      h0: 0.2,
      w1: 0.08,
      h1: 0.08,
    });
    c.observe([grow, shrink], [], 1000);
    expect(c.observe([], [grow, shrink], 1200).vehiclesPassed).toBe(0);
  });
});
