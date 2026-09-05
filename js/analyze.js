// Offline re-analysis of a recorded landmark track.
//
// Live capture smooths landmark positions fairly hard so the drawn skeleton does not jitter, but
// that smoothing lags the true position and biases every angle sampled at a single instant
// (foot contact and toe-off). Reviewing a recording has no such constraint: the whole track is
// already in hand, so it is re-analysed with almost no smoothing. Measured against the synthetic
// runner this roughly halves the error, and it stays stable with landmark noise up to ~6 px
// because the analyzer already takes medians across strides.
import { Smoother, GaitAnalyzer } from './gait.js';
import { rotatePoints, rad, median } from './geometry.js';

export const REVIEW_ALPHA = 0.95;

/**
 * Re-run stride detection over a LandmarkTrack.
 * width/height are the pixel space to work in; any square-preserving choice gives the same angles.
 * mPerPx seeds the metric scale captured live from MediaPipe's world landmarks (for vertical bounce).
 */
export function analyzeTrack(track, { view = 'side', width = 1280, height = 720, alpha = REVIEW_ALPHA, mPerPx = null } = {}) {
  const an = new GaitAnalyzer({ view, history: true });
  if (mPerPx > 0) an.mPerPx = mPerPx;
  const sm = new Smoother(alpha);
  for (let i = 0; i < track.length; i++) {
    const t = track.ts[i];
    const P = track.pointsAtIndex(i, width, height);
    if (!P) { sm.reset(); an.update(null, null, t); continue; }
    const smoothed = sm.apply(P, t);
    an.update(rotatePoints(smoothed, width / 2, height / 2, rad(track.rolls[i])), null, t);
  }
  return { events: an.events, metrics: an.getMetrics(), dir: an.dir };
}

/** Metres per pixel from one frame of MediaPipe world landmarks, or null if implausible. */
export function frameScale(world, pxLegLen) {
  if (!world || world.length < 33 || !(pxLegLen > 1)) return null;
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
  const wl = (d3(world[23], world[25]) + d3(world[25], world[27]) + d3(world[24], world[26]) + d3(world[26], world[28])) / 2;
  if (!(wl > 0.4 && wl < 1.4)) return null;
  return wl / pxLegLen;
}

export const medianScale = (samples) => (samples.length ? median(samples) : null);
