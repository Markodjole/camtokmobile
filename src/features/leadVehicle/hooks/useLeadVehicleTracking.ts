import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveBroadcastStore } from "@/stores/liveBroadcastStore";
import {
  leadVehicleInferenceMode,
  leadVehicleTelemetryEnabled,
  leadVehicleTrackingEnabled,
} from "../config/leadVehicle.flags";
import type {
  InferenceMode,
  LeadVehiclePredictionReadiness,
  LeadVehicleRuntimeMetrics,
  LeadVehicleSnapshot,
  LeadVehicleTrackingState,
} from "../domain/leadVehicle.types";
import { LeadVehiclePipeline } from "../services/LeadVehiclePipeline";
import { useLeadVehicleStore } from "../state/leadVehicle.store";

export interface UseLeadVehicleTrackingOptions {
  enabled: boolean;
  rideId?: string;
  riderId?: string;
  sessionId?: string;
  inferenceMode?: InferenceMode;
}

export interface UseLeadVehicleTrackingResult {
  status: LeadVehicleTrackingState;
  leadVehicle: LeadVehicleSnapshot | null;
  predictionReadiness: LeadVehiclePredictionReadiness;
  metrics: LeadVehicleRuntimeMetrics;
  error: Error | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
}

/** Guard against duplicate pipelines across remounts. */
let activePipelineKey: string | null = null;

export function useLeadVehicleTracking(
  options: UseLeadVehicleTrackingOptions,
): UseLeadVehicleTrackingResult {
  const pipelineRef = useRef<LeadVehiclePipeline | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const status = useLeadVehicleStore((s) => s.status);
  const leadVehicle = useLeadVehicleStore((s) => s.leadVehicle);
  const predictionReadiness = useLeadVehicleStore((s) => s.predictionReadiness);
  const metrics = useLeadVehicleStore((s) => s.metrics);
  const setFromPipeline = useLeadVehicleStore((s) => s.setFromPipeline);
  const resetStore = useLeadVehicleStore((s) => s.reset);

  const routePoints = useLiveBroadcastStore((s) => s.routePoints);

  const stop = useCallback(async () => {
    const p = pipelineRef.current;
    pipelineRef.current = null;
    activePipelineKey = null;
    if (p) await p.stop();
    resetStore();
  }, [resetStore]);

  const start = useCallback(async () => {
    if (!leadVehicleTrackingEnabled() || !options.enabled) return;
    if (!options.sessionId || !options.rideId) return;

    const key = `${options.sessionId}:${options.inferenceMode ?? leadVehicleInferenceMode()}`;
    if (activePipelineKey === key && pipelineRef.current) return;

    await stop();
    activePipelineKey = key;
    const mode = options.inferenceMode ?? leadVehicleInferenceMode();
    const pipeline = new LeadVehiclePipeline({
      rideId: options.rideId,
      sessionId: options.sessionId,
      riderId: options.riderId ?? "unknown",
      inferenceMode: mode,
      telemetryEnabled: leadVehicleTelemetryEnabled(),
    });
    pipelineRef.current = pipeline;
    pipeline.subscribe(() => {
      setFromPipeline(pipeline.getSnapshot());
      const snap = pipeline.getSnapshot();
      setError(snap.error);
    });
    await pipeline.start();
    setFromPipeline(pipeline.getSnapshot());
  }, [
    options.enabled,
    options.sessionId,
    options.rideId,
    options.riderId,
    options.inferenceMode,
    setFromPipeline,
    stop,
  ]);

  const reset = useCallback(() => {
    pipelineRef.current?.reset();
    setFromPipeline(
      pipelineRef.current?.getSnapshot() ?? {
        status: "idle",
        leadVehicle: null,
        tracks: [],
        detections: [],
        predictionReadiness: {
          ready: false,
          confidence: 0,
          reasons: [],
          blockers: ["inactive"],
        },
        metrics: {
          inferenceFps: 0,
          averageInferenceDurationMs: 0,
          droppedAnalysisFrames: 0,
          trackerCount: 0,
          lastInferenceAtMs: null,
          thermalWarning: false,
        },
        scoreBreakdown: null,
        corridor: useLeadVehicleStore.getState().corridor,
        passCounter: {
          vehiclesOnScreen: 0,
          vehiclesPassed: 0,
          lastPass: null,
        },
        error: null,
      },
    );
  }, [setFromPipeline]);

  // Feed latest GPS into the pipeline for same-direction scoring.
  useEffect(() => {
    const last = routePoints[routePoints.length - 1];
    if (!last || !pipelineRef.current) return;
    pipelineRef.current.setRiderTelemetry({
      latitude: last.lat,
      longitude: last.lng,
      speedMetersPerSecond: last.speedMps,
      headingDegrees: last.heading,
    });
  }, [routePoints]);

  useEffect(() => {
    if (!options.enabled || !leadVehicleTrackingEnabled()) {
      void stop();
      return;
    }
    void start();
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    options.enabled,
    options.sessionId,
    options.rideId,
    options.inferenceMode,
  ]);

  return {
    status,
    leadVehicle,
    predictionReadiness,
    metrics,
    error,
    start,
    stop,
    reset,
  };
}
