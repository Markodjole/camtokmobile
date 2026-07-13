import type {
  ForwardCorridor,
  NormalizedBoundingBox,
} from "./leadVehicle.types";

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function boxArea(box: NormalizedBoundingBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

export function boxCenter(box: NormalizedBoundingBox): { x: number; y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

export function boxBottomCenter(box: NormalizedBoundingBox): {
  x: number;
  y: number;
} {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height,
  };
}

/** Intersection-over-union for normalized boxes. */
export function iou(
  a: NormalizedBoundingBox,
  b: NormalizedBoundingBox,
): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = boxArea(a) + boxArea(b) - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function cross(
  o: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Point-in-trapezoid via consistent edge orientation (CCW polygon). */
export function pointInTrapezoid(
  point: { x: number; y: number },
  corridor: ForwardCorridor,
): boolean {
  const verts = [
    { x: corridor.topLeftX, y: corridor.topY },
    { x: corridor.topRightX, y: corridor.topY },
    { x: corridor.bottomRightX, y: corridor.bottomY },
    { x: corridor.bottomLeftX, y: corridor.bottomY },
  ];
  let sign = 0;
  for (let i = 0; i < verts.length; i += 1) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const c = cross(a, b, point);
    if (c === 0) continue;
    if (sign === 0) sign = c > 0 ? 1 : -1;
    else if ((c > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}

/** Horizontal centerline X at a given Y within the corridor trapezoid. */
export function corridorCenterlineX(
  y: number,
  corridor: ForwardCorridor,
): number {
  const t =
    corridor.bottomY === corridor.topY
      ? 0
      : clamp01((y - corridor.topY) / (corridor.bottomY - corridor.topY));
  const left =
    corridor.topLeftX + (corridor.bottomLeftX - corridor.topLeftX) * t;
  const right =
    corridor.topRightX + (corridor.bottomRightX - corridor.topRightX) * t;
  return (left + right) / 2;
}

export function corridorHalfWidthAtY(
  y: number,
  corridor: ForwardCorridor,
): number {
  const t =
    corridor.bottomY === corridor.topY
      ? 0
      : clamp01((y - corridor.topY) / (corridor.bottomY - corridor.topY));
  const left =
    corridor.topLeftX + (corridor.bottomLeftX - corridor.topLeftX) * t;
  const right =
    corridor.topRightX + (corridor.bottomRightX - corridor.topRightX) * t;
  return Math.max(0.001, (right - left) / 2);
}

export function lateralPositionFromX(
  x: number,
): "left" | "center" | "right" {
  if (x < 0.4) return "left";
  if (x > 0.6) return "right";
  return "center";
}

export function normalizeBox(box: NormalizedBoundingBox): NormalizedBoundingBox {
  return {
    x: clamp01(box.x),
    y: clamp01(box.y),
    width: clamp01(box.width),
    height: clamp01(box.height),
  };
}
