import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepBlocking } from '../src/dots/blocking.js';
import { BURST_TAU, ACCEL_TAU } from '../src/dots/steering.js';

const DT = 1 / 60;
const RATE = 7.5;
// Starts already moving at 5 yd/s: from rest the planted-cut cap (CUT_ACCEL) would bind before the ramp.
const V0 = 5;

// One free defender, 30 yards downfield of the line, pursuing a goal 10 yards further downfield.
// The ball is far away with no holder, so the ball guard does not bind.
function oneTick(defender, goal) {
  const players = [{ id: 'D', team: 'defense', x: 0, y: 30, speed: RATE, v: V0, vel: { x: 0, y: V0 }, ...defender }];
  const ctx = { seq: 1, rule: null, defGoals: { D: { x: 0, y: 40, key: 'def:pursue', rate: RATE, ...goal } } };
  stepBlocking(players, { x: 0, y: 0 }, DT, ctx);
  return Math.hypot(players[0].x - 0, players[0].y - 30);
}

// Step length of the ramp from V0 toward top speed RATE with time constant tau.
const ramp = (tau) => (V0 + (RATE - V0) * (1 - Math.exp(-DT / tau))) * DT;
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} !~ ${b}`);

test('pace burst ramps with BURST_TAU', () => {
  near(oneTick({}, { pace: 'burst' }), ramp(BURST_TAU));
});

test('no pace ramps with ACCEL_TAU', () => {
  near(oneTick({}, {}), ramp(ACCEL_TAU));
});

test('unknown pace name behaves like no pace', () => {
  near(oneTick({}, { pace: 'nope' }), ramp(ACCEL_TAU));
});

test('burst rating on the defender sets the burst time constant', () => {
  near(oneTick({ burst: 0.5 }, { pace: 'burst' }), ramp(0.5));
});
