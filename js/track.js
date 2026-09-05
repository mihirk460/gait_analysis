// Storage and time-lookup for the landmark track recorded alongside the video.
//
// Landmarks are kept normalised (0..1) so the track is independent of the capture resolution,
// packed three floats per point: 33 points x (x, y, visibility) = 396 bytes per frame.
// A 60 s recording at 30 fps is therefore about 0.7 MB, next to nothing beside the video itself.

export const POINTS = 33;
const STRIDE = POINTS * 3;

/** Index of the entry in the sorted array `ts` whose time is nearest to `t`. -1 when empty. */
export function nearestIndex(ts, t) {
  const n = ts.length;
  if (!n) return -1;
  let lo = 0, hi = n - 1;
  if (t <= ts[0]) return 0;
  if (t >= ts[hi]) return hi;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid; else hi = mid;
  }
  return t - ts[lo] <= ts[hi] - t ? lo : hi;
}

export class LandmarkTrack {
  constructor(capacity = 512) {
    this.ts = [];      // ms from the start of the recording
    this.rolls = [];   // camera roll (deg) at that instant
    // One buffer that doubles as needed, rather than a Float32Array per frame: a 60 s clip is
    // one 0.7 MB allocation instead of 1800 small ones the collector has to walk.
    this.data = new Float32Array(capacity * STRIDE);
    this.n = 0;
  }

  get length() { return this.n; }
  get duration() { return this.n ? this.ts[this.n - 1] : 0; }
  /** Memory held by the landmark track, in bytes. */
  get bytes() { return this.data.byteLength + this.n * 16; }

  /** landmarks: MediaPipe normalised landmarks, or null when nothing was detected in this frame. */
  push(t, landmarks, roll = 0) {
    if ((this.n + 1) * STRIDE > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const off = this.n * STRIDE;
    if (landmarks) {
      for (let i = 0; i < POINTS; i++) {
        const p = landmarks[i], o = off + i * 3;
        this.data[o] = p.x; this.data[o + 1] = p.y; this.data[o + 2] = p.visibility ?? 1;
      }
    } else {
      this.data.fill(0, off, off + STRIDE); // visibility 0 marks the frame as untracked
    }
    this.ts.push(t); this.rolls.push(roll); this.n++;
  }

  /** Multiply every timestamp by `factor`, to fit the track to the real duration of the encoded video. */
  rescale(factor) {
    if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return;
    for (let i = 0; i < this.n; i++) this.ts[i] *= factor;
  }

  indexAt(t) { return nearestIndex(this.ts, t); }

  /** Landmarks at time `t` in pixels for a `w` x `h` canvas, or null if that frame had no detection. */
  pointsAt(t, w, h) {
    const i = this.indexAt(t);
    if (i < 0) return null;
    return this.pointsAtIndex(i, w, h);
  }

  pointsAtIndex(i, w, h) {
    if (i < 0 || i >= this.n) return null;
    const off = i * STRIDE;
    if (this.data[off + 2] === 0) return null; // visibility 0 on the nose: nothing was detected
    const pts = new Array(POINTS);
    for (let j = 0; j < POINTS; j++) {
      const o = off + j * 3;
      pts[j] = { x: this.data[o] * w, y: this.data[o + 1] * h, v: this.data[o + 2] };
    }
    return pts;
  }

  rollAt(t) {
    const i = this.indexAt(t);
    return i < 0 ? 0 : this.rolls[i];
  }
}

/** The event nearest to `t`, within `window` ms, or null. */
export function nearestEvent(events, t, window = 400) {
  let best = null, bestD = Infinity;
  for (const e of events) {
    const d = Math.abs(e.t - t);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best && bestD <= window ? best : null;
}

/** The event at or before `t`, and the next one after it. Either may be null. */
export function surroundingEvents(events, t) {
  let prev = null, next = null;
  for (const e of events) {
    if (e.t <= t) { if (!prev || e.t > prev.t) prev = e; }
    else if (!next || e.t < next.t) next = e;
  }
  return { prev, next };
}

/** Which phase each leg is in at time `t`, derived from the event log. */
export function phasesAt(events, t) {
  const phase = { L: null, R: null };
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'IC') phase[e.side] = 'stance';
    else if (e.type === 'TO') phase[e.side] = 'swing';
  }
  return phase;
}

/** Contact-to-contact interval of one leg containing `t`, as [start, end] ms, or null. */
export function strideAt(events, t) {
  const ics = events.filter((e) => e.type === 'IC');
  for (let i = 0; i < ics.length - 1; i++) {
    if (ics[i].t <= t && t < ics[i + 1].t) return [ics[i].t, ics[i + 1].t];
  }
  return null;
}
