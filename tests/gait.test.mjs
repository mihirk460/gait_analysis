import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GaitAnalyzer, Smoother } from '../js/gait.js';
import { evaluate } from '../js/standards.js';
import { synthRunner } from './synth.js';

function run(opts, { smooth = false } = {}) {
  const { frames, expected } = synthRunner(opts);
  const an = new GaitAnalyzer({ view: 'side' });
  const sm = new Smoother();
  for (const f of frames) an.update(smooth ? sm.apply(f.P, f.t) : f.P, null, f.t);
  return { an, m: an.getMetrics(), expected };
}

const within = (name, got, want, tol) => {
  assert.ok(got != null && Number.isFinite(got), `${name} missing`);
  assert.ok(Math.abs(got - want) <= tol, `${name}: got ${got.toFixed(1)}, want ${want} ± ${tol}`);
};

for (const dir of [1, -1]) {
  test(`side view metrics match the synthetic runner (facing ${dir > 0 ? 'right' : 'left'})`, () => {
    const { an, m, expected: e } = run({ dir });
    assert.equal(an.dir, dir, 'facing direction');
    within('cadence', m.cadence?.value, e.cadence, 6);
    within('gct', m.gct?.value, e.gct, 45);
    within('kneeIC', m.kneeIC?.value, e.kneeIC, 6);
    within('tibiaIC', m.tibiaIC?.value, e.tibiaIC, 5);
    within('footIC', m.footIC?.value, e.footIC, 8);
    within('kneePeak', m.kneePeak?.value, e.kneePeak, 5);
    within('hipExtTO', m.hipExtTO?.value, e.hipExtTO, 6);
    within('trunkLean', m.trunkLean?.value, e.trunkLean, 2);
    within('elbow', m.elbow?.value, e.elbow, 4);
    assert.ok(m.vertOsc.value > 4 && m.vertOsc.value < 14, `vertOsc ${m.vertOsc.value}`);
    assert.ok(m.kneeIC.L != null && m.kneeIC.R != null, 'both sides sampled');
  });
}

test('metrics survive landmark noise and smoothing', () => {
  const { m, expected: e } = run({ noise: 3, seconds: 10 }, { smooth: true });
  within('cadence', m.cadence?.value, e.cadence, 8);
  within('gct', m.gct?.value, e.gct, 60);
  within('kneeIC', m.kneeIC?.value, e.kneeIC, 8);
  within('tibiaIC', m.tibiaIC?.value, e.tibiaIC, 7); // smoothing lag samples slightly after contact
  within('kneePeak', m.kneePeak?.value, e.kneePeak, 6);
  within('hipExtTO', m.hipExtTO?.value, e.hipExtTO, 7);
});

test('a good runner gets no coaching flags', () => {
  const { m } = run({});
  const rows = evaluate(m, 'side');
  // vertOsc excluded: the stick figure has no ankle plantarflexion, so it bounces ~11 cm by construction
  const flagged = rows.filter((r) => r.severity > 0 && r.id !== 'vertOsc').map((r) => `${r.id}=${r.value.toFixed(1)}`);
  assert.deepEqual(flagged, []);
});

test('an overstriding, low-cadence, upright runner gets the right flags', () => {
  const { m } = run({ cadence: 150, tibiaIC: 18, kneeIC: 6, trunkLean: 1, hipExtTO: 4, elbow: 130 });
  const rows = evaluate(m, 'side');
  const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  assert.equal(status.cadence, 'low');
  assert.equal(status.tibiaIC, 'high');
  assert.equal(status.kneeIC, 'low');
  assert.equal(status.trunkLean, 'low');
  assert.equal(status.hipExtTO, 'low');
  assert.equal(status.elbow, 'high');
  assert.ok(rows[0].severity > 0 && rows[0].cue, 'worst issue has a spoken cue');
});

test('no core landmarks → not tracking, no metrics', () => {
  const an = new GaitAnalyzer();
  const P = new Array(33).fill(null).map(() => ({ x: 0, y: 0, v: 0.1 }));
  an.update(P, null, 0); an.update(P, null, 33);
  assert.equal(an.tracking, false);
  assert.deepEqual(an.getMetrics(), {});
});

test('rear view: pelvic drop and valgus are measured on the stance leg', () => {
  const an = new GaitAnalyzer({ view: 'rear' });
  const mk = () => new Array(33).fill(null).map(() => ({ x: 300, y: 100, v: 1 }));
  let t = 0;
  // Alternate stances: left stance with the right hip dropped 8°, right stance level.
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const stance of ['L', 'R']) {
      for (let i = 0; i < 8; i++) {
        const P = mk();
        const hipW = 100, dropDeg = stance === 'L' ? 8 : 0;
        const dy = Math.tan((dropDeg * Math.PI) / 180) * hipW;
        // rear view: runner's left appears on screen-right
        P[23] = { x: 350, y: 400, v: 1 }; P[24] = { x: 250, y: 400 + (stance === 'L' ? dy : -dy), v: 1 };
        P[11] = { x: 350, y: 150, v: 1 }; P[12] = { x: 250, y: 150, v: 1 };
        const st = stance === 'L' ? { hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 } : { hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 };
        const sw = stance === 'L' ? { hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 } : { hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
        const hx = P[st.hip].x;
        P[st.knee] = { x: hx, y: 600, v: 1 }; P[st.ankle] = { x: hx, y: 800, v: 1 };
        P[st.heel] = { x: hx, y: 820, v: 1 }; P[st.toe] = { x: hx, y: 830, v: 1 };
        const sx = P[sw.hip].x;
        P[sw.knee] = { x: sx, y: 550, v: 1 }; P[sw.ankle] = { x: sx, y: 650, v: 1 };
        P[sw.heel] = { x: sx, y: 660, v: 1 }; P[sw.toe] = { x: sx, y: 670, v: 1 };
        an.update(P, null, t); t += 33;
      }
    }
  }
  const m = an.getMetrics();
  assert.ok(Math.abs(m.pelvicDrop.L - 8) < 0.5, `left-stance drop ${m.pelvicDrop.L}`);
  assert.ok(Math.abs(m.pelvicDrop.R - 0) < 0.5, `right-stance drop ${m.pelvicDrop.R}`);
  assert.ok(Math.abs(m.kneeValgus.value) < 0.5, 'straight leg has no valgus');
  assert.ok(m.cadence, 'cadence from stance starts');
});

test('history mode logs every stride event with the values measured at that instant', () => {
  const { frames } = synthRunner({ seconds: 6 });
  const an = new GaitAnalyzer({ view: 'side', history: true });
  for (const f of frames) an.update(f.P, null, f.t);

  const ic = an.events.filter((e) => e.type === 'IC');
  const to = an.events.filter((e) => e.type === 'TO');
  assert.ok(ic.length >= 12, `expected ~18 contacts, got ${ic.length}`);
  assert.ok(Math.abs(ic.length - to.length) <= 2, 'contacts and toe-offs should pair up');

  // events are in order, alternate sides, and sit inside the clip
  for (let i = 1; i < ic.length; i++) assert.ok(ic[i].t > ic[i - 1].t, 'events ordered in time');
  for (let i = 1; i < ic.length; i++) assert.notEqual(ic[i].side, ic[i - 1].side, 'sides alternate');
  assert.ok(an.events.every((e) => e.t >= 0 && e.t <= 6000), 'events within the clip');

  const e = ic[ic.length - 1];
  assert.ok(Math.abs(e.values.kneeIC - 15) < 8, `kneeIC on the event ${e.values.kneeIC}`);
  assert.ok(Math.abs(e.values.tibiaIC - 5) < 8, `tibiaIC on the event ${e.values.tibiaIC}`);
  assert.ok(to[to.length - 1].values.gct > 150, 'toe-off carries ground contact time');

  // history keeps every stride, not just the rolling window of six
  assert.ok(an.getMetrics().kneeIC.n > 12, 'all strides retained');
});

test('without history the analyzer keeps its rolling window and still logs events', () => {
  const { frames } = synthRunner({ seconds: 8 });
  const an = new GaitAnalyzer({ view: 'side' });
  for (const f of frames) an.update(f.P, null, f.t);
  assert.equal(an.getMetrics().kneeIC.n, 12, 'six samples per side');
  assert.ok(an.events.length > 12, 'event log is still populated');
});
