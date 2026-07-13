import { describe, expect, it } from "vitest";
import {
  boxArea,
  iou,
  pointInTrapezoid,
} from "../domain/leadVehicle.geometry";
import { DEFAULT_FORWARD_CORRIDOR } from "../domain/leadVehicle.constants";

describe("leadVehicle.geometry", () => {
  it("computes box area", () => {
    expect(boxArea({ x: 0.1, y: 0.1, width: 0.2, height: 0.5 })).toBeCloseTo(
      0.1,
    );
  });

  it("computes iou", () => {
    const a = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const b = { x: 0.45, y: 0.45, width: 0.2, height: 0.2 };
    expect(iou(a, b)).toBeGreaterThan(0.2);
    expect(iou(a, a)).toBeCloseTo(1);
  });

  it("detects points inside forward corridor trapezoid", () => {
    expect(
      pointInTrapezoid({ x: 0.5, y: 0.7 }, DEFAULT_FORWARD_CORRIDOR),
    ).toBe(true);
    expect(
      pointInTrapezoid({ x: 0.05, y: 0.5 }, DEFAULT_FORWARD_CORRIDOR),
    ).toBe(false);
  });
});
