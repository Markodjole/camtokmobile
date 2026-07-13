import { create } from "zustand";
import type {
  LeadVehiclePredictionReadiness,
  LeadVehicleRuntimeMetrics,
  LeadVehicleSnapshot,
  LeadVehicleTrackingState,
  TrackedVehicle,
  VehicleDetection,
} from "../domain/leadVehicle.types";
import type { LeadVehicleScoreBreakdown } from "../domain/leadVehicle.types";
import type { ForwardCorridor } from "../domain/leadVehicle.types";
import { DEFAULT_FORWARD_CORRIDOR } from "../domain/leadVehicle.constants";

type LeadVehicleUiState = {
  status: LeadVehicleTrackingState;
  leadVehicle: LeadVehicleSnapshot | null;
  tracks: TrackedVehicle[];
  detections: VehicleDetection[];
  predictionReadiness: LeadVehiclePredictionReadiness;
  metrics: LeadVehicleRuntimeMetrics;
  scoreBreakdown: LeadVehicleScoreBreakdown | null;
  corridor: ForwardCorridor;
  errorMessage: string | null;
  setFromPipeline: (snap: {
    status: LeadVehicleTrackingState;
    leadVehicle: LeadVehicleSnapshot | null;
    tracks: TrackedVehicle[];
    detections: VehicleDetection[];
    predictionReadiness: LeadVehiclePredictionReadiness;
    metrics: LeadVehicleRuntimeMetrics;
    scoreBreakdown: LeadVehicleScoreBreakdown | null;
    corridor: ForwardCorridor;
    error: Error | null;
  }) => void;
  reset: () => void;
};

const emptyReadiness: LeadVehiclePredictionReadiness = {
  ready: false,
  confidence: 0,
  reasons: [],
  blockers: ["inactive"],
};

const emptyMetrics: LeadVehicleRuntimeMetrics = {
  inferenceFps: 0,
  averageInferenceDurationMs: 0,
  droppedAnalysisFrames: 0,
  trackerCount: 0,
  lastInferenceAtMs: null,
  thermalWarning: false,
};

export const useLeadVehicleStore = create<LeadVehicleUiState>((set) => ({
  status: "idle",
  leadVehicle: null,
  tracks: [],
  detections: [],
  predictionReadiness: emptyReadiness,
  metrics: emptyMetrics,
  scoreBreakdown: null,
  corridor: DEFAULT_FORWARD_CORRIDOR,
  errorMessage: null,
  setFromPipeline: (snap) =>
    set({
      status: snap.status,
      leadVehicle: snap.leadVehicle,
      tracks: snap.tracks,
      detections: snap.detections,
      predictionReadiness: snap.predictionReadiness,
      metrics: snap.metrics,
      scoreBreakdown: snap.scoreBreakdown,
      corridor: snap.corridor,
      errorMessage: snap.error?.message ?? null,
    }),
  reset: () =>
    set({
      status: "idle",
      leadVehicle: null,
      tracks: [],
      detections: [],
      predictionReadiness: emptyReadiness,
      metrics: emptyMetrics,
      scoreBreakdown: null,
      corridor: DEFAULT_FORWARD_CORRIDOR,
      errorMessage: null,
    }),
}));
