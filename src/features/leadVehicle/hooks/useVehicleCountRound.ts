import { useCallback, useEffect, useRef, useState } from "react";
import {
  leadVehicleInferenceMode,
  leadVehicleTelemetryEnabled,
  leadVehicleTrackingEnabled,
  vehicleCountRoundEnabled,
} from "../config/leadVehicle.flags";
import type { InferenceMode } from "../domain/leadVehicle.types";
import { VehicleCountRoundPipeline } from "../services/VehicleCountRoundPipeline";

export type VehicleCountMarketPhase = "idle" | "betting" | "counting" | "revealed";

export type UseVehicleCountRoundMarket = {
  marketId: string | null;
  marketType: string | null;
  roomPhase: string | null;
  locksAt: string | null;
  revealAt: string | null;
};

export type UseVehicleCountRoundOptions = {
  enabled: boolean;
  rideId?: string;
  riderId?: string;
  sessionId?: string;
  inferenceMode?: InferenceMode;
  market: UseVehicleCountRoundMarket | null;
};

export function useVehicleCountRound(options: UseVehicleCountRoundOptions) {
  const pipelineRef = useRef<VehicleCountRoundPipeline | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [snapshot, setSnapshot] = useState(
    () =>
      new VehicleCountRoundPipeline({
        rideId: options.rideId ?? "ride",
        sessionId: options.sessionId ?? "",
        riderId: options.riderId ?? "unknown",
        inferenceMode: options.inferenceMode ?? leadVehicleInferenceMode(),
        telemetryEnabled: false,
      }).getSnapshot(),
  );

  const stop = useCallback(async () => {
    const p = pipelineRef.current;
    pipelineRef.current = null;
    if (p) await p.stop();
  }, []);

  useEffect(() => {
    if (
      !vehicleCountRoundEnabled() ||
      !leadVehicleTrackingEnabled() ||
      !options.enabled ||
      !options.sessionId ||
      !options.rideId
    ) {
      void stop();
      return;
    }

    const pipeline = new VehicleCountRoundPipeline({
      rideId: options.rideId,
      sessionId: options.sessionId,
      riderId: options.riderId ?? "unknown",
      inferenceMode: options.inferenceMode ?? leadVehicleInferenceMode(),
      telemetryEnabled: leadVehicleTelemetryEnabled(),
    });
    pipelineRef.current = pipeline;
    pipeline.subscribe(() => {
      setSnapshot(pipeline.getSnapshot());
      setError(pipeline.getSnapshot().error);
    });

    return () => {
      void pipeline.stop();
      pipelineRef.current = null;
    };
  }, [
    options.enabled,
    options.sessionId,
    options.rideId,
    options.riderId,
    options.inferenceMode,
    stop,
  ]);

  useEffect(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline || !options.market) {
      void pipeline?.setRoundPhase(null, false);
      return;
    }

    const m = options.market;
    if (m.marketType !== "vehicle_count_30s") {
      void pipeline.setRoundPhase(null, false);
      return;
    }

    let roundId = m.marketId ?? "round";

    const now = Date.now();
    const locksAt = m.locksAt ? new Date(m.locksAt).getTime() : null;
    const revealAt = m.revealAt ? new Date(m.revealAt).getTime() : null;
    const counting =
      m.roomPhase === "market_locked" &&
      locksAt != null &&
      revealAt != null &&
      now >= locksAt &&
      now < revealAt;

    void pipeline.setRoundPhase(counting ? roundId : null, counting);
  }, [options.market]);

  return { snapshot, error, stop };
}

export function marketPhaseFromRoom(
  market: UseVehicleCountRoundMarket | null,
): VehicleCountMarketPhase {
  if (!market || market.marketType !== "vehicle_count_30s") return "idle";
  const now = Date.now();
  const locksAt = market.locksAt ? new Date(market.locksAt).getTime() : null;
  const revealAt = market.revealAt ? new Date(market.revealAt).getTime() : null;

  if (market.roomPhase === "market_open") return "betting";
  if (
    market.roomPhase === "market_locked" &&
    locksAt != null &&
    revealAt != null &&
    now >= locksAt &&
    now < revealAt
  ) {
    return "counting";
  }
  if (
    market.roomPhase === "revealed" ||
    market.roomPhase === "settled" ||
    (revealAt != null && now >= revealAt)
  ) {
    return "revealed";
  }
  return "idle";
}
