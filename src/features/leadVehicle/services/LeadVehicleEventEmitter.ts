import { EVENT_HEARTBEAT_MS } from "../domain/leadVehicle.constants";
import type {
  LeadVehicleEvent,
  LeadVehicleRelativeState,
  LeadVehicleSnapshot,
} from "../domain/leadVehicle.types";

type Listener = (event: LeadVehicleEvent) => void;

/**
 * Rate-limits domain events for network / consumers.
 * Acquired / changed / lost / major movement: immediate.
 * Heartbeat updates: at most every EVENT_HEARTBEAT_MS.
 */
export class LeadVehicleEventEmitter {
  private listeners = new Set<Listener>();
  private lastHeartbeatAt = 0;
  private lastMovementState: LeadVehicleRelativeState | null = null;
  private lastLeadTrackId: string | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.lastHeartbeatAt = 0;
    this.lastMovementState = null;
    this.lastLeadTrackId = null;
  }

  emitAcquired(
    rideId: string,
    sessionId: string,
    vehicle: LeadVehicleSnapshot,
  ): void {
    this.lastLeadTrackId = vehicle.trackId;
    this.lastMovementState = vehicle.relativeState;
    this.lastHeartbeatAt = vehicle.timestampMs;
    this.emit({
      type: "lead_vehicle_acquired",
      rideId,
      sessionId,
      timestampMs: vehicle.timestampMs,
      vehicle,
    });
  }

  emitLost(
    rideId: string,
    sessionId: string,
    opts: {
      timestampMs: number;
      trackId: string;
      lastKnownVehicleType: LeadVehicleSnapshot["vehicleType"];
      trackedDurationMs: number;
    },
  ): void {
    this.lastLeadTrackId = null;
    this.lastMovementState = null;
    this.emit({
      type: "lead_vehicle_lost",
      rideId,
      sessionId,
      ...opts,
    });
  }

  emitTemporarilyLost(
    rideId: string,
    sessionId: string,
    opts: {
      timestampMs: number;
      trackId: string;
      vehicleType: LeadVehicleSnapshot["vehicleType"];
    },
  ): void {
    this.emit({
      type: "lead_vehicle_temporarily_lost",
      rideId,
      sessionId,
      ...opts,
    });
  }

  emitChanged(
    rideId: string,
    sessionId: string,
    opts: {
      timestampMs: number;
      previousTrackId: string;
      nextTrackId: string;
      previousVehicleType: LeadVehicleSnapshot["vehicleType"];
      nextVehicleType: LeadVehicleSnapshot["vehicleType"];
      reason:
        | "previous_lost"
        | "challenger_more_relevant"
        | "lane_or_corridor_change"
        | "manual_reset";
      vehicle: LeadVehicleSnapshot;
    },
  ): void {
    this.lastLeadTrackId = opts.nextTrackId;
    this.lastMovementState = opts.vehicle.relativeState;
    this.lastHeartbeatAt = opts.timestampMs;
    this.emit({
      type: "lead_vehicle_changed",
      rideId,
      sessionId,
      timestampMs: opts.timestampMs,
      previousTrackId: opts.previousTrackId,
      nextTrackId: opts.nextTrackId,
      previousVehicleType: opts.previousVehicleType,
      nextVehicleType: opts.nextVehicleType,
      reason: opts.reason,
    });
  }

  maybeEmitUpdate(
    rideId: string,
    sessionId: string,
    vehicle: LeadVehicleSnapshot,
  ): void {
    if (
      this.lastMovementState &&
      this.lastMovementState !== vehicle.relativeState
    ) {
      this.emit({
        type: "lead_vehicle_movement_changed",
        rideId,
        sessionId,
        timestampMs: vehicle.timestampMs,
        trackId: vehicle.trackId,
        previousState: this.lastMovementState,
        nextState: vehicle.relativeState,
        vehicle,
      });
      this.lastMovementState = vehicle.relativeState;
      this.lastHeartbeatAt = vehicle.timestampMs;
      return;
    }

    if (vehicle.timestampMs - this.lastHeartbeatAt < EVENT_HEARTBEAT_MS) {
      return;
    }
    this.lastHeartbeatAt = vehicle.timestampMs;
    this.lastMovementState = vehicle.relativeState;
    this.emit({
      type: "lead_vehicle_updated",
      rideId,
      sessionId,
      timestampMs: vehicle.timestampMs,
      vehicle,
    });
  }

  emitError(
    rideId: string,
    sessionId: string,
    timestampMs: number,
    message: string,
  ): void {
    this.emit({
      type: "lead_vehicle_tracking_error",
      rideId,
      sessionId,
      timestampMs,
      message,
    });
  }

  private emit(event: LeadVehicleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Never break the pipeline for a bad subscriber.
      }
    }
  }
}
