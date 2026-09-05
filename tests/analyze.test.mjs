import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LandmarkTrack } from '../js/track.js';
import { analyzeTrack, frameScale, medianScale, REVIEW_ALPHA } from '../js/analyze.js';
import { GaitAnalyzer, Smoother } from '../js/gait.js';
import { synthRunner } from './synth.js';

const SPACE = 900; // synthetic coordinates fit inside 900 x 900, so x and y scale identically

function trackFrom(frames, { roll = 0, drop = () => false } = {}) {
  const tr = new LandmarkTrack();
  for (const f of frames) {
    tr.push(f.t, drop(f) ? null : f.P.map((p) => ({ x: p.x / SPACE, y: p.y / SPACE, visibility: p.v ?? 1 })), roll);
  }
  return tr;
}

const opts = { view: 'side', width: SPACE, height: SPACE };
const near = (name, got, want, tol) => {
  assert.ok(got != null && Number.isFinite(got), `${name} missing`);
  assert.ok(Math.abs(got - want) <= tol, `${name}: got ${got.toFixed(1)}, want ${want} ± ${tol}`);
};

test('analyzeTrack recovers the synthetic runner from a recorded track', () => {
  const { frames, expected: e } = synthRunner({ seconds: 12, fps: 30, noise: 3 });
  const { metrics: m, events, dir } = analyzeTrack(trackFrom(frames), opts);
  assert.equal(dir, 1);
  near('cadence', m.cadence?.value, e.cadence, 5);
  near('gct', m.gct?.value, e.gct, 40);
  near('kneeIC', m.kneeIC?.value, e.kneeIC, 5);
  near('tibiaIC', m.tibiaIC?.value, e.tibiaIC, 5);
  near('kneePeak', m.kneePeak?.value, e.kneePeak, 5);
  near('hipExtTO', m.hipExtTO?.value, e.hipExtTO, 5);
  near('trunkLean', m.trunkLean?.value, e.trunkLean, 2);
  assert.ok(events.filter((ev) => ev.type === 'IC').length >= 25, 'a contact per step');
});

test('the offline pass is more accurate than the live smoothed pass', () => {
  const { frames, expected: e } = synthRunner({ seconds: 12, fps: 30, noise: 3 });
  const live = new GaitAnalyzer({ view: 'side', history: true });
  const sm = new Smoother(); // the alpha the live overlay uses
  for (const f of frames) live.update(sm.apply(f.P, f.t), null, f.t);

  const offline = analyzeTrack(trackFrom(frames), opts).metrics;
  const errOf = (m) => ['kneeIC', 'tibiaIC', 'kneePeak', 'hipExtTO']
    .reduce((s, k) => s + Math.abs(m[k].value - e[k]), 0);
  assert.ok(errOf(offline) < errOf(live.getMetrics()), 'offline re-analysis should reduce total angle error');
});

// Rolling the phone clockwise by `roll` makes the scene appear to rotate counter-clockwise by the
// same amount, so that is how a tilted capture is simulated here.
function tiltFrames(frames, roll) {
  const th = (-roll * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th), C = SPACE / 2;
  return frames.map((f) => ({
    t: f.t,
    P: f.P.map((p) => ({ x: C + (p.x - C) * c - (p.y - C) * s, y: C + (p.x - C) * s + (p.y - C) * c, v: p.v })),
  }));
}

for (const roll of [8, -8]) {
  test(`camera roll of ${roll}° recorded per frame is undone before angles are measured`, () => {
    const { frames, expected: e } = synthRunner({ seconds: 10, fps: 30 });
    const m = analyzeTrack(trackFrom(tiltFrames(frames, roll), { roll }), opts).metrics;
    near('trunkLean', m.trunkLean?.value, e.trunkLean, 2.5);
    near('tibiaIC', m.tibiaIC?.value, e.tibiaIC, 5);
  });
}

test('an uncorrected roll does bias the angles, so the correction is doing real work', () => {
  const { frames, expected: e } = synthRunner({ seconds: 10, fps: 30 });
  const m = analyzeTrack(trackFrom(tiltFrames(frames, 8), { roll: 0 }), opts).metrics;
  assert.ok(Math.abs(m.trunkLean.value - e.trunkLean) > 5, 'ignoring the roll should skew trunk lean');
});

test('frames with no detection are skipped without corrupting the analysis', () => {
  const { frames, expected: e } = synthRunner({ seconds: 12, fps: 30 });
  // Blank out a one-second stretch, as if the runner left the frame.
  const tr = trackFrom(frames, { drop: (f) => f.t > 4000 && f.t < 5000 });
  const { metrics: m } = analyzeTrack(tr, opts);
  near('cadence survives a gap', m.cadence?.value, e.cadence, 8);
  near('kneeIC survives a gap', m.kneeIC?.value, e.kneeIC, 6);
});

test('an empty or undetected track yields no metrics rather than throwing', () => {
  assert.deepEqual(analyzeTrack(new LandmarkTrack(), opts).metrics, {});
  const blank = new LandmarkTrack();
  for (let i = 0; i < 30; i++) blank.push(i * 33, null, 0);
  assert.deepEqual(analyzeTrack(blank, opts).metrics, {});
});

test('frameScale converts world landmarks to metres per pixel, rejecting implausible ones', () => {
  const world = new Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  world[23] = { x: 0, y: 0, z: 0 }; world[25] = { x: 0, y: 0.42, z: 0 }; world[27] = { x: 0, y: 0.84, z: 0 };
  world[24] = { x: 0, y: 0, z: 0 }; world[26] = { x: 0, y: 0.42, z: 0 }; world[28] = { x: 0, y: 0.84, z: 0 };
  assert.ok(Math.abs(frameScale(world, 300) - 0.84 / 300) < 1e-9);
  assert.equal(frameScale(world, 0), null);
  assert.equal(frameScale(null, 300), null);
  const tiny = world.map((p) => ({ ...p, y: p.y * 0.1 }));
  assert.equal(frameScale(tiny, 300), null, 'a 0.08 m leg is not a person');
});

test('medianScale ignores an empty sample set', () => {
  assert.equal(medianScale([]), null);
  assert.equal(medianScale([2, 1, 3]), 2);
  assert.ok(REVIEW_ALPHA > 0.9, 'review pass barely smooths');
});

test('the track is normalised, so the analysis must rebuild pixels at the capture aspect ratio', () => {
  const { frames, expected: e } = synthRunner({ seconds: 10, fps: 30 });
  // A 16:9 capture: x and y are normalised by different amounts, exactly as a real camera does.
  const W = 1600, H = 900;
  const wide = new LandmarkTrack();
  for (const f of frames) wide.push(f.t, f.P.map((p) => ({ x: p.x / W, y: p.y / H, visibility: p.v ?? 1 })), 0);

  const right = analyzeTrack(wide, { view: 'side', width: W, height: H }).metrics;
  near('trunkLean at the true aspect ratio', right.trunkLean?.value, e.trunkLean, 2);

  // Rebuilding at the wrong aspect ratio stretches one axis and skews the angles.
  const wrong = analyzeTrack(wide, { view: 'side', width: H, height: H }).metrics;
  assert.ok(Math.abs(wrong.trunkLean.value - e.trunkLean) > 2, 'a mismatched aspect ratio should skew trunk lean');
});
