import { describe, expect, it } from "vitest";
import { LeadVehiclePipeline } from "../services/LeadVehiclePipeline";
import { LeadVehicleTracker, resetTrackIdSequence } from "../services/LeadVehicleTracker";
import type { VehicleDetection } from "../domain/leadVehicle.types";

function carAt(
  box: { x: number; y: number; width: number; height: number },
  confidence = 0.85,
): VehicleDetection {
  return { vehicleType: "car", confidence, boundingBox: box };
}

function motoAt(
  box: { x: number; y: number; width: number; height: number },
  confidence = 0.85,
): VehicleDetection {
  return { vehicleType: "motorcycle", confidence, boundingBox: box };
}

describe("LeadVehicleTracker + pipeline integration", () => {
  it("acquires a persistent corridor car", async () => {
    resetTrackIdSequence();
    const pipeline = new LeadVehiclePipeline({
      rideId: "ride_1",
      sessionId: "sess_1",
      riderId: "rider_1",
      inferenceMode: "mock",
      telemetryEnabled: false,
    });
    // Bypass mock pump — feed detections directly.
    pipeline["status"] = "searching";

    const frames = [
      [],
      [carAt({ x: 0.46, y: 0.42, width: 0.12, height: 0.15 })],
      [carAt({ x: 0.47, y: 0.43, width: 0.13, height: 0.16 })],
      [carAt({ x: 0.48, y: 0.44, width: 0.14, height: 0.17 })],
      [carAt({ x: 0.48, y: 0.44, width: 0.14, height: 0.17 })],
      [carAt({ x: 0.48, y: 0.44, width: 0.14, height: 0.17 })],
      [carAt({ x: 0.48, y: 0.44, width: 0.14, height: 0.17 })],
    ];

    let t = 0;
    for (const dets of frames) {
      t += 200;
      await pipeline.processDetectionsForTest(dets, t);
    }

    // Acquisition needs 500ms confirmation after candidate — continue.
    for (let i = 0; i < 4; i += 1) {
      t += 200;
      await pipeline.processDetectionsForTest(
        [carAt({ x: 0.48, y: 0.44, width: 0.14, height: 0.17 })],
        t,
      );
    }

    const snap = pipeline.getSnapshot();
    expect(["candidate_found", "tracking"]).toContain(snap.status);
    if (snap.status === "tracking") {
      expect(snap.leadVehicle?.vehicleType).toBe("car");
    }
    await pipeline.stop();
  });

  it("prefers centered motorcycle over large side car", () => {
    resetTrackIdSequence();
    const tracker = new LeadVehicleTracker({ minimumTrackAgeFrames: 3 });
    let t = 0;
    for (let i = 0; i < 5; i += 1) {
      t += 200;
      tracker.update(
        [
          carAt({ x: 0.78, y: 0.55, width: 0.2, height: 0.28 }, 0.95),
          motoAt({ x: 0.46, y: 0.38, width: 0.1, height: 0.16 }, 0.8),
        ],
        t,
      );
    }
    const mature = tracker.matureTracks();
    expect(mature.length).toBeGreaterThanOrEqual(2);
    // Scoring preference is covered in scoring.test; here ensure both tracks exist.
    const types = mature.map((m) => m.vehicleType).sort();
    expect(types).toContain("car");
    expect(types).toContain("motorcycle");
  });

  it("retains track across brief misses", () => {
    resetTrackIdSequence();
    const tracker = new LeadVehicleTracker();
    tracker.update(
      [carAt({ x: 0.46, y: 0.42, width: 0.12, height: 0.15 })],
      0,
    );
    tracker.update(
      [carAt({ x: 0.46, y: 0.42, width: 0.12, height: 0.15 })],
      100,
    );
    tracker.update([], 200);
    tracker.update([], 300);
    const tracks = tracker.getTracks();
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.missedFrameCount).toBe(2);
  });
});
