import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleAt, angleFromVertical, leanFromVertical, footAngle, rotatePoints, signedAngle, median } from '../js/geometry.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

test('angleAt: right angle and straight line', () => {
  close(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), 90);
  close(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }), 180);
});

test('angleFromVertical is positive when the lower point is ahead (in dir)', () => {
  const knee = { x: 0, y: 0 };
  close(angleFromVertical(knee, { x: 10, y: 100 }, 1), Math.atan2(10, 100) * 180 / Math.PI);
  close(angleFromVertical(knee, { x: 10, y: 100 }, -1), -Math.atan2(10, 100) * 180 / Math.PI);
  close(angleFromVertical(knee, { x: 0, y: 100 }, 1), 0);
});

test('leanFromVertical: forward lean positive', () => {
  close(leanFromVertical({ x: 0, y: 100 }, { x: 10, y: 0 }, 1), Math.atan(0.1) * 180 / Math.PI);
  close(leanFromVertical({ x: 0, y: 100 }, { x: 10, y: 0 }, -1), -Math.atan(0.1) * 180 / Math.PI);
});

test('footAngle: toes up positive, flat zero, works for both directions', () => {
  close(footAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, 1), 0);
  close(footAngle({ x: 0, y: 0 }, { x: 10, y: -10 }, 1), 45);
  close(footAngle({ x: 0, y: 0 }, { x: -10, y: -10 }, -1), 45);
});

test('rotatePoints rotates clockwise on screen about the centre', () => {
  const [p] = rotatePoints([{ x: 1, y: 0 }], 0, 0, Math.PI / 2);
  close(p.x, 0, 1e-9); close(p.y, 1, 1e-9); // right → down is clockwise with y pointing down
  assert.deepEqual(rotatePoints([{ x: 3, y: 4 }], 0, 0, 0), [{ x: 3, y: 4 }]);
});

test('signedAngle sign convention', () => {
  close(signedAngle(1, 0, 0, 1), 90);   // right → down: clockwise on screen
  close(signedAngle(1, 0, 0, -1), -90);
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
});
