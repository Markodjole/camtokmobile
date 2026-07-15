import { describe, expect, it } from "vitest";
import {
  filterVehicleDetections,
  isLikelyVehicleDetection,
  vehicleRejectReason,
} from "../domain/leadVehicle.vehicleFilter";
import type { VehicleDetection } from "../domain/leadVehicle.types";

function det(
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: { confidence?: number; vehicleType?: VehicleDetection["vehicleType"] },
): VehicleDetection {
  return {
    vehicleType: opts?.vehicleType ?? "vehicle",
    confidence: opts?.confidence ?? 0.72,
    boundingBox: { x, y, width: w, height: h },
  };
}

describe("leadVehicle.vehicleFilter", () => {
  it("accepts a normal forward vehicle box", () => {
    expect(isLikelyVehicleDetection(det(0.4, 0.35, 0.18, 0.14))).toBe(true);
  });

  it("rejects road-like wide flat strips", () => {
    const road = det(0.05, 0.72, 0.9, 0.08, { confidence: 0.8 });
    expect(vehicleRejectReason(road)).toBe("road_strip");
    expect(filterVehicleDetections([road])).toHaveLength(0);
  });

  it("rejects curb bands along the bottom edge", () => {
    const curb = det(0.1, 0.9, 0.75, 0.09, { confidence: 0.75 });
    expect(vehicleRejectReason(curb)).toBe("curb_band");
  });

  it("rejects full-width boxes", () => {
    const wide = det(0.02, 0.5, 0.92, 0.2, { confidence: 0.8 });
    expect(vehicleRejectReason(wide)).toBe("too_wide");
  });

  it("rejects low-confidence vehicles", () => {
    const weak = det(0.4, 0.4, 0.2, 0.15, { confidence: 0.42 });
    expect(vehicleRejectReason(weak)).toBe("low_confidence");
  });

  it("rejects small upright pot-like false positives", () => {
    const pot = det(0.45, 0.62, 0.08, 0.1, { confidence: 0.58 });
    expect(vehicleRejectReason(pot)).toBe("low_confidence");
  });

  it("keeps vehicles at moderate confidence", () => {
    const vehicle = det(0.42, 0.45, 0.14, 0.16, {
      vehicleType: "vehicle",
      confidence: 0.52,
    });
    expect(isLikelyVehicleDetection(vehicle)).toBe(true);
  });
});
