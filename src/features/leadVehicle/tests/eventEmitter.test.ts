import { describe, expect, it } from "vitest";
import { LeadVehicleEventEmitter } from "../services/LeadVehicleEventEmitter";
import type { LeadVehicleSnapshot } from "../domain/leadVehicle.types";

function vehicle(partial?: Partial<LeadVehicleSnapshot>): LeadVehicleSnapshot {
  return {
    timestampMs: 1000,
    sessionId: "s1",
    trackId: "vehicle_1",
    vehicleType: "vehicle",
    boundingBox: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 },
    confidence: 0.8,
    sameDirectionConfidence: 0.7,
    corridorConfidence: 0.8,
    relativeState: "stable_ahead",
    visibleDurationMs: 2000,
    lateralPosition: "center",
    ...partial,
  };
}

describe("LeadVehicleEventEmitter", () => {
  it("rate-limits heartbeat updates", () => {
    const emitter = new LeadVehicleEventEmitter();
    const events: string[] = [];
    emitter.subscribe((e) => events.push(e.type));

    emitter.emitAcquired("r1", "s1", vehicle({ timestampMs: 1000 }));
    emitter.maybeEmitUpdate("r1", "s1", vehicle({ timestampMs: 1100 }));
    emitter.maybeEmitUpdate("r1", "s1", vehicle({ timestampMs: 1200 }));
    emitter.maybeEmitUpdate("r1", "s1", vehicle({ timestampMs: 2600 }));

    expect(events.filter((t) => t === "lead_vehicle_acquired")).toHaveLength(1);
    expect(events.filter((t) => t === "lead_vehicle_updated")).toHaveLength(1);
  });

  it("emits movement changes immediately", () => {
    const emitter = new LeadVehicleEventEmitter();
    const events: string[] = [];
    emitter.subscribe((e) => events.push(e.type));
    emitter.emitAcquired("r1", "s1", vehicle({ timestampMs: 1000 }));
    emitter.maybeEmitUpdate(
      "r1",
      "s1",
      vehicle({ timestampMs: 1100, relativeState: "approaching" }),
    );
    expect(events).toContain("lead_vehicle_movement_changed");
  });
});
