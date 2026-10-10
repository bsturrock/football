import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steerStep, ACCEL_TAU } from '../src/dots/steering.js';
import { createPlay } from '../src/dots/play.js';

const R = 0.5;
const goal = { x: 0, y: 100, key: 'g', ignore: null };

test('steerStep ramps from rest along the exponential curve', () => {
  const p = { id: 'A', x: 0, y: 0, speed: 8, v: 0, steer: null };
  const dt = 1 / 60;
  const at = {};
  for (let i = 1; i <= Math.round(2.5 / dt); i++) {
    const y0 = p.y;
    steerStep(p, goal, [p], p.speed * dt, dt, R);
    p.v = (p.y - y0) / dt;
    const t = i * dt;
    for (const mark of [0.5, 1.5]) if (Math.abs(t - mark) < dt / 2) at[mark] = p.y;
  }
  for (const t of [0.5, 1.5]) {
    const want = p.speed * (t - ACCEL_TAU * (1 - Math.exp(-t / ACCEL_TAU)));
    assert.ok(Math.abs(at[t] - want) <= 0.05 * want, `t=${t}: ${at[t]} vs ${want}`);
  }
  assert.ok(p.v >= 0.95 * p.speed);
});

test('without v the step is unchanged', () => {
  const p = { id: 'A', x: 0, y: 0, speed: 8, steer: null };
  const dt = 1 / 60;
  steerStep(p, goal, [p], p.speed * dt, dt, R);
  assert.ok(Math.abs(p.y - p.speed * dt) < 1e-9);
});

test('ramp never exceeds the caller cap', () => {
  const p = { id: 'A', x: 0, y: 0, speed: 8, v: 8, steer: null };
  const dt = 1 / 60;
  const cap = p.speed * dt * 0.5;
  steerStep(p, goal, [p], cap, dt, R);
  assert.ok(Math.abs(p.y - cap) < 1e-9);
});

test('play level accel', () => {
  const play = createPlay(25, 'insideZone', { accel: true });
  assert.ok(play.snap());
  for (const p of play.players) assert.equal(p.v, 0);
  const rb = play.player(play.run.carrier);
  const sx = rb.x, sy = rb.y;
  play.step(0.1);
  for (const p of play.players) {
    assert.ok(Number.isFinite(p.v) && p.v >= 0 && p.v <= p.speed + 1e-9, `${p.id} v=${p.v}`);
  }
  play.step(0.2);
  assert.ok(Math.hypot(rb.x - sx, rb.y - sy) < 0.3 * rb.speed * 0.75);

  const plain = createPlay(25, 'insideZone', { accel: false });
  plain.snap();
  plain.step(0.1);
  for (const p of plain.players) assert.equal(p.v, undefined);
});

test('F-25 #1: accel is the createPlay default', () => {
  const play = createPlay(25, 'insideZone');
  assert.ok(play.snap());
  for (const p of play.players) assert.equal(p.v, 0);
  play.step(0.1);
  for (const p of play.players) {
    assert.ok(Number.isFinite(p.v) && p.v >= 0 && p.v <= p.speed + 1e-9, `${p.id} v=${p.v}`);
  }
});
