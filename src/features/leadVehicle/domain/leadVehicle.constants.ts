import type {
  ForwardCorridor,
  LeadVehicleModelConfig,
  SupportedVehicleType,
  VehicleTrackerConfig,
} from "./leadVehicle.types";

export const DEFAULT_LEAD_VEHICLE_MODEL_CONFIG: LeadVehicleModelConfig = {
  modelName: "coco_ssd_mobilenet_v1",
  modelVersion: "1.0_quant_2018_06_29",
  inputWidth: 300,
  inputHeight: 300,
  minimumDetectionConfidence: 0.35,
  supportedClasses: [
    "car",
    "motorcycle",
    "bus",
    "truck",
    "bicycle",
    "unknown_vehicle",
  ],
};

export const DEFAULT_FORWARD_CORRIDOR: ForwardCorridor = {
  topLeftX: 0.38,
  topRightX: 0.62,
  topY: 0.28,
  bottomLeftX: 0.12,
  bottomRightX: 0.88,
  bottomY: 0.98,
};

export const DEFAULT_TRACKER_CONFIG: VehicleTrackerConfig = {
  // Stickier tracks + more analysis frames = fewer false drop/recreate cycles.
  maxMissedFrames: 6,
  minimumTrackAgeFrames: 3,
  minimumIoU: 0.15,
  trackRetentionMs: 1200,
};

/** Target analysis rate — also mirrored in native LeadVehicleFrameAnalyzer. */
export const DEFAULT_INFERENCE_FPS = 15;

export const LEAD_SWITCH_SCORE_MARGIN = 0.15;
export const LEAD_SWITCH_CONFIRMATION_MS = 500;
export const LEAD_ACQUISITION_CONFIRMATION_MS = 500;
export const LEAD_LOSS_GRACE_PERIOD_MS = 750;

export const SAME_DIRECTION_THRESHOLD = 0.65;
/** Longer window → stabler grow/shrink decisions at low relative speed. */
export const MOTION_WINDOW_MS = 1500;
export const EVENT_HEARTBEAT_MS = 250;

export const PREDICTION_MIN_VISIBLE_MS = 1800;
export const PREDICTION_MIN_RIDER_SPEED_MPS = 1.0;

export const SCORE_WEIGHTS = {
  corridor: 0.28,
  persistence: 0.22,
  centrality: 0.12,
  relativeMotion: 0.18,
  confidence: 0.1,
  size: 0.1,
} as const;

export const PRIMARY_VEHICLE_TYPES: SupportedVehicleType[] = [
  "car",
  "motorcycle",
];
