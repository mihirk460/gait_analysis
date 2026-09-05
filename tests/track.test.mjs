import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LandmarkTrack, nearestIndex, nearestEvent, surroundingEvents, phasesAt, strideAt, POINTS } from '../js/track.js';

const lm = (x, y, v = 1) => new Array(POINTS).fill(null).map(() => ({ x, y, visibility: v }));

test('nearestIndex picks the closest timestamp and clamps at the ends', () => {
  const ts = [0, 100, 200, 300];
  assert.equal(nearestIndex(ts, -50), 0);
  assert.equal(nearestIndex(ts, 0), 0);
  assert.equal(nearestIndex(ts, 140), 1);
  assert.equal(nearestIndex(ts, 160), 2);
  assert.equal(nearestIndex(ts, 150), 1); // ties go to the earlier frame
  assert.equal(nearestIndex(ts, 9999), 3);
  assert.equal(nearestIndex([], 5), -1);
});

test('track stores normalised landmarks and returns them in canvas pixels', () => {
  const tr = new LandmarkTrack();
  tr.push(0, lm(0.5, 0.25), 3);
  tr.push(33, lm(0.1, 0.9), -1);
  assert.equal(tr.length, 2);
  const p = tr.pointsAt(0, 1000, 400);
  assert.equal(p[0].x, 500);
  assert.ok(Math.abs(p[0].y - 100) < 1e-3);
  assert.ok(Math.abs(tr.pointsAt(33, 100, 100)[5].x - 10) < 1e-3);
  assert.equal(tr.rollAt(33), -1);
  assert.equal(tr.duration, 33);
  assert.ok(tr.bytes > 0);
});

test('a frame with no detection reads back as null, not as a skeleton at the origin', () => {
  const tr = new LandmarkTrack();
  tr.push(0, null, 0);
  assert.equal(tr.pointsAt(0, 640, 480), null);
});

test('rescale stretches the timeline and ignores nonsense factors', () => {
  const tr = new LandmarkTrack();
  tr.push(0, lm(0.5, 0.5)); tr.push(100, lm(0.5, 0.5)); tr.push(200, lm(0.5, 0.5));
  tr.rescale(1.1);
  assert.deepEqual(tr.ts.map((t) => Math.round(t)), [0, 110, 220]);
  const before = [...tr.ts];
  tr.rescale(0); tr.rescale(NaN); tr.rescale(1);
  assert.deepEqual(tr.ts, before);
});

const EVENTS = [
  { t: 100, type: 'IC', side: 'L', values: {} },
  { t: 300, type: 'TO', side: 'L', values: {} },
  { t: 400, type: 'IC', side: 'R', values: {} },
  { t: 600, type: 'TO', side: 'R', values: {} },
  { t: 700, type: 'IC', side: 'L', values: {} },
];

test('nearestEvent honours the time window', () => {
  assert.equal(nearestEvent(EVENTS, 110, 120).t, 100);
  assert.equal(nearestEvent(EVENTS, 250, 120).t, 300); // 300 is the closer of the two neighbours
  assert.equal(nearestEvent(EVENTS, 200, 50), null);   // both neighbours are 100 ms away
  assert.equal(nearestEvent(EVENTS, 250, 200).t, 300);
  assert.equal(nearestEvent([], 0), null);
});

test('surroundingEvents brackets the playhead', () => {
  const { prev, next } = surroundingEvents(EVENTS, 350);
  assert.equal(prev.t, 300);
  assert.equal(next.t, 400);
  assert.equal(surroundingEvents(EVENTS, 0).prev, null);
  assert.equal(surroundingEvents(EVENTS, 9999).next, null);
});

test('phasesAt tracks stance and swing per leg', () => {
  assert.deepEqual(phasesAt(EVENTS, 50), { L: null, R: null });
  assert.deepEqual(phasesAt(EVENTS, 200), { L: 'stance', R: null });
  assert.deepEqual(phasesAt(EVENTS, 500), { L: 'swing', R: 'stance' });
  assert.deepEqual(phasesAt(EVENTS, 800), { L: 'stance', R: 'swing' });
});

test('strideAt returns the contact-to-contact interval containing the playhead', () => {
  assert.deepEqual(strideAt(EVENTS, 150), [100, 400]);
  assert.deepEqual(strideAt(EVENTS, 400), [400, 700]);
  assert.equal(strideAt(EVENTS, 50), null);
  assert.equal(strideAt(EVENTS, 900), null);
});
