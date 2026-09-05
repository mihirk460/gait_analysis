import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTilt } from '../js/level.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);
const g = 9.81;

test('upright portrait phone is level (iOS sign convention)', () => {
  const { roll, pitch } = computeTilt(0, -g, 0, 0, 1);
  close(roll, 0); close(pitch, 0);
});

test('clockwise roll of 10° reads +10 in both platform sign conventions', () => {
  const a = 10 * Math.PI / 180;
  // iOS: reported vector points along gravity (down). Device x tips down when rolled clockwise.
  close(computeTilt(g * Math.sin(a), -g * Math.cos(a), 0, 0, 1).roll, 10, 1e-6);
  // Spec/Android: vector points up, i.e. negated.
  close(computeTilt(-g * Math.sin(a), g * Math.cos(a), 0, 0, -1).roll, 10, 1e-6);
});

test('camera pitched up reads positive pitch', () => {
  const a = 15 * Math.PI / 180;
  // screen faces partly down → gravity has +z component (iOS convention)
  close(computeTilt(0, -g * Math.cos(a), g * Math.sin(a), 0, 1).pitch, 15, 1e-6);
});

test('landscape (screen rotated 90°) maps device x/y into the screen frame', () => {
  // Device rotated counter-clockwise by 90°: gravity now along device -x. Should read level.
  const { roll } = computeTilt(-g, 0, 0, 90, 1);
  close(roll, 0, 1e-6);
});
