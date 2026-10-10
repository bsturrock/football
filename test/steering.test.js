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
  assert.ok(S.SQUEEZE >= 0 && S.SQUEEZE < 0.5);
  assert.ok(Math.abs(S.hardCore(0.35) - 2 * 0.35 * (1 - S.SQUEEZE)) < 1e-12);
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

// ---- F-15 lane threading ----
function laneRun(bodies, x0, goal, steps) {
  const r = 0.35, H = S.hardCore(r);
  const p = { id: 'p', x: x0, y: -3 };
  const log = [];
  let crossX = null, minD = Infinity;
  for (let i = 0; i < steps; i++) {
    const D = Math.hypot(goal.x - p.x, goal.y - p.y);
    const prevY = p.y;
    steerStep(p, { x: goal.x, y: goal.y, key: 'k', ignore: null }, [p, ...bodies], Math.min(7 / 60, D), DT, r);
    if (crossX === null && prevY < 0 && p.y >= 0) crossX = p.x;
    for (const b of bodies) minD = Math.min(minD, Math.hypot(p.x - b.x, p.y - b.y));
    log.push([p.x, p.y]);
  }
  return { p, crossX, minD, log, H, r };
}
const pair = (s) => [{ id: 'a', x: -s / 2, y: 0 }, { id: 'b', x: s / 2, y: 0 }];

test('F-15 #1 threads a lane that fits', () => {
  const r = 0.35;
  for (const s of [4 * r + 0.1, 4 * r + 0.3, 4 * r + 0.6]) {
    for (const x0 of [0, r, -r]) {
      const o = laneRun(pair(s), x0, { x: 0, y: 5 }, 60);
      assert.ok(o.p.y >= 1, `s=${s} x0=${x0} y=${o.p.y}`);
      assert.ok(o.crossX !== null && Math.abs(o.crossX) < s / 2, `s=${s} x0=${x0} x=${o.crossX}`);
    }
  }
});

test('F-15 #2 squeeze lane keeps the hard core', () => {
  const H = S.hardCore(0.35);
  const o = laneRun(pair(H + 0.7), 0, { x: 0, y: 5 }, 60);
  assert.ok(o.p.y >= 1);
  assert.ok(Math.abs(o.crossX) < (H + 0.7) / 2);
  assert.ok(o.minD >= H - 1e-9, `minD ${o.minD}`);
});

test('F-15 #3 closed lane goes around', () => {
  const H = S.hardCore(0.35), s = 2 * H - 0.05;
  const o = laneRun(pair(s), 0, { x: 0, y: 5 }, 180);
  assert.ok(Math.abs(o.crossX) > s / 2, `x=${o.crossX}`);
  assert.ok(reached(o.p, { x: 0, y: 5 }), `at ${o.p.x},${o.p.y}`);
  assert.ok(o.minD >= H - 1e-9, `minD ${o.minD}`);
});

test('F-15 #4 glancing miss goes straight', () => {
  const r = 0.35;
  const bodies = [{ id: 'a', x: 2 * r + 0.05, y: 0 }];
  const p = { id: 'p', x: 0, y: -3 };
  for (let i = 0; i < 60; i++) {
    const D = Math.hypot(5 - p.y, p.x);
    steerStep(p, { x: 0, y: 5, key: 'k', ignore: null }, [p, ...bodies], Math.min(7 / 60, D), DT, r);
    assert.ok(Math.abs(p.x) < 1e-9);
    assert.ok(!p.steer || p.steer.side === 0);
  }
});

test('F-15 #5 hard core holds against a body dead ahead', () => {
  const r = 0.35, H = S.hardCore(r);
  const bodies = [{ id: 'a', x: 0, y: 1 }];
  const p = { id: 'p', x: 0, y: -3 };
  for (let i = 0; i < 120; i++) {
    const D = Math.hypot(5 - p.y, p.x);
    steerStep(p, { x: 0, y: 5, key: 'k', ignore: null }, [p, ...bodies], Math.min(7 / 60, D), DT, r);
    assert.ok(Math.hypot(p.x, p.y - 1) >= H - 1e-9);
  }
});

test('F-15 #10: full width toward goal.ignore', () => {
  const r = 0.35;
  for (const ignore of ['q', null]) {
    const min = ignore ? 2 * r : S.hardCore(r);
    const q = { id: 'q', x: 0, y: 1 };
    const p = { id: 'p', x: 0, y: -1 };
    for (let i = 0; i < 120; i++) {
      steerStep(p, { x: 0, y: 5, key: 'k', ignore }, [p, q], 7 / 60, DT, r);
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= min - 1e-9, `ignore=${ignore} step ${i}`);
    }
  }
});

function slideRun(accel) {
  const H = S.hardCore(RAD), maxStep = 6 * DT;
  const o = { id: 'o', x: 0, y: 2 };
  // ignore 'o' puts the contact circle at 2 * RAD; the goal lies past the body so the mover must slide
  const p = { id: 'p', x: accel ? 0 : Math.sin(Math.PI / 12) * (2 * RAD + 0.01), y: 2 + (accel ? 1 : Math.cos(Math.PI / 12)) * (2 * RAD + 0.01) };
  if (accel) { p.speed = 6; p.v = 0; }
  const goal = accel ? { x: -6, y: 2, key: 'g', ignore: 'o' } : { x: 8, y: 0, key: 'g', ignore: 'o' };
  const moves = [];
  const n = accel ? 90 : 20;
  for (let i = 0; i < n; i++) {
    const x0 = p.x, y0 = p.y;
    steerStep(p, goal, [p, o], accel ? Math.min(maxStep, (p.v + 30 * DT) * DT) : maxStep, DT, RAD);
    const moved = Math.hypot(p.x - x0, p.y - y0);
    moves.push(moved);
    if (accel) p.v = Math.min(p.speed, moved / DT);
    assert.ok(Math.hypot(p.x - o.x, p.y - o.y) >= 2 * RAD - 1e-9, `step ${i}`);
  }
  return { p, moves, maxStep };
}

test('slide along a body keeps full step, no accel', () => {
  const { moves, maxStep } = slideRun(false);
  const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
  assert.ok(mean >= 0.9 * maxStep, `mean ${mean}`);
  for (const m of moves) assert.ok(m >= 0.5 * maxStep, `move ${m}`);
});

test('slide along a body keeps speed with accel', () => {
  const { p } = slideRun(true);
  assert.ok(p.v >= 0.8 * p.speed, `v ${p.v}`);
});

test('ignored body held at 2 * radius', () => {
  const p = { id: 'p', x: 0, y: 0 }, o = { id: 'o', x: 0, y: 2 };
  for (let i = 0; i < 60; i++) {
    steerStep(p, { x: o.x, y: o.y, key: 'g', ignore: 'o' }, [p, o], 6 * DT, DT, RAD);
  }
  const d = Math.hypot(p.x - o.x, p.y - o.y);
  assert.ok(d >= 2 * RAD - 1e-9 && d <= 2 * RAD + 1e-3, `d ${d}`);
});

// ---- per-phase pace (goal.pace) ----
function paceStep(pace, v) {
  const p = { id: 'p', x: 0, y: 0, speed: 6 };
  if (v !== undefined) p.v = v;
  const goal = { x: 0, y: 100, key: 'g', ignore: null };
  if (pace) goal.pace = pace;
  steerStep(p, goal, [p], 6 * DT, DT, RAD);
  return Math.hypot(p.x, p.y);
}

test('pace: absent leaves today\'s step', () => {
  assert.ok(Math.abs(paceStep(null) - 6 * DT) < 1e-9);
  const want = 6 * (1 - Math.exp(-DT / S.ACCEL_TAU)) * DT;
  assert.ok(Math.abs(paceStep(null, 0) - want) < 1e-9);
});

test('pace: press with accel off caps at half top speed', () => {
  assert.ok(Math.abs(paceStep(S.PACES.press) - 0.5 * 6 * DT) < 1e-9);
});

test('pace: press with accel on eases down from top speed', () => {
  const s = paceStep(S.PACES.press, 6);
  assert.ok(s < 6 * DT && s > 3 * DT, `s ${s}`);
});

test('pace: burst accelerates faster than cruise', () => {
  const b = paceStep(S.PACES.burst, 3), c = paceStep(S.PACES.cruise, 3);
  assert.ok(b > c && b <= 6 * DT + 1e-12 && c <= 6 * DT + 1e-12, `b ${b} c ${c}`);
});

test('pace: PACES and entries are frozen', () => {
  assert.ok(Object.isFrozen(S.PACES));
  for (const k of Object.keys(S.PACES)) assert.ok(Object.isFrozen(S.PACES[k]));
});
