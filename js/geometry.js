// Pure 2D geometry helpers. All points are {x, y} in pixels, screen coordinates (y grows downward).

export const deg = (rad) => (rad * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) };
}

/** Interior angle at vertex b, in degrees (0..180). */
export function angleAt(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y, wx = c.x - b.x, wy = c.y - b.y;
  return Math.abs(deg(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)));
}

/** Signed angle from vector u to vector w, degrees in (-180, 180]. Positive = clockwise on screen. */
export function signedAngle(ux, uy, wx, wy) {
  return deg(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy));
}

/**
 * Angle of the segment from→to measured from straight down (gravity).
 * Positive when `to` is ahead of `from` in the running direction `dir` (+1 = facing screen-right).
 * Used for thigh and shin angles.
 */
export function angleFromVertical(from, to, dir = 1) {
  return deg(Math.atan2((to.x - from.x) * dir, to.y - from.y));
}

/** Angle of the segment from→to measured from straight up. Positive = leaning forward (toward `dir`). */
export function leanFromVertical(from, to, dir = 1) {
  return deg(Math.atan2((to.x - from.x) * dir, from.y - to.y));
}

/** Foot inclination: heel→toe from horizontal. Positive when the toes are higher than the heel (dorsiflexed, heel-first). */
export function footAngle(heel, toe, dir = 1) {
  return deg(Math.atan2(heel.y - toe.y, (toe.x - heel.x) * dir));
}

/** Rotate points about (cx, cy) by theta radians, clockwise as seen on screen. Null entries pass through. */
export function rotatePoints(points, cx, cy, theta) {
  if (!theta) return points;
  const c = Math.cos(theta), s = Math.sin(theta);
  return points.map((p) =>
    p && { ...p, x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }
  );
}

export function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
}

export function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
