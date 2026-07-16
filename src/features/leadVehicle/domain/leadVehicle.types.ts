/**
 * Lead-vehicle tracking domain types.
 * Temporary session-level IDs only — never permanent vehicle identity.
 */

/** We only distinguish vehicle vs non-vehicle — not car vs truck vs bike. */
export type SupportedVehicleType = "vehicle" | "unknown_vehicle";

export type VehicleTrackId = string;

export type InferenceMode = "on_device" | "remote" | "hybrid" | "mock";

export type VehicleInferenceStatus =
  | "uninitialized"
  | "ready"
  | "unsupported"
  | "error"
  | "disposed";

export interface NormalizedBoundingBox {
  /** Left edge, 0–1 */
  x: number;
  /** Top edge, 0–1 */
  y: number;
  /** Width, 0–1 */
  width: number;
  /** Height, 0–1 */
  height: number;
}

export interface VehicleDetection {
  detectionId?: string;
  vehicleType: SupportedVehicleType;
  /** Raw detector class (car / motorcycle / bus / truck / bicycle) when known.
   *  Used to prefer following motorcycles over cars. */
  rawLabel?: string;
  confidence: number;
  boundingBox: NormalizedBoundingBox;
}

export interface RiderTelemetrySnapshot {
  latitude?: number;
  longitude?: number;
  speedMetersPerSecond?: number;
  headingDegrees?: number;
  headingAccuracyDegrees?: number;
  locationAccuracyMeters?: number;
}

export interface VehicleFrameInput {
  frameId: number;
  timestampMs: number;
  width: number;
  height: number;
  rotationDegrees: 0 | 90 | 180 | 270;
  imageData?: unknown;
  nativeFrameReference?: unknown;
  riderTelemetry?: RiderTelemetrySnapshot;
}

export interface VehicleFrameResult {
  frameId: number;
  timestampMs: number;
  inferenceDurationMs: number;
  detections: VehicleDetection[];
  frameWidth?: number;
  frameHeight?: number;
  rotationDegrees?: number;
  imageBase64?: string;
  /** Authoritative count from server infer when hybrid/remote is active. */
  serverRoundCount?: number;
}

export interface VehicleTrackPoint {
  timestampMs: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface TrackedVehicle {
  trackId: VehicleTrackId;
  vehicleType: SupportedVehicleType;
  classConfidence: number;
  trackingConfidence: number;
  boundingBox: NormalizedBoundingBox;
  bottomCenter: { x: number; y: number };
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  visibleDurationMs: number;
  missedFrameCount: number;
  trajectory: VehicleTrackPoint[];
}

export type LeadVehicleRelativeState =
  | "stable_ahead"
  | "approaching"
  | "moving_away"
  | "moving_left"
  | "moving_right"
  | "slowing_or_rider_approaching"
  | "temporarily_occluded"
  | "lost"
  | "uncertain";

export type LeadVehicleTrackingState =
  | "idle"
  | "warming_up"
  | "searching"
  | "candidate_found"
  | "tracking"
  | "temporarily_lost"
  | "switching_vehicle"
  | "stopped"
  | "error";

export interface LeadVehicleSnapshot {
  timestampMs: number;
  sessionId: string;
  trackId: VehicleTrackId;
  vehicleType: SupportedVehicleType;
  boundingBox: NormalizedBoundingBox;
  confidence: number;
  sameDirectionConfidence: number;
  corridorConfidence: number;
  relativeState: LeadVehicleRelativeState;
  visibleDurationMs: number;
  estimatedDistanceMeters?: number;
  lateralPosition: "left" | "center" | "right";
}

export interface LeadVehicleScoreBreakdown {
  corridorScore: number;
  persistenceScore: number;
  centralityScore: number;
  relativeMotionScore: number;
  detectionConfidenceScore: number;
  sizeRelevanceScore: number;
  penalties: {
    lateralExit: number;
    unstableTrack: number;
    opposingMotion: number;
  };
  totalScore: number;
}

export interface LeadVehiclePredictionReadiness {
  ready: boolean;
  confidence: number;
  reasons: string[];
  blockers: string[];
}

export interface LeadVehicleRuntimeMetrics {
  inferenceFps: number;
  averageInferenceDurationMs: number;
  droppedAnalysisFrames: number;
  trackerCount: number;
  lastInferenceAtMs: number | null;
  thermalWarning: boolean;
}

export interface ForwardCorridor {
  topLeftX: number;
  topRightX: number;
  topY: number;
  bottomLeftX: number;
  bottomRightX: number;
  bottomY: number;
}

export interface LeadVehicleModelConfig {
  modelName: string;
  modelVersion: string;
  inputWidth: number;
  inputHeight: number;
  minimumDetectionConfidence: number;
  supportedClasses: SupportedVehicleType[];
}

export interface VehicleTrackerConfig {
  maxMissedFrames: number;
  minimumTrackAgeFrames: number;
  minimumIoU: number;
  trackRetentionMs: number;
}

export interface LeadVehicleAcquiredEvent {
  type: "lead_vehicle_acquired";
  rideId: string;
  sessionId: string;
  timestampMs: number;
  vehicle: LeadVehicleSnapshot;
}

export interface LeadVehicleUpdatedEvent {
  type: "lead_vehicle_updated";
  rideId: string;
  sessionId: string;
  timestampMs: number;
  vehicle: LeadVehicleSnapshot;
}

export interface LeadVehicleMovementChangedEvent {
  type: "lead_vehicle_movement_changed";
  rideId: string;
  sessionId: string;
  timestampMs: number;
  trackId: VehicleTrackId;
  previousState: LeadVehicleRelativeState;
  nextState: LeadVehicleRelativeState;
  vehicle: LeadVehicleSnapshot;
}

export interface LeadVehicleTemporarilyLostEvent {
  type: "lead_vehicle_temporarily_lost";
  rideId: string;
  sessionId: string;
  timestampMs: number;
  trackId: VehicleTrackId;
  vehicleType: SupportedVehicleType;
}

export interface LeadVehicleLostEvent {
  type: "lead_vehicle_lost";
  rideId: string;
  sessionId: string;
  timestampMs: number;
  trackId: string;
  lastKnownVehicleType: SupportedVehicleType;
  trackedDurationMs: number;
}

export interface LeadVehicleChangedEvent {
  type: "lead_vehicle_changed";
  rideId: string;
  sessionId: string;
  timestampMs: number;
  previousTrackId: string;
  nextTrackId: string;
  previousVehicleType: SupportedVehicleType;
  nextVehicleType: SupportedVehicleType;
  reason:
    | "previous_lost"
    | "challenger_more_relevant"
    | "lane_or_corridor_change"
    | "manual_reset";
}

export interface LeadVehicleTrackingErrorEvent {
  type: "lead_vehicle_tracking_error";
  rideId: string;
  sessionId: string;
  timestampMs: number;
  message: string;
}

export type LeadVehicleEvent =
  | LeadVehicleAcquiredEvent
  | LeadVehicleUpdatedEvent
  | LeadVehicleMovementChangedEvent
  | LeadVehicleTemporarilyLostEvent
  | LeadVehicleLostEvent
  | LeadVehicleChangedEvent
  | LeadVehicleTrackingErrorEvent;

export interface LeadVehicleTelemetryEvent {
  eventType:
    | "lead_vehicle_acquired"
    | "lead_vehicle_updated"
    | "lead_vehicle_state_changed"
    | "lead_vehicle_changed"
    | "lead_vehicle_lost"
    | "vehicle_count_round";
  rideId: string;
  riderId: string;
  sessionId: string;
  timestampMs: number;
  payload: {
    trackId?: string;
    vehicleType?: SupportedVehicleType;
    confidence?: number;
    sameDirectionConfidence?: number;
    relativeState?: LeadVehicleRelativeState;
    visibleDurationMs?: number;
    lateralPosition?: "left" | "center" | "right";
    normalizedBoundingBox?: NormalizedBoundingBox;
    predictionReady?: boolean;
    predictionConfidence?: number;
    predictionReasons?: string[];
    predictionBlockers?: string[];
      /** All visible vehicle boxes for viewer overlay (lead + others). */
      detections?: Array<{
        trackId?: string;
        vehicleType?: SupportedVehicleType;
        confidence?: number;
        isLead?: boolean;
        status?: string;
        normalizedBoundingBox: NormalizedBoundingBox;
      }>;
      /** Vehicles currently visible on screen (ahead of rider). */
      vehiclesOnScreen?: number;
      /** Session total of vehicles passed (grew then lost). */
      vehiclesPassed?: number;
      /** Rush Hour–style count round id. */
      roundId?: string;
      /** Authoritative count for the active/finished round. */
      roundCount?: number;
      roundCounting?: boolean;
      roundFinal?: boolean;
      lastPass?: {
        trackId: string;
        vehicleType?: SupportedVehicleType | string;
        timestampMs: number;
        delta?: 1 | -1;
      };
    };
  modelMetadata: {
    modelName: string;
    modelVersion: string;
    inferenceMode: InferenceMode;
  };
}
