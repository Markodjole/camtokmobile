import {
  boxArea,
  boxBottomCenter,
  boxCenter,
  iou,
} from "./leadVehicle.geometry";
import type { NormalizedBoundingBox, VehicleDetection } from "./leadVehicle.types";

/** Simple, reliable single-vehicle follow status shown to viewers. */
export type LeadFollowStatus =
  | "searching"
  | "approaching"
  | "holding"
  | "pulling_away"
  | "passed";

export interface LeadFollowResult {
  trackId: string;
  boundingBox: NormalizedBoundingBox;
  status: LeadFollowStatus;
  lateralPosition: "left" | "center" | "right";
  visibleDurationMs: number;
}

/** Keep at most this much box history for the size-trend (speed) estimate. */
const HISTORY_MS = 1500;
/** Compare current size to this far back to decide approaching / pulling away. */
const TREND_LOOKBACK_MS = 700;
/** Frames the lead may be unmatched before we declare it lost. */
const MAX_MISSED = 4;
/** Growth ratio over TREND_LOOKBACK_MS that counts as getting closer / further. */
const APPROACH_RATIO = 1.15;
const RECEDE_RATIO = 0.87;
/** A lead must be at least this big to be a real, followable vehicle. */
const MIN_LEAD_AREA = 0.004;
/** EMA smoothing for the drawn box (reduce jitter). */
const BOX_SMOOTHING = 0.45;
/** When the lead is lost while big + low in frame, we overtook it. */
const PASS_AREA = 0.045;
const PASS_BOTTOM_Y = 0.62;
/** How long to keep showing the "passed" flash after overtaking. */
const PASS_FLASH_MS = 1800;

type CurrentLead = {
  trackId: string;
  box: NormalizedBoundingBox;
  firstSeenMs: number;
  lastSeenMs: number;
  missed: number;
  history: { t: number; area: number }[];
};

/**
 * Tracks a single "lead" vehicle — the one we're following ahead — instead of
 * every vehicle on screen. Picks the most central, nearest (largest) vehicle,
 * follows it across frames, and reports whether we're approaching, holding,
 * pulling away, or have passed it. Cheap: one target, no per-vehicle counting.
 */
export class LeadVehicleFollower {
  private current: CurrentLead | null = null;
  private idCounter = 0;
  private passFlashUntilMs = 0;
  private lastBox: NormalizedBoundingBox | null = null;

  reset(): void {
    this.current = null;
    this.passFlashUntilMs = 0;
    this.lastBox = null;
  }

  observe(
    detections: VehicleDetection[],
    now: number,
  ): LeadFollowResult | null {
    const candidates = detections.filter(
      (d) => boxArea(d.boundingBox) >= MIN_LEAD_AREA,
    );

    if (this.current) {
      const match = this.matchCurrent(candidates);
      if (match) {
        this.updateCurrent(match.boundingBox, now);
        return this.buildResult(now);
      }
      this.current.missed += 1;
      if (this.current.missed <= MAX_MISSED) {
        // Briefly hold the last box (occlusion / dropped frame).
        return this.buildResult(now, true);
      }
      // Lost for good — did we pass it, or did it get away?
      const passed = this.wasOvertaken();
      this.current = null;
      if (passed) {
        this.passFlashUntilMs = now + PASS_FLASH_MS;
      }
    }

    if (now < this.passFlashUntilMs && this.lastBox) {
      return {
        trackId: "passed",
        boundingBox: this.lastBox,
        status: "passed",
        lateralPosition: "center",
        visibleDurationMs: 0,
      };
    }

    // Acquire a new lead: the most central, nearest (largest) vehicle.
    const lead = this.selectLead(candidates);
    if (!lead) return null;
    this.idCounter += 1;
    this.current = {
      trackId: `lead_${this.idCounter}`,
      box: lead.boundingBox,
      firstSeenMs: now,
      lastSeenMs: now,
      missed: 0,
      history: [{ t: now, area: boxArea(lead.boundingBox) }],
    };
    this.lastBox = lead.boundingBox;
    return this.buildResult(now);
  }

  private matchCurrent(
    candidates: VehicleDetection[],
  ): VehicleDetection | null {
    const cur = this.current;
    if (!cur) return null;
    let best: VehicleDetection | null = null;
    let bestIou = 0.1;
    for (const d of candidates) {
      const overlap = iou(cur.box, d.boundingBox);
      if (overlap > bestIou) {
        bestIou = overlap;
        best = d;
      }
    }
    if (best) return best;
    // Fall back to nearest center within a small radius.
    const c = boxCenter(cur.box);
    let bestDist = 0.14;
    for (const d of candidates) {
      const dc = boxCenter(d.boundingBox);
      const dist = Math.hypot(dc.x - c.x, dc.y - c.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  private updateCurrent(box: NormalizedBoundingBox, now: number): void {
    const cur = this.current;
    if (!cur) return;
    // Smooth the drawn box to reduce jitter.
    cur.box = {
      x: cur.box.x + (box.x - cur.box.x) * BOX_SMOOTHING,
      y: cur.box.y + (box.y - cur.box.y) * BOX_SMOOTHING,
      width: cur.box.width + (box.width - cur.box.width) * BOX_SMOOTHING,
      height: cur.box.height + (box.height - cur.box.height) * BOX_SMOOTHING,
    };
    cur.lastSeenMs = now;
    cur.missed = 0;
    cur.history.push({ t: now, area: boxArea(box) });
    cur.history = cur.history.filter((h) => now - h.t <= HISTORY_MS);
    this.lastBox = cur.box;
  }

  private buildResult(now: number, occluded = false): LeadFollowResult {
    const cur = this.current!;
    const status: LeadFollowStatus = occluded
      ? "holding"
      : this.trendStatus(now);
    const center = boxCenter(cur.box);
    return {
      trackId: cur.trackId,
      boundingBox: cur.box,
      status,
      lateralPosition:
        center.x < 0.4 ? "left" : center.x > 0.6 ? "right" : "center",
      visibleDurationMs: now - cur.firstSeenMs,
    };
  }

  private trendStatus(now: number): LeadFollowStatus {
    const cur = this.current!;
    const areaNow = boxArea(cur.box);
    // Find the oldest sample at least TREND_LOOKBACK_MS ago.
    let past: { t: number; area: number } | null = null;
    for (const h of cur.history) {
      if (now - h.t >= TREND_LOOKBACK_MS) past = h;
    }
    if (!past || past.area <= 0) return "holding";
    const ratio = areaNow / past.area;
    if (ratio >= APPROACH_RATIO) return "approaching";
    if (ratio <= RECEDE_RATIO) return "pulling_away";
    return "holding";
  }

  private wasOvertaken(): boolean {
    if (!this.lastBox) return false;
    const area = boxArea(this.lastBox);
    const bottom = boxBottomCenter(this.lastBox);
    return area >= PASS_AREA && bottom.y >= PASS_BOTTOM_Y;
  }

  private selectLead(
    candidates: VehicleDetection[],
  ): VehicleDetection | null {
    let best: VehicleDetection | null = null;
    let bestScore = -Infinity;
    for (const d of candidates) {
      const c = boxCenter(d.boundingBox);
      // Prefer larger (nearer) and more central vehicles.
      const score = boxArea(d.boundingBox) - 0.6 * Math.abs(c.x - 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }
}
