import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/dots/steering.js';

const { steerStep } = S;
const DT = 1 / 60, RAD = 0.6;

function call(p, goal, bodies, key = 'k') {
  const D = Math.hypot(goal.x - p.x, goal.y - p.y);
  const g = { x: goal.x, y: goal.y, key, ignore: null };
  steerStep(p, g, [p, ...bodies], Math.min(6 * DT, D), DT, RAD);
}

function pushOut(p, bodies) {
  for (const b of bodies) {
    const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
    if (d < 1.2 && d > 0) { p.x = b.x + dx / d * 1.2; p.y = b.y + dy / d * 1.2; }
  }
}

function run(goal, bodies, n) {
  const p = { id: 'p', x: 0, y: 0 };
  const sides = [], flips = [], pos = [];
  for (let i = 0; i < n; i++) {
    call(p, goal, bodies);
    pushOut(p, bodies);
    sides.push(p.steer ? p.steer.side : 0);
    flips.push(p.steer ? p.steer.flips : 0);
    pos.push([p.x, p.y]);
  }
  return { p, sides, flips, pos };
}

const reached = (p, g) => Math.hypot(p.x - g.x, p.y - g.y) < 1e-6;

test('tunables', () => {
  assert.equal(S.AVOID_CLEARANCE, 0.3);
  assert.equal(S.LOOKAHEAD, 4.0);
  assert.equal(S.RELEASE_MARGIN, 0.3);
  assert.equal(S.STUCK_TIME, 0.3);
  assert.equal(S.STUCK_PROGRESS, 0.25);
  assert.equal(S.MAX_FLIPS, 1);
});

test('free movement', () => {
  for (const bodies of [[], [{ id: 'b', x: 20, y: 3 }]]) {
    const p = { id: 'p', x: 0, y: 0 };
    call(p, { x: 0, y: 6 }, bodies);
    assert.ok(Math.abs(p.y - 6 * DT) < 1e-12 && Math.abs(p.x) < 1e-12);
    assert.ok(!p.steer);
  }
});

test('passes obstacle on committed side', () => {
  const body = { id: 'b', x: 0, y: 3 };
  const p = { id: 'p', x: 0, y: 0 };
  const g = { x: 0, y: 6 };
  let first = 0, n = 0, minD = Infinity;
  while (n < 90 && !reached(p, g)) {
    call(p, g, [body]); n++;
    const s = p.steer ? p.steer.side : 0;
    if (!first && s) first = s;
    assert.notEqual(s, -1);
    minD = Math.min(minD, Math.hypot(p.x - body.x, p.y - body.y));
  }
  assert.ok(reached(p, g), 'reached');
  assert.equal(first, 1);
  assert.ok(minD >= 1.2 - 1e-9, `minD ${minD}`);
});

test('jittering obstacle does not flip side', () => {
  const body = { id: 'b', x: 0, y: 3 };
  const p = { id: 'p', x: 0, y: 0 };
  const g = { x: 0, y: 8 };
  let first = 0;
  for (let i = 0; i < 60; i++) {
    body.x = i % 2 ? 0.2 : -0.2;
    call(p, g, [body]);
    const s = p.steer ? p.steer.side : 0;
    if (!first && s) { first = s; assert.equal(s, -1); }
    else if (first) assert.notEqual(s, 1);
  }
  assert.equal(first, -1);
});

test('release A: obstacle gone', () => {
  const body = { id: 'b', x: 0, y: 3 };
  const p = { id: 'p', x: 0, y: 0 };
  const g = { x: 0, y: 6 };
  call(p, g, [body]);
  assert.equal(p.steer.side, 1);
  body.x = 10;
  const sx = p.x, sy = p.y;
  call(p, g, [body]);
  assert.equal(p.steer.side, 0);
  const mx = p.x - sx, my = p.y - sy, m = Math.hypot(mx, my);
  const ux = (g.x - sx) / Math.hypot(g.x - sx, g.y - sy);
  const uy = (g.y - sy) / Math.hypot(g.x - sx, g.y - sy);
  assert.ok(Math.abs(mx / m - ux) < 1e-9 && Math.abs(my / m - uy) < 1e-9);
});

test('release B: key change', () => {
  const body = { id: 'b', x: 0, y: 3 };
  const p = { id: 'p', x: 0, y: 0 };
  const g = { x: 0, y: 6 };
  call(p, g, [body], 'a');
  assert.equal(p.steer.side, 1);
  call(p, g, [body], 'b');
  assert.ok(!p.steer || p.steer.flips === 0);
});

test('release C: stuck flips once (5c)', () => {
  const bodies = [[0.3, 3], [-0.9, 3], [-2.1, 3], [-3.3, 3], [-3.3, 1.8], [-3.3, 0.6]]
    .map(([x, y], i) => ({ id: 'b' + i, x, y }));
  const g = { x: 0, y: 8 };
  const r = run(g, bodies, 240);
  const seq = [];
  for (const s of r.sides) if (s && seq[seq.length - 1] !== s) seq.push(s);
  assert.deepEqual(seq, [1, -1]);
  assert.equal(Math.max(...r.flips), 1);
  assert.ok(reached(r.p, g));
  const r2 = run(g, bodies, 240);
  assert.deepEqual(r2.pos, r.pos);
});

test('flip limit (5d)', () => {
  const bodies = [[-3.3, 3], [-2.1, 3], [-0.9, 3], [0.6, 3], [1.5, 3], [2.7, 3],
    [-3.3, 1.8], [-3.3, 0.6], [3.3, 1.8], [3.3, 0.6]]
    .map(([x, y], i) => ({ id: 'b' + i, x, y }));
  const r = run({ x: 0, y: 8 }, bodies, 240);
  assert.equal(r.flips[r.flips.length - 1], 1);
  const fi = r.flips.findIndex(f => f === 1);
  for (let i = fi; i < r.sides.length; i++) assert.equal(r.sides[i], r.sides[fi]);
});
