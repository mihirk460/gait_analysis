// Stride event detection and running-form metrics from 2D pose landmarks.
//
// Side view (sagittal): on a treadmill the belt drags the stance foot backward relative to the
// hips, while the swing foot moves forward. The sign change of the ankle's horizontal velocity
// relative to the hip therefore marks initial contact (forward → backward) and toe-off
// (backward → forward). Angles are sampled at those instants.
//
// Rear view (frontal): the stance leg is the one whose ankle is clearly lower. Pelvic drop,
// knee valgus and trunk sway are tracked over each stance and their peaks reported.
import {
  angleAt, angleFromVertical, leanFromVertical, footAngle, signedAngle,
  dist, dist3, mid, deg, median, mean, clamp,
} from './geometry.js';

// MediaPipe Pose landmark indices
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30, L_TOE: 31, R_TOE: 32,
};

export const SIDES = {
  L: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  R: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

const CORE = [11, 12, 23, 24, 25, 26, 27, 28];
const V_THRESH = 0.4;        // forward foot velocity above which the foot cannot be on the belt (leg-lengths/s)
const CONTACT_IN = 0.06;     // foot bottom within this height of the belt (in leg lengths) can be on the ground
const CONTACT_OUT = 0.10;    // foot bottom above this height is certainly in the air
const VY_DESCEND = 0.4;      // foot still dropping faster than this (leg-lengths/s) has not landed yet
const VY_RISE = -0.6;        // foot rising faster than this has left the belt
const GROUND_WINDOW_MS = 2500;
const MIN_EVENT_GAP_MS = 120;
const KEEP = 6;              // samples kept per metric and side
const FALLBACK_LEG_M = 0.86; // hip→ankle length used when no metric scale is available
const MIN_VIS = 0.5;

function percentile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/** Per-frame sagittal angles. `dir` is +1 when the runner faces screen-right. */
export function sideAngles(P, dir = 1) {
  const hipMid = mid(P[23], P[24]), shMid = mid(P[11], P[12]);
  return {
    trunk: leanFromVertical(hipMid, shMid, dir),
    elbowL: angleAt(P[11], P[13], P[15]),
    elbowR: angleAt(P[12], P[14], P[16]),
    kneeL: 180 - angleAt(P[23], P[25], P[27]),
    kneeR: 180 - angleAt(P[24], P[26], P[28]),
  };
}

/** Per-frame frontal angles, given which leg is in stance ('L', 'R' or null). */
export function rearAngles(P, stance = null) {
  const hipMid = mid(P[23], P[24]), shMid = mid(P[11], P[12]);
  const out = { trunkLat: Math.abs(deg(Math.atan2(shMid.x - hipMid.x, hipMid.y - shMid.y))), stance };
  if (stance) {
    const S = SIDES[stance], C = SIDES[stance === 'L' ? 'R' : 'L'];
    out.drop = deg(Math.atan2(P[C.hip].y - P[S.hip].y, Math.abs(P[C.hip].x - P[S.hip].x)));
    const medial = Math.sign(hipMid.x - P[S.hip].x) || 1;
    const fppa = 180 - angleAt(P[S.hip], P[S.knee], P[S.ankle]);
    out.valgus = (P[S.knee].x - (P[S.hip].x + P[S.ankle].x) / 2) * medial > 0 ? fppa : -fppa;
  }
  return out;
}

/** Which leg is in stance in a rear view, from ankle height. Null when neither is clearly lower. */
export function rearStance(P, legLen) {
  const diff = (P[27].y - P[28].y) / legLen;
  return diff > 0.12 ? 'L' : diff < -0.12 ? 'R' : null;
}

/** Exponential smoothing of landmark positions between frames. Resets after a gap. */
export class Smoother {
  constructor(alpha = 0.7) { this.alpha = alpha; this.pts = null; this.t = null; }
  reset() { this.pts = null; this.t = null; }
  apply(raw, t) {
    if (!raw) { this.pts = null; return null; }
    if (!this.pts || this.t == null || t - this.t > 500 || this.pts.length !== raw.length) {
      this.pts = raw.map((p) => ({ ...p }));
    } else {
      const a = this.alpha;
      for (let i = 0; i < raw.length; i++) {
        const s = this.pts[i], p = raw[i];
        s.x += a * (p.x - s.x); s.y += a * (p.y - s.y); s.v = p.v;
      }
    }
    this.t = t;
    return this.pts;
  }
}

export class GaitAnalyzer {
  /** history: keep every stride's samples and a timestamped event log (used by the review app). */
  constructor({ view = 'side', history = false } = {}) {
    this.view = view;
    this.keep = history ? Infinity : KEEP;
    this.reset();
  }

  reset() {
    this.prevT = null;
    this.dir = 1; this.dirVotes = 0;
    this.legLen = null; this.mPerPx = null;
    this.legs = { L: this._legState(), R: this._legState() };
    this.icTimes = [];
    this.samples = {};
    this.events = [];
    this.frameBuf = [];
    this.stanceLeg = null; this.rear = null;
    this.lastEvent = null;
    this.live = null;
    this.prevP = null;
    this.tracking = false;
  }

  _legState() {
    return { relX: null, v: 0, phase: null, icT: null, prevIcT: null, peakKnee: 0, lastEventT: -Infinity, groundBuf: [], footY: null, vy: 0 };
  }

  setView(view) { if (view !== this.view) { this.view = view; this.reset(); } }

  /**
   * P: 33 level-corrected landmarks {x, y, v} in pixels (already smoothed).
   * world: optional 33 metric landmarks {x, y, z} from MediaPipe, used only for scale.
   * t: timestamp in ms.
   */
  update(P, world, t) {
    if (!P || P.length < 33 || !CORE.every((i) => (P[i].v ?? 1) > MIN_VIS)) {
      this.tracking = false; this.live = null; this.prevT = t; return;
    }
    this.tracking = true;
    const dt = this.prevT == null ? 0 : (t - this.prevT) / 1000;
    this.prevT = t;

    const ll = (dist(P[23], P[25]) + dist(P[25], P[27]) + dist(P[24], P[26]) + dist(P[26], P[28])) / 2;
    if (!(ll > 1)) return;
    this.legLen = this.legLen ? this.legLen + 0.05 * (ll - this.legLen) : ll;
    if (world && world.length >= 33) {
      const wl = (dist3(world[23], world[25]) + dist3(world[25], world[27]) + dist3(world[24], world[26]) + dist3(world[26], world[28])) / 2;
      if (wl > 0.4 && wl < 1.4) {
        const s = wl / ll;
        this.mPerPx = this.mPerPx ? this.mPerPx + 0.05 * (s - this.mPerPx) : s;
      }
    }

    const hipMid = mid(P[23], P[24]), shMid = mid(P[11], P[12]);
    if (this.view === 'side') this._updateSide(P, hipMid, shMid, t, dt);
    else this._updateRear(P, hipMid, shMid, t, dt);
  }

  // ---------------- side view ----------------
  _updateSide(P, hipMid, shMid, t, dt) {
    // Which way is the runner facing? Toes point forward.
    const fd = (P[31].x - P[29].x) + (P[32].x - P[30].x);
    this.dirVotes = clamp(this.dirVotes + Math.sign(fd), -30, 30);
    if (Math.abs(this.dirVotes) >= 5) this.dir = this.dirVotes > 0 ? 1 : -1;
    const dir = this.dir;

    const { trunk, elbowL, elbowR, kneeL, kneeR } = sideAngles(P, dir);
    this.frameBuf.push({ t, trunk, elbowL, elbowR, hipY: hipMid.y });
    while (this.frameBuf.length && t - this.frameBuf[0].t > 3000) this.frameBuf.shift();
    this.live = { dir, trunk, elbowL, elbowR, kneeL, kneeR, phaseL: this.legs.L.phase, phaseR: this.legs.R.phase };

    for (const side of ['L', 'R']) {
      const S = SIDES[side], leg = this.legs[side];
      const relX = ((P[S.ankle].x - hipMid.x) * dir) / this.legLen;
      if (leg.relX != null && dt > 0) leg.v = (relX - leg.relX) / dt;
      leg.relX = relX;

      // Belt level: the lowest point the foot reaches (robust high percentile over the recent past).
      const footY = Math.max(P[S.heel].y, P[S.toe].y);
      leg.groundBuf.push({ t, y: footY });
      while (leg.groundBuf.length && t - leg.groundBuf[0].t > GROUND_WINDOW_MS) leg.groundBuf.shift();
      const ground = percentile(leg.groundBuf.map((g) => g.y), 0.9);
      const height = (ground - footY) / this.legLen; // 0 = on the belt
      if (leg.footY != null && dt > 0) leg.vy = (footY - leg.footY) / dt / this.legLen; // positive = moving down
      leg.footY = footY;
      if (dt <= 0 || leg.groundBuf.length < 10) continue;

      const kneeFlex = side === 'L' ? kneeL : kneeR;
      if (leg.phase === 'stance') leg.peakKnee = Math.max(leg.peakKnee, kneeFlex);
      if (t - leg.lastEventT < MIN_EVENT_GAP_MS) continue;

      // Velocities are backward differences, so a transition is seen one frame after it happened,
      // somewhere between the previous frame and this one. Event angles are averaged over both frames.
      const frames = this.prevP ? [this.prevP, P] : [P];
      const onGround = height < CONTACT_IN && leg.vy < VY_DESCEND && leg.v < V_THRESH;
      const inAir = height > CONTACT_OUT || (leg.vy < VY_RISE && height > 0.02) || leg.v > V_THRESH;
      if (onGround && leg.phase !== 'stance') {
        if (leg.phase === 'swing') this._onContact(side, t, frames);
        leg.phase = 'stance'; leg.lastEventT = t;
      } else if (inAir && leg.phase !== 'swing') {
        if (leg.phase === 'stance') this._onToeOff(side, t, frames);
        leg.phase = 'swing'; leg.lastEventT = t;
      }
    }
    this.prevP = P.map((p) => ({ x: p.x, y: p.y, v: p.v }));
  }

  _onContact(side, t, frames) {
    const S = SIDES[side], leg = this.legs[side];
    const avg = (fn) => mean(frames.map(fn));
    const kneeFlex = avg((P) => 180 - angleAt(P[S.hip], P[S.knee], P[S.ankle]));
    leg.icT = t; leg.peakKnee = kneeFlex;
    const values = {};
    this._push('kneeIC', side, kneeFlex, values);
    this._push('tibiaIC', side, avg((P) => angleFromVertical(P[S.knee], P[S.ankle], this.dir)), values);
    this._push('footIC', side, avg((P) => footAngle(P[S.heel], P[S.toe], this.dir)), values);
    this._pushCadence(t, side, values);

    // Metrics that span the previous full gait cycle of this leg (IC → IC).
    if (leg.prevIcT != null && t - leg.prevIcT < 2000) {
      const win = this.frameBuf.filter((f) => f.t > leg.prevIcT && f.t <= t);
      if (win.length >= 4) {
        this._push('trunkLean', side, mean(win.map((f) => f.trunk)), values);
        this._push('elbow', side, mean(win.map((f) => (side === 'L' ? f.elbowL : f.elbowR))), values);
        const ys = win.map((f) => f.hipY);
        const rangePx = Math.max(...ys) - Math.min(...ys);
        const mpp = this.mPerPx ?? FALLBACK_LEG_M / this.legLen;
        this._push('vertOsc', side, rangePx * mpp * 100, values);
      }
    }
    leg.prevIcT = t;
    this.lastEvent = { type: 'IC', side, t };
    this.events.push({ t, type: 'IC', side, values });
  }

  _onToeOff(side, t, frames) {
    const S = SIDES[side], leg = this.legs[side], values = {};
    if (leg.icT != null) {
      const gct = t - leg.icT;
      if (gct > 80 && gct < 700) this._push('gct', side, gct, values);
    }
    this._push('kneePeak', side, leg.peakKnee, values);
    // Hip extension relative to the trunk (anatomical hip angle), positive = thigh behind the trunk line.
    const hipExt = mean(frames.map((P) => {
      const tdx = P[S.hip].x - P[S.shoulder].x, tdy = P[S.hip].y - P[S.shoulder].y;
      const thx = P[S.knee].x - P[S.hip].x, thy = P[S.knee].y - P[S.hip].y;
      return this.dir * signedAngle(tdx, tdy, thx, thy);
    }));
    this._push('hipExtTO', side, hipExt, values);
    this.lastEvent = { type: 'TO', side, t };
    this.events.push({ t, type: 'TO', side, values });
  }

  _pushCadence(t, side, bag) {
    this.icTimes.push(t);
    if (this.icTimes.length > 9) this.icTimes.shift();
    const n = this.icTimes.length;
    if (n >= 4) {
      const spm = (60000 * (n - 1)) / (this.icTimes[n - 1] - this.icTimes[0]);
      if (spm > 100 && spm < 260) this._push('cadence', side, spm, bag);
    }
  }

  // ---------------- rear view ----------------
  _updateRear(P, hipMid, shMid, t) {
    const stance = rearStance(P, this.legLen);
    const a = rearAngles(P, stance);
    const trunkLat = a.trunkLat;
    this.live = { trunkLat, stance };

    if (stance) {
      const drop = a.drop, valgus = a.valgus;
      if (this.stanceLeg !== stance) {
        this._finalizeStance(t);
        this.stanceLeg = stance;
        this.rear = { drop: -Infinity, valgus: -Infinity, trunkLat: -Infinity, t0: t };
        this._pushCadence(t, stance);
      }
      const r = this.rear;
      r.drop = Math.max(r.drop, drop); r.valgus = Math.max(r.valgus, valgus); r.trunkLat = Math.max(r.trunkLat, trunkLat);
      Object.assign(this.live, { drop, valgus });
    } else if (this.stanceLeg) {
      this._finalizeStance(t);
      this.stanceLeg = null;
    }
  }

  _finalizeStance(t) {
    const r = this.rear, side = this.stanceLeg;
    if (!r || !side) return;
    if (t - r.t0 < 80) return; // flicker, not a stance
    const values = {};
    this._push('pelvicDrop', side, r.drop, values);
    this._push('kneeValgus', side, r.valgus, values);
    this._push('trunkLateral', side, r.trunkLat, values);
    this.lastEvent = { type: 'STANCE', side, t };
    this.events.push({ t: r.t0, type: 'STANCE', side, values });
  }

  // ---------------- metrics ----------------
  _push(id, side, value, bag) {
    if (!Number.isFinite(value)) return;
    const s = (this.samples[id] ??= { L: [], R: [] });
    s[side].push(value);
    if (s[side].length > this.keep) s[side].shift();
    if (bag) bag[id] = value;
  }

  /** Robust (median) value per metric, overall and per side. */
  getMetrics() {
    const out = {};
    for (const [id, s] of Object.entries(this.samples)) {
      const all = [...s.L, ...s.R];
      if (!all.length) continue;
      out[id] = { value: median(all), L: s.L.length ? median(s.L) : null, R: s.R.length ? median(s.R) : null, n: all.length };
    }
    return out;
  }
}
