// Synthetic treadmill runner: forward kinematics from thigh angle φ (from vertical, forward +)
// and knee flexion κ, with the hip height solved so the stance foot stays on the belt.
import { rad } from '../js/geometry.js';

const lerp = (a, b, s) => a + (b - a) * s;
const smooth = (s) => s * s * (3 - 2 * s);

export function synthRunner({
  dir = 1, fps = 30, cadence = 180, stanceFrac = 0.35, kneeIC = 15, tibiaIC = 5, kneePeak = 45,
  hipExtTO = 15, trunkLean = 8, elbow = 90, seconds = 8, thigh = 150, shank = 150, groundY = 700, hipX = 400,
  noise = 0,
} = {}) {
  const T = (2 * 60) / cadence; // gait cycle (s), one step per leg
  const phiIC = tibiaIC + kneeIC;
  const phiTO = -(hipExtTO + trunkLean); // hip extension is measured relative to the trunk
  const kappaTO = 15;

  function legPose(u) {
    let phi, kappa, foot;
    if (u < stanceFrac) {
      const s = u / stanceFrac;
      phi = lerp(phiIC, phiTO, s); // constant thigh angular velocity through stance
      kappa = s < 0.45 ? lerp(kneeIC, kneePeak, smooth(s / 0.45)) : lerp(kneePeak, kappaTO, smooth((s - 0.45) / 0.55));
      foot = 0;
    } else {
      const s = (u - stanceFrac) / (1 - stanceFrac);
      phi = lerp(phiTO, phiIC, smooth(s)) + 6 * Math.sin(Math.PI * s) ** 2;
      const base = lerp(kappaTO, kneeIC, s);
      kappa = base + (95 - base) * Math.sin(Math.PI * s ** 0.8) ** 2; // knee flexes fast after toe-off, extends in terminal swing
      foot = s < 0.7 ? -15 * Math.sin((Math.PI * s) / 0.7) : 0; // toes down early in swing, flat before landing
    }
    const kx = thigh * Math.sin(rad(phi)) * dir, ky = thigh * Math.cos(rad(phi));
    const sa = phi - kappa;
    const ax = kx + shank * Math.sin(rad(sa)) * dir, ay = ky + shank * Math.cos(rad(sa));
    // foot: sole 20 px below the ankle, heel 20 px behind, toe 55 px ahead, rotated by the foot angle
    const rot = (x, y, a) => ({ x: x * Math.cos(a) + y * Math.sin(a), y: -x * Math.sin(a) + y * Math.cos(a) });
    const h = rot(-20, 20, rad(foot)), tt = rot(55, 20, rad(foot));
    return {
      knee: { x: kx, y: ky }, ankle: { x: ax, y: ay },
      heel: { x: ax + h.x * dir, y: ay + h.y }, toe: { x: ax + tt.x * dir, y: ay + tt.y },
      stance: u < stanceFrac,
    };
  }

  const n = Math.round(seconds * fps);
  const frames = [];
  const hipYs = new Array(n).fill(null);
  const poses = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / fps; // events fall between frames, as in real footage
    const uL = (t / T) % 1, uR = (t / T + 0.5) % 1;
    const L = legPose(uL), R = legPose(uR);
    poses.push({ t, L, R });
    // hip height from whichever leg is on the belt (sole at groundY)
    const st = L.stance ? L : R.stance ? R : null;
    if (st) hipYs[i] = groundY - Math.max(st.heel.y, st.toe.y);
  }
  // flight phases: parabolic hip trajectory between toe-off and the next contact
  const flightRise = 0.02 * (thigh + shank);
  for (let i = 0; i < n; i++) {
    if (hipYs[i] != null) continue;
    let a = i - 1; while (a >= 0 && hipYs[a] == null) a--;
    let b = i + 1; while (b < n && hipYs[b] == null) b++;
    if (a < 0) hipYs[i] = hipYs[b]; else if (b >= n) hipYs[i] = hipYs[a];
    else { const tau = (i - a) / (b - a); hipYs[i] = lerp(hipYs[a], hipYs[b], tau) + flightRise * 4 * tau * (1 - tau); }
    // never let a swinging sole pass below the belt
    const { L, R } = poses[i];
    const lowest = Math.max(L.heel.y, L.toe.y, R.heel.y, R.toe.y);
    hipYs[i] = Math.min(hipYs[i], groundY - lowest);
  }

  for (let i = 0; i < n; i++) {
    const { t, L, R } = poses[i];
    const hip = { x: hipX, y: hipYs[i] };
    const sh = { x: hip.x + 250 * Math.sin(rad(trunkLean)) * dir, y: hip.y - 250 * Math.cos(rad(trunkLean)) };
    const P = new Array(33).fill(null).map(() => ({ x: sh.x, y: sh.y - 60, v: 1 }));
    const put = (i, p) => { P[i] = { x: p.x, y: p.y, v: 1 }; };
    put(11, sh); put(12, sh); put(23, hip); put(24, hip);
    const place = (idx, leg) => {
      put(idx.knee, { x: hip.x + leg.knee.x, y: hip.y + leg.knee.y });
      put(idx.ankle, { x: hip.x + leg.ankle.x, y: hip.y + leg.ankle.y });
      put(idx.heel, { x: hip.x + leg.heel.x, y: hip.y + leg.heel.y });
      put(idx.toe, { x: hip.x + leg.toe.x, y: hip.y + leg.toe.y });
    };
    place({ knee: 25, ankle: 27, heel: 29, toe: 31 }, L);
    place({ knee: 26, ankle: 28, heel: 30, toe: 32 }, R);
    // arms: upper arm swings ±20° about vertical, elbow fixed
    for (const [s, e, w, ph] of [[11, 13, 15, 0], [12, 14, 16, Math.PI]]) {
      const a = 20 * Math.sin((2 * Math.PI * t) / T + ph);
      const el = { x: sh.x + 120 * Math.sin(rad(a)) * dir, y: sh.y + 120 * Math.cos(rad(a)) };
      const fa = a + (180 - elbow); // forearm direction relative to vertical
      const wr = { x: el.x + 110 * Math.sin(rad(fa)) * dir, y: el.y + 110 * Math.cos(rad(fa)) };
      put(e, el); put(w, wr);
    }
    if (noise) for (const p of P) { p.x += (Math.random() - 0.5) * 2 * noise; p.y += (Math.random() - 0.5) * 2 * noise; }
    frames.push({ t: (i / fps) * 1000, P });
  }
  return { frames, T, expected: { cadence, gct: stanceFrac * T * 1000, kneeIC, tibiaIC, kneePeak, hipExtTO, trunkLean, elbow, footIC: 0 } };
}
