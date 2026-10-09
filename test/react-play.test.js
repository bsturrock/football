import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactSpot, resolveBlock, stepBlocking } from '../src/dots/blocking.js';
import { startFoot } from '../src/dots/technique.js';

const DT = 1 / 60;

function fixture(ball) {
  const D = { id: 'D', team: 'defense', role: 'DT', x: 0, y: 25.7, speed: 6.5, strength: 0.6, block: null };
  const A = { id: 'A', team: 'offense', role: 'OL', x: -1, y: 24, speed: 6, strength: 1 };
  const B = { id: 'B', team: 'offense', role: 'OL', x: 1, y: 24, speed: 6, strength: 1 };
  A.block = { target: 'D', angle: 'straight', engaged: true, seq: 1 };
  B.block = { target: 'D', angle: 'straight', engaged: true, seq: 2 };
  const players = [D, A, B];
  for (const b of [A, B]) {
    const s = contactSpot(players, b);
    b.x = s.x;
    b.y = s.y;
    b.block.foot = startFoot('zone', 'head', null, b, D);
  }
  return { players, D, A, B, ball };
}

function run(ball, secs, onStep) {
  const f = fixture(ball);
  const ctx = { seq: 2 };
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    stepBlocking(f.players, ball, DT, ctx);
    onStep?.(f, (i + 1) * DT);
  }
  return f;
}

test('double-teamed defender anchors, shifts toward the ball, ride pushes him that way', () => {
  let drivenBefore = false;
  let anchoredAt = null;
  const f = run({ x: -3, y: 21 }, 1.0, (g, t) => {
    const s = g.D.react?.state;
    if (s === 'driven' && anchoredAt === null) drivenBefore = true;
    if (s === 'anchored' && anchoredAt === null) anchoredAt = t;
  });
  assert.ok(drivenBefore, 'driven before anchored');
  assert.ok(anchoredAt !== null && anchoredAt <= 0.5 + 1e-9, `anchored at ${anchoredAt}`);
  assert.equal(f.D.react.side, -1);
  assert.equal(f.A.block.foot.ride, -1);
  assert.equal(f.B.block.foot.ride, -1);
  assert.ok(f.D.x <= -0.2, `D.x ${f.D.x}`);
});

test('control: ball straight ahead keeps the defender centred', () => {
  const f = run({ x: 0, y: 21 }, 1.0);
  assert.ok(Math.abs(f.D.x) < 0.05, `D.x ${f.D.x}`);
});

test('free defender has null react', () => {
  const D = { id: 'D', team: 'defense', role: 'DT', x: 0, y: 25.7, speed: 6.5, strength: 0.6, block: null, react: { state: 'driven' } };
  stepBlocking([D], { x: -3, y: 21 }, DT, { seq: 0 });
  assert.equal(D.react, null);
});

test('resolveBlock follows react.dir', () => {
  const d = { x: 0, y: 10, strength: 0.6, react: { dir: { x: -1, y: 0 } } };
  const v = resolveBlock(d, [], { x: 0, y: 0 });
  assert.ok(v.vx < 0);
  assert.ok(Math.abs(v.vy) < 1e-9);
});
