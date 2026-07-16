import { boxArea, boxCenter, iou } from "./leadVehicle.geometry";
import type { NormalizedBoundingBox, VehicleDetection } from "./leadVehicle.types";

/** Simple, reliable single-vehicle follow status shown to viewers. */
export type LeadFollowStatus =
  | "searching"
  | "approaching"
  | "holding"
  | "pulling_away"
  | "passed";

/**
 * Follow phase: "evaluating" while we verify the vehicle keeps a stable
 * distance (≈ same speed as us) — drawn as a dashed blue box; "locked" once
 * the relation has been stable for LOCK_STABLE_MS — solid green box.
 */
export type LeadFollowPhase = "evaluating" | "locked";

export interface LeadFollowResult {
  trackId: string;
  boundingBox: NormalizedBoundingBox;
  status: LeadFollowStatus;
  phase: LeadFollowPhase;
  /** Raw detector class of the followed vehicle (motorcycle / car / …). */
  vehicleLabel: string;
  lateralPosition: "left" | "center" | "right";
  visibleDurationMs: number;
}

/** Emitted once when we overtake the vehicle we were following. */
export interface LeadPassEvent {
  trackId: string;
  vehicleLabel: string;
  timestampMs: number;
}

/** Keep at most this much box history for the size-trend (speed) estimate. */
const HISTORY_MS = 2000;
/** Compare current size to this far back to decide approaching / pulling away. */
const TREND_LOOKBACK_MS = 700;
/**
 * Missed-frame policy. The detector only sees vehicles on ~70% of frames, so
 * dropping identity after a couple of misses made the follower "switch"
 * constantly — every dropout looked like a new vehicle. Instead:
 *  - identity survives up to MAX_MISSED frames (~2s), re-matching with a
 *    widening radius, so the same car keeps the same number through flicker;
 *  - but the box is only *drawn* for the first RENDER_HOLD_MISSED misses, so
 *    the square still disappears quickly when the vehicle is really gone.
 */
const MAX_MISSED = 6;
const RENDER_HOLD_MISSED = 2;
/** Growth ratio over TREND_LOOKBACK_MS that counts as getting closer / further. */
const APPROACH_RATIO = 1.15;
const RECEDE_RATIO = 0.87;
/** EMA smoothing for the drawn box. High = snappy (follows the vehicle
 *  tightly); low values made the box visibly lag behind the real vehicle. */
const BOX_SMOOTHING = 0.7;
/** Overtake heuristic: lead lost while big + low in frame = we passed it. */
const PASS_AREA = 0.045;
const PASS_BOTTOM_Y = 0.62;
/** The relation (stable distance ≈ matching speed) must hold continuously
 *  this long before the follow is "locked" and the box turns green. */
const LOCK_STABLE_MS = 3000;

/**
 * Acquisition gates. A vehicle only becomes the lead after being seen in
 * CONFIRM_SIGHTINGS consecutive detector frames at roughly the same spot.
 * One-frame false positives (posts, shadows, road texture the model briefly
 * mistakes for a vehicle) never survive this, which is what previously caused
 * random boxes appearing away from any real vehicle.
 */
const CONFIRM_SIGHTINGS = 2;
const MIN_ACQUIRE_AREA = 0.005;
/** Hysteresis for switching away from a locked non-motorcycle lead: a
 *  motorcycle must persist this many consecutive frames (~1s) before it takes
 *  over. Prevents the box from jumping on a single misclassified frame. */
const MOTO_TAKEOVER_SIGHTINGS = 4;
const MIN_ACQUIRE_CONFIDENCE = 0.45;
/** Lane corridor: only acquire vehicles roughly in OUR lane ahead — the
 *  center strip of the frame. Adjacent-lane vehicles don't share our speed
 *  relation and made the follow jump lanes. */
const MIN_ACQUIRE_CENTER_X = 0.3;
const MAX_ACQUIRE_CENTER_X = 0.7;
/** Match radius (normalized center distance) between frames. Grows with each
 *  missed frame — the vehicle keeps moving while the detector blinks — but is
 *  capped tightly: a wide radius let a *different* nearby vehicle inherit the
 *  old identity (bike suddenly labeled "car #67"). */
const MATCH_CENTER_DIST = 0.14;
const MATCH_DIST_PER_MISS = 0.04;
const MATCH_DIST_MAX = 0.22;
/** A continuation match must be roughly the same physical size — a far small
 *  car must never inherit the identity of a near big one (or vice versa). */
const MATCH_SIZE_RATIO_MIN = 0.45;
const MATCH_SIZE_RATIO_MAX = 2.2;

type CurrentLead = {
  trackId: string;
  box: NormalizedBoundingBox;
  label: string;
  firstSeenMs: number;
  lastSeenMs: number;
  missed: number;
  history: { t: number; area: number }[];
  /** Start of the current stretch of stable distance; 0 = not stable. */
  stableStartMs: number;
  /** Once the relation held for LOCK_STABLE_MS the follow stays locked. */
  locked: boolean;
};

type PendingLead = {
  box: NormalizedBoundingBox;
  sightings: number;
};

/** Two-wheelers and four-wheelers never share an identity. */
function vehicleGroup(label: string | undefined): "two" | "four" {
  return label === "motorcycle" || label === "bicycle" ? "two" : "four";
}

/**
 * Follows exactly one "lead" vehicle — the one ahead of us, moving with us.
 * Once locked on it sticks to that vehicle until it is genuinely gone for
 * MAX_MISSED frames, then confirms a new one. Nothing else: no counting, no
 * multi-vehicle tracking, no pass flashes.
 */
export class LeadVehicleFollower {
  private current: CurrentLead | null = null;
  private pending: PendingLead | null = null;
  private lastDisplayId = 0;
  private pendingPassEvent: LeadPassEvent | null = null;
  private motoChallenger: PendingLead | null = null;

  /** Visible two-digit vehicle number (10-99). A new number = a real switch
   *  to another vehicle, so the viewer can see exactly when that happens. */
  private nextDisplayId(): number {
    let id = 10 + Math.floor(Math.random() * 90);
    if (id === this.lastDisplayId) id = 10 + ((id - 9) % 90);
    this.lastDisplayId = id;
    return id;
  }

  reset(): void {
    this.current = null;
    this.pending = null;
    this.pendingPassEvent = null;
    this.motoChallenger = null;
  }

  /** One-shot: returns the pass event since the last call, if any. */
  takePassEvent(): LeadPassEvent | null {
    const ev = this.pendingPassEvent;
    this.pendingPassEvent = null;
    return ev;
  }

  observe(
    detections: VehicleDetection[],
    now: number,
  ): LeadFollowResult | null {
    // Stick with the current lead as long as it's matchable.
    if (this.current) {
      // Motorcycle takeover: if we're locked on a car/truck but a motorcycle
      // keeps showing up ahead, switch to it after MOTO_TAKEOVER_SIGHTINGS.
      const moto = this.observeMotoChallenger(detections, now);
      if (moto) return moto;

      // Identity may only continue on the same kind of vehicle at a similar
      // size — otherwise a neighboring car/bike would inherit this number.
      const match = this.matchNear(
        this.current.box,
        detections.filter((d) => this.isContinuationCandidate(d)),
        Math.min(
          MATCH_DIST_MAX,
          MATCH_CENTER_DIST + this.current.missed * MATCH_DIST_PER_MISS,
        ),
      );
      if (match) {
        this.updateCurrent(match, now);
        return this.buildResult(now);
      }
      this.current.missed += 1;
      if (this.current.missed <= RENDER_HOLD_MISSED) {
        // Briefly hold the drawn box (occlusion / dropped frame).
        return this.buildResult(now, true);
      }
      if (this.current.missed <= MAX_MISSED) {
        // Hide the box but keep the identity — if the detector re-finds this
        // vehicle within the window it keeps its number (no fake "switch").
        return null;
      }
      // Lost for good. If it vanished while big and low in frame, we passed it.
      const area = boxArea(this.current.box);
      const bottomY = this.current.box.y + this.current.box.height;
      if (area >= PASS_AREA && bottomY >= PASS_BOTTOM_Y) {
        this.pendingPassEvent = {
          trackId: this.current.trackId,
          vehicleLabel: this.current.label,
          timestampMs: now,
        };
      }
      this.current = null;
    }

    // No lead: confirm a candidate across consecutive frames before showing it.
    const candidate = this.selectCandidate(detections);
    if (!candidate) {
      this.pending = null;
      return null;
    }
    if (
      this.pending &&
      this.matchNear(this.pending.box, [candidate])
    ) {
      this.pending = {
        box: candidate.boundingBox,
        sightings: this.pending.sightings + 1,
      };
    } else {
      this.pending = { box: candidate.boundingBox, sightings: 1 };
    }
    if (this.pending.sightings < CONFIRM_SIGHTINGS) return null;

    this.pending = null;
    this.current = {
      trackId: `lead_${this.nextDisplayId()}`,
      box: candidate.boundingBox,
      label: candidate.rawLabel ?? "vehicle",
      firstSeenMs: now,
      lastSeenMs: now,
      missed: 0,
      history: [{ t: now, area: boxArea(candidate.boundingBox) }],
      stableStartMs: 0,
      locked: false,
    };
    return this.buildResult(now);
  }

  /**
   * While locked on a non-motorcycle, watch for a persistent motorcycle and
   * switch to it once confirmed. Returns the new lead result when a takeover
   * happens, else null (caller continues with the current lead).
   */
  private observeMotoChallenger(
    detections: VehicleDetection[],
    now: number,
  ): LeadFollowResult | null {
    const cur = this.current;
    if (!cur || cur.label === "motorcycle") {
      this.motoChallenger = null;
      return null;
    }
    const moto = this.selectCandidate(
      detections.filter((d) => d.rawLabel === "motorcycle"),
    );
    if (!moto) {
      this.motoChallenger = null;
      return null;
    }
    if (
      this.motoChallenger &&
      this.matchNear(this.motoChallenger.box, [moto])
    ) {
      this.motoChallenger = {
        box: moto.boundingBox,
        sightings: this.motoChallenger.sightings + 1,
      };
    } else {
      this.motoChallenger = { box: moto.boundingBox, sightings: 1 };
    }
    if (this.motoChallenger.sightings < MOTO_TAKEOVER_SIGHTINGS) return null;

    this.motoChallenger = null;
    this.current = {
      trackId: `lead_${this.nextDisplayId()}`,
      box: moto.boundingBox,
      label: "motorcycle",
      firstSeenMs: now,
      lastSeenMs: now,
      missed: 0,
      history: [{ t: now, area: boxArea(moto.boundingBox) }],
      stableStartMs: 0,
      locked: false,
    };
    return this.buildResult(now);
  }

  /**
   * Whether a detection can *continue* the current lead's identity: same
   * vehicle group (two-wheeler vs four-wheeler) and roughly the same size.
   * Anything else is a different physical vehicle → new number.
   */
  private isContinuationCandidate(d: VehicleDetection): boolean {
    const cur = this.current;
    if (!cur) return false;
    if (
      d.rawLabel &&
      vehicleGroup(d.rawLabel) !== vehicleGroup(cur.label)
    ) {
      return false;
    }
    const ratio =
      boxArea(d.boundingBox) / Math.max(1e-6, boxArea(cur.box));
    return ratio >= MATCH_SIZE_RATIO_MIN && ratio <= MATCH_SIZE_RATIO_MAX;
  }

  /** Best IoU match near a reference box, else nearest center within radius. */
  private matchNear(
    ref: NormalizedBoundingBox,
    candidates: VehicleDetection[],
    maxDist: number = MATCH_CENTER_DIST,
  ): VehicleDetection | null {
    let best: VehicleDetection | null = null;
    let bestIou = 0.1;
    for (const d of candidates) {
      const overlap = iou(ref, d.boundingBox);
      if (overlap > bestIou) {
        bestIou = overlap;
        best = d;
      }
    }
    if (best) return best;
    const c = boxCenter(ref);
    let bestDist = maxDist;
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

  private updateCurrent(match: VehicleDetection, now: number): void {
    const cur = this.current;
    if (!cur) return;
    const box = match.boundingBox;
    // Light smoothing to reduce jitter while staying tight on the vehicle.
    cur.box = {
      x: cur.box.x + (box.x - cur.box.x) * BOX_SMOOTHING,
      y: cur.box.y + (box.y - cur.box.y) * BOX_SMOOTHING,
      width: cur.box.width + (box.width - cur.box.width) * BOX_SMOOTHING,
      height: cur.box.height + (box.height - cur.box.height) * BOX_SMOOTHING,
    };
    // Upgrade the label if the detector becomes surer of a motorcycle.
    if (match.rawLabel === "motorcycle") cur.label = "motorcycle";
    cur.lastSeenMs = now;
    cur.missed = 0;
    cur.history.push({ t: now, area: boxArea(box) });
    cur.history = cur.history.filter((h) => now - h.t <= HISTORY_MS);
  }

  private buildResult(now: number, occluded = false): LeadFollowResult {
    const cur = this.current!;
    const status: LeadFollowStatus = occluded
      ? "holding"
      : this.trendStatus(now);
    // Speed-match lock: distance must stay stable ("holding") continuously
    // for LOCK_STABLE_MS before the follow is trusted (green). Occluded
    // frames neither advance nor reset the clock.
    if (!cur.locked && !occluded) {
      if (status === "holding") {
        if (cur.stableStartMs === 0) cur.stableStartMs = now;
        if (now - cur.stableStartMs >= LOCK_STABLE_MS) cur.locked = true;
      } else {
        cur.stableStartMs = 0;
      }
    }
    const center = boxCenter(cur.box);
    return {
      trackId: cur.trackId,
      boundingBox: cur.box,
      status,
      phase: cur.locked ? "locked" : "evaluating",
      vehicleLabel: cur.label,
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

  /** Best vehicle that clears the acquisition gates. Motorcycles win over
   *  everything else; among equals prefer larger (nearer) + more central. */
  private selectCandidate(
    detections: VehicleDetection[],
  ): VehicleDetection | null {
    const eligible = detections.filter((d) => {
      if (d.confidence < MIN_ACQUIRE_CONFIDENCE) return false;
      if (boxArea(d.boundingBox) < MIN_ACQUIRE_AREA) return false;
      const c = boxCenter(d.boundingBox);
      return c.x >= MIN_ACQUIRE_CENTER_X && c.x <= MAX_ACQUIRE_CENTER_X;
    });
    const motorcycles = eligible.filter((d) => d.rawLabel === "motorcycle");
    const pool = motorcycles.length > 0 ? motorcycles : eligible;
    let best: VehicleDetection | null = null;
    let bestScore = -Infinity;
    for (const d of pool) {
      const c = boxCenter(d.boundingBox);
      // Strong lane-center preference: the vehicle we share speed with is the
      // one directly ahead, not one off in a neighboring lane.
      const score = boxArea(d.boundingBox) - 1.0 * Math.abs(c.x - 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }
}
