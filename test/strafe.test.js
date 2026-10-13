import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steerStep, strafeFrac, SHUFFLE_FRAC, BACKPEDAL_FRAC, PACES } from '../src/dots/steering.js';
import { stepBlocking, BODY_RADIUS } from '../src/dots/blocking.js';

const DT = 1 / 60;
const EPS = 1e-9;

test('strafeFrac: forward, sideways, back with default ratings', () => {
  const p = { facing: 0 };
  assert.equal(strafeFrac(p, 0, 3), 1);
  assert.ok(Math.abs(strafeFrac(p, 2, 0) - SHUFFLE_FRAC) < EPS);
  assert.ok(Math.abs(strafeFrac(p, -2, 0) - SHUFFLE_FRAC) < EPS);
  assert.ok(Math.abs(strafeFrac(p, 0, -1) - BACKPEDAL_FRAC) < EPS);
});

test('strafeFrac: own ratings and monotonic between', () => {
  const p = { facing: 0, shuffle: 0.8, pedal: 0.6 };
  assert.ok(Math.abs(strafeFrac(p, 1, 0) - 0.8) < EPS);
  assert.ok(Math.abs(strafeFrac(p, 0, -1) - 0.6) < EPS);
  let prev = 1;
  for (let a = 0; a <= 90; a += 10) {
    const r = a * Math.PI / 180;
    const f = strafeFrac(p, Math.sin(r), Math.cos(r));
    assert.ok(f <= prev + EPS);
    prev = f;
  }
  prev = 0.8;
  for (let a = 90; a <= 180; a += 10) {
    const r = a * Math.PI / 180;
    const f = strafeFrac(p, Math.sin(r), Math.cos(r));
    assert.ok(f <= prev + EPS);
    prev = f;
  }
});

test('strafeFrac: non-finite facing gives 1', () => {
  assert.equal(strafeFrac({ facing: NaN }, 1, 0), 1);
  assert.equal(strafeFrac({}, 1, 0), 1);
});

const mover = () => ({ id: 'A', team: 'offense', x: 0, y: 0, speed: 6, facing: 0 });
const face = { x: 0, y: 10, w: 1 };
const dist = (p) => Math.hypot(p.x, p.y);

test('steerStep: sideways goal with face is capped and records faceAt', () => {
  const p = mover();
  steerStep(p, { x: 5, y: 0, key: 'g', face }, [p], 6 * DT, DT, BODY_RADIUS);
  assert.ok(dist(p) <= 6 * SHUFFLE_FRAC * DT + 1e-9);
  assert.ok(dist(p) > 0);
  assert.deepEqual(p.faceAt, face);
});

test('steerStep: same goal without face steps full and leaves no faceAt', () => {
  const p = mover();
  steerStep(p, { x: 5, y: 0, key: 'g' }, [p], 6 * DT, DT, BODY_RADIUS);
  assert.ok(Math.abs(dist(p) - 6 * DT) < 1e-9);
  assert.equal('faceAt' in p, false);
});

test('steerStep: goal without face clears a stale faceAt', () => {
  const p = mover();
  p.faceAt = { x: 1, y: 1, w: 1 };
  steerStep(p, { x: 5, y: 0, key: 'g' }, [p], 6 * DT, DT, BODY_RADIUS);
  assert.equal('faceAt' in p, false);
});

test('steerStep: straight back with face steps at BACKPEDAL_FRAC', () => {
  const p = mover();
  steerStep(p, { x: 0, y: -5, key: 'g', face }, [p], 6 * DT, DT, BODY_RADIUS);
  assert.ok(Math.abs(dist(p) - 6 * BACKPEDAL_FRAC * DT) < 1e-9);
});

test('steerStep: strafe is a cap, not a multiplier', () => {
  const a = mover(); a.shuffle = 0.75;
  const b = mover(); b.shuffle = 0.75;
  steerStep(a, { x: 5, y: 0, key: 'g', pace: PACES.press, face }, [a], 6 * DT, DT, BODY_RADIUS);
  steerStep(b, { x: 5, y: 0, key: 'g', pace: PACES.press }, [b], 6 * DT, DT, BODY_RADIUS);
  assert.ok(Math.abs(dist(a) - dist(b)) < 1e-12);
  assert.ok(Math.abs(dist(a) - 3 * DT) < 1e-9);
});

function freeTick(row) {
  const D = { id: 'D', team: 'defense', role: 'LB', x: 0, y: 30, speed: 6, shuffle: 0.75, facing: Math.PI, block: null };
  const C = { id: 'C', team: 'offense', role: 'RB', x: 0, y: 10, speed: 6, block: null };
  stepBlocking([D, C], { x: 0, y: 10 }, DT, { seq: 0, defGoals: { D: row } });
  return D;
}

test('stepBlocking: free defender strafes toward a side goal and records faceAt', () => {
  const D = freeTick({ x: 10, y: 30, key: 'k', rate: 6, face });
  const moved = Math.hypot(D.x, D.y - 30);
  assert.ok(moved > 0);
  assert.ok(moved <= 6 * 0.75 * DT + 1e-9);
  assert.deepEqual(D.faceAt, face);
});

test('stepBlocking: same row without face moves as before, no faceAt', () => {
  const D = freeTick({ x: 10, y: 30, key: 'k', rate: 6 });
  const moved = Math.hypot(D.x, D.y - 30);
  const capped = freeTick({ x: 10, y: 30, key: 'k', rate: 6, face });
  assert.ok(moved > 0 && moved >= Math.hypot(capped.x, capped.y - 30) - 1e-12);
  assert.equal('faceAt' in D, false);
});
