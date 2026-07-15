import { normalizeVehicleDetections } from "../domain/leadVehicle.normalize";
import type { VehicleDetection } from "../domain/leadVehicle.types";

export type RemoteInferRequest = {
  timestampMs: number;
  frameWidth?: number;
  frameHeight?: number;
  rotationDegrees?: number;
  /** Optional downscaled JPEG — server can also analyze ingested stream later. */
  imageBase64?: string;
};

type RemoteInferResponseBody = {
  detections?: Array<{
    vehicleType?: string;
    confidence?: number;
    boundingBox?: {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
  }>;
  inferenceDurationMs?: number;
};

/**
 * POST /api/live/sessions/:sessionId/lead-vehicle/infer
 * Soft-fails until camtok ships the route — hybrid mode keeps on-device only.
 */
export class RemoteVehicleInferClient {
  constructor(private sessionId: string) {}

  async infer(
    request: RemoteInferRequest,
  ): Promise<{ detections: VehicleDetection[]; inferenceDurationMs: number } | null> {
    try {
      const { apiFetch } = await import("@/lib/api");
      const body = await apiFetch<RemoteInferResponseBody>(
        `/api/live/sessions/${this.sessionId}/lead-vehicle/infer`,
        {
          method: "POST",
          body: request as unknown as Record<string, unknown>,
        },
      );
      const raw: VehicleDetection[] = (body.detections ?? []).map((d) => ({
        vehicleType: "vehicle" as const,
        confidence: d.confidence ?? 0,
        boundingBox: {
          x: d.boundingBox?.x ?? 0,
          y: d.boundingBox?.y ?? 0,
          width: d.boundingBox?.width ?? 0,
          height: d.boundingBox?.height ?? 0,
        },
      }));
      return {
        detections: normalizeVehicleDetections(raw),
        inferenceDurationMs: body.inferenceDurationMs ?? 0,
      };
    } catch {
      return null;
    }
  }
}
