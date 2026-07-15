import { describe, expect, it } from "vitest";
import {
  normalizeVehicleDetections,
  normalizeVehicleType,
} from "../domain/leadVehicle.normalize";
import type { VehicleDetection } from "../domain/leadVehicle.types";

describe("leadVehicle.normalize", () => {
  it("maps legacy COCO labels to vehicle", () => {
    expect(normalizeVehicleType("car")).toBe("vehicle");
    expect(normalizeVehicleType("motorcycle")).toBe("vehicle");
    expect(normalizeVehicleType("truck")).toBe("vehicle");
  });

  it("leaves unknown labels as unknown_vehicle", () => {
    expect(normalizeVehicleType("person")).toBe("unknown_vehicle");
  });

  it("normalizes detection payloads", () => {
    const out = normalizeVehicleDetections([
      {
        vehicleType: "bus",
        confidence: 0.8,
        boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      } as unknown as VehicleDetection,
    ]);
    expect(out[0]?.vehicleType).toBe("vehicle");
  });
});
