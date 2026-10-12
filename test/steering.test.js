import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/dots/steering.js';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { engagedOn, CONTACT_DIST, SOFT_RATE, BODY_RADIUS } from '../src/dots/blocking.js';
import { FRONT_NAMES } from './fixtures/fronts.js';

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

test('R-17: a goal sliding across the obstacle\'s line keeps the pass side', () => {
  // The goal swings so the body's offset from the goal line crosses the touch-width edge (2 * RAD) and stays inside the release corridor.
  const body = { id: 'b', x: 0, y: 2.5 };
  const p = { id: 'p', x: 0, y: 0 };
  let side = 0, last = 0, reversals = 0, ahead = 0;
  for (let tick = 0; tick < 120 && p.y < 2; tick++) {
    const g = { x: 5 * Math.sin(tick * 0.3), y: 8, key: 'k', ignore: null };
    const x0 = p.x;
    steerStep(p, g, [p, body], 2 * DT, DT, RAD);
    ahead++;
    if (p.steer && p.steer.side !== 0) {
      if (side !== 0) assert.equal(p.steer.side, side, 'pass side changed at tick ' + tick);
      side = p.steer.side;
    }
    const vx = (p.x - x0) / DT;
    if (Math.abs(vx) > 0.3) {
      if (last !== 0 && Math.sign(vx) !== last) reversals++;
      last = Math.sign(vx);
    }
  }
  assert.ok(ahead > 40 && side !== 0, 'body stayed ahead and was passed on a side: ' + ahead);
  assert.ok(reversals <= 1, 'vel.x reversed ' + reversals + ' times');
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

test('F-42 #1 a blocker and his target do not hold a lane', () => {
  const r = 0.35, H = S.hardCore(r);
  const freshRun = () => {
    const a = { id: 'a', x: -0.6, y: 0 }, b = { id: 'b', x: 0.6, y: 0 };
    const p = { id: 'p', x: 0, y: -3 };
    const goal = { x: 0, y: 5, key: 'k', ignore: null };
    steerStep(p, goal, [p, a, b], 7 / 60, DT, r);
    return { p, a, b, goal };
  };
  // Case 1: unrelated pair, narrowed below 2H, is still held.
  {
    const { p, a, b, goal } = freshRun();
    assert.deepEqual(p.steer.lane, ['a', 'b']);
    b.x = a.x + 2 * H - 0.25;
    steerStep(p, goal, [p, a, b], 7 / 60, DT, r);
    assert.deepEqual(p.steer.lane, ['a', 'b']);
  }
  // Case 2: a block pair is not held once it narrows.
  {
    const { p, a, b, goal } = freshRun();
    assert.deepEqual(p.steer.lane, ['a', 'b']);
    b.x = a.x + 2 * H - 0.25;
    a.block = { target: 'b', engaged: false };
    steerStep(p, goal, [p, a, b], 7 / 60, DT, r);
    assert.equal(p.steer.lane, null);
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
  for (let i = 0; i < n && p.x < 1.5; i++) {
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

// ---- planted cut: goal.accel = CUT_ACCEL (F-50 #10) ----

function reversal(accel) {
  const p = { id: 'm', x: 0, y: 0, vel: { x: 0, y: 5 }, speed: 6 };
  const goal = { x: 0, y: -10, key: 'rev', ignore: null };
  if (accel) goal.accel = S.CUT_ACCEL;
  const trace = [];
  for (let i = 0; i < Math.ceil(2 / DT); i++) {
    const before = { x: p.x, y: p.y }, v0 = { ...p.vel };
    steerStep(p, { ...goal }, [p], Math.min(6 * DT, Math.hypot(goal.x - p.x, goal.y - p.y)), DT, RAD);
    p.vel = { x: (p.x - before.x) / DT, y: (p.y - before.y) / DT };
    trace.push({ v0, v: p.vel });
  }
  return { p, trace, goal };
}

test('accel cap: reversal changes velocity by at most CUT_ACCEL*DT per tick and plants first', () => {
  const { p, trace } = reversal(true);
  let planted = false, toward = false;
  for (const { v0, v } of trace) {
    assert.ok(Math.hypot(v.x - v0.x, v.y - v0.y) <= S.CUT_ACCEL * DT + 1e-9, `dv ${Math.hypot(v.x - v0.x, v.y - v0.y)}`);
    if (!toward && Math.hypot(v.x, v.y) < 0.5) planted = true;
    if (v.y < 0) { toward = true; break; }
  }
  assert.ok(planted, 'speed fell below 0.5 yd/s before velocity pointed at the goal');
  assert.ok(toward, 'velocity points at the goal within 2 s');
  assert.ok(p.y > -10 && p.y < 0 || p.y < 0, `y ${p.y}`);
  assert.ok(Math.abs(p.y + 10) < 10, 'ends closer to the goal than he started');
});

test('accel cap is opt-in: without goal.accel the first step already points at the goal', () => {
  const { trace } = reversal(false);
  assert.ok(trace[0].v.y < 0, `vy ${trace[0].v.y}`);
});

test('T-38: a grazing hard-core hit under goal.accel is a contact stop at the hard core', () => {
  const p = { id: 'LDE', x: -2.3326289718016193, y: 34.01146434700278, v: 5.97568167452963, speed: 7,
    selfVel: { x: -2.2996884179339014, y: 5.3570351119423245 }, vel: { x: -2.2996884179339014, y: 5.3570351119423245 },
    steer: { key: 'def:pursue', side: 1, stuck: 0, flips: 0, lane: ['MLB', 'WLB'] } };
  const goal = { x: -4.425389514909736, y: 50.9572007845785, key: 'def:pursue', ignore: 'RB', accel: 20 };
  const others = [
    { id: 'LDT', x: -2.7751627448795846, y: 34.15867489702504 }, { id: 'RDT', x: -3.3528551185723683, y: 34.59240714571357 },
    { id: 'RDE', x: -4.381687756786772, y: 35.72799761553998 }, { id: 'MLB', x: -2.33531970774139, y: 35.18954973996723 },
    { id: 'WLB', x: -2.9254366112694887, y: 36.52284039232105 } ];
  const maxStep = 0.11666666666666667, dt = 1 / 60;
  const H = S.hardCore(0.28), LDT = others[0];
  const x0 = p.x, y0 = p.y, v0 = p.selfVel;
  // (a) Every velocity reachable under the cap (64 sampled directions on the circle of radius
  // CUT_ACCEL * dt around selfVel) runs its straight step through LDT's hard core.
  const segDist = (ax, ay, bx, by, cx, cy) => {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const u = L > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / L)) : 0;
    return Math.hypot(ax + u * dx - cx, ay + u * dy - cy);
  };
  for (let k = 0; k < 64; k++) {
    const a = 2 * Math.PI * k / 64, r = S.CUT_ACCEL * dt;
    const vx = v0.x + r * Math.cos(a), vy = v0.y + r * Math.sin(a);
    const d = segDist(x0, y0, x0 + vx * dt, y0 + vy * dt, LDT.x, LDT.y);
    assert.ok(d < H, `direction ${k}: reachable step clears LDT by ${d}`);
  }
  // This is the tick the realism test now scores as contact, through the start-of-tick rule.
  steerStep(p, goal, [p, ...others], maxStep, dt, 0.28);
  // (b) LDE stops at LDT's hard core and inside no body.
  assert.ok(Math.abs(Math.hypot(p.x - LDT.x, p.y - LDT.y) - H) < 1e-6, `LDT distance ${Math.hypot(p.x - LDT.x, p.y - LDT.y)}`);
  for (const o of others) assert.ok(Math.hypot(p.x - o.x, p.y - o.y) >= H - 1e-9, `inside ${o.id}`);
  // (c) The step is at most maxStep.
  const len = Math.hypot(p.x - x0, p.y - y0);
  assert.ok(len <= maxStep + 1e-9, `step ${len}`);
});

test('accel cap: step never exceeds maxStep and hard contact still holds hardCore', () => {
  const p = { id: 'm', x: 0, y: 0, vel: { x: 0, y: 0 }, speed: 6 };
  const goal = () => ({ x: 0, y: 10, key: 'wall', ignore: null, accel: S.CUT_ACCEL });
  const maxStep = 3 * DT;
  const b = { id: 'b', x: 0, y: S.hardCore(RAD) + 0.2 };
  for (let i = 0; i < 120; i++) {
    const x0 = p.x, y0 = p.y;
    steerStep(p, goal(), [p, b], maxStep, DT, RAD);
    assert.ok(Math.hypot(p.x - x0, p.y - y0) <= maxStep + 1e-9);
    p.vel = { x: (p.x - x0) / DT, y: (p.y - y0) / DT };
    assert.ok(Math.hypot(p.x - b.x, p.y - b.y) >= S.hardCore(RAD) - 1e-9, `d ${Math.hypot(p.x - b.x, p.y - b.y)}`);
  }
});

// Play level: a free defender's velocity (position deltas / FIXED_DT) changes by at most
// CUT_ACCEL * FIXED_DT + TOL over three consecutive free ticks. TOL: body separation (stepBlocking's
// push-out) can move a body on a tick the steering did not choose; a soft push is at most SOFT_RATE
// yd/s and relaxes a fraction SOFT_RATE * FIXED_DT of the overlap per tick; soft overlap is at most
// the depth 2 * BODY_RADIUS - hardCore(BODY_RADIUS) (the hard core is a steering limit, not a push).
// So one tick's push-out displacement is at most SOFT_RATE * FIXED_DT * depth, i.e. a velocity change
// of SOFT_RATE * depth. TOL is that bound; the measured maximum is printed per front.
const TOL = SOFT_RATE * (2 * BODY_RADIUS - S.hardCore(BODY_RADIUS));

for (const front of FRONT_NAMES) {
  test(`free defenders cap their acceleration on every tick (realism): ${front}`, (t) => {
    const shifts = { dlPlus4: ['shiftDL', 4], dlMinus4: ['shiftDL', -4], lbPlus6: ['shiftLB', 6], lbMinus6: ['shiftLB', -6] };
    const fronts = new Set(['base', 'over43', 'under43', 'odd34', 'bear', 'walkedUp', 'backedOff']);
    const play = createPlay(25, 'insideZone', fronts.has(front) ? { front } : {});
    if (shifts[front]) for (let k = 0; k < Math.abs(shifts[front][1]); k++) play[shifts[front][0]](Math.sign(shifts[front][1]));
    assert.ok(play.snap());
    const defs = play.players.filter((p) => p.team === 'defense').map((p) => p.id);
    const pos = [], free = [];
    const grab = () => {
      pos.push(Object.fromEntries(play.players.map((p) => [p.id, { x: p.x, y: p.y }])));
      // The tackle tick (ball dead) is the play ending, not a free tick.
      free.push(Object.fromEntries(defs.map((id) => [id, play.ball.phase !== 'dead' && engagedOn(play.players, id).length === 0])));
    };
    grab();
    let worstGuard = Infinity;
    for (let i = 0; i < Math.ceil(4 / FIXED_DT) && play.ball.phase !== 'dead'; i++) {
      play.step(FIXED_DT);
      grab();
      const bp = play.ballPosition();
      for (const id of defs) {
        if (!free[free.length - 1][id]) continue;
        const d = Math.hypot(pos[pos.length - 1][id].x - bp.x, pos[pos.length - 1][id].y - bp.y);
        if (d < worstGuard) worstGuard = d;
      }
    }
    const vel = (id, i) => ({ x: (pos[i][id].x - pos[i - 1][id].x) / FIXED_DT, y: (pos[i][id].y - pos[i - 1][id].y) / FIXED_DT });
    // Hard contact: within one soft-relax step of the hard core of another body, at that body's
    // end-of-tick position or at the position it held when the defender stepped (its start-of-tick
    // position, since bodies step one after another inside a tick). A ray stop at a body that moves
    // on later in the tick is still contact. On such a tick the contact (steering slide plus
    // separation push-out) decides the change, so the free cap does not apply; the contact rule
    // does: inelastic, no rebound (he never leaves a body faster than that body moves along the
    // normal, plus one soft relax).
    const HE = S.hardCore(BODY_RADIUS) + (2 * BODY_RADIUS - S.hardCore(BODY_RADIUS)) * SOFT_RATE * FIXED_DT;
    const others = (id) => play.players.map((p) => p.id).filter((o) => o !== id);
    const distAt = (id, o, k) => Math.hypot(pos[k][id].x - pos[k][o].x, pos[k][id].y - pos[k][o].y);
    // The defender's end-of-tick-k position against the other body's start-of-tick-k position (k >= 1).
    const crossAt = (id, o, k) => Math.hypot(pos[k][id].x - pos[k - 1][o].x, pos[k][id].y - pos[k - 1][o].y);
    let worst = 0, at = null, worstReb = -Infinity, atReb = null;
    for (let i = 3; i < pos.length; i++) {
      for (const id of defs) {
        if (!(free[i][id] && free[i - 1][id] && free[i - 2][id])) continue;
        const a = vel(id, i - 1), b = vel(id, i);
        const os = others(id);
        // A body stopped at the hard core and relaxed one full soft step sits at HE to float precision; that is contact (F-55, like T-38).
        const hard = os.some((o) => [i - 2, i - 1, i].some((k) => distAt(id, o, k) < HE + 1e-6 || crossAt(id, o, k) < HE + 1e-6));
        if (hard) {
          for (const o of os) {
            const d = distAt(id, o, i);
            if (!(d < HE + 1e-6) || d === 0) continue;
            const n = { x: (pos[i][id].x - pos[i][o].x) / d, y: (pos[i][id].y - pos[i][o].y) / d };
            const vo = vel(o, i);
            const reb = (b.x - vo.x) * n.x + (b.y - vo.y) * n.y;
            if (reb > worstReb) { worstReb = reb; atReb = { id, o, tick: i, b, vo, d }; }
          }
          continue;
        }
        let nSoft = 1;
        for (const k of [i - 2, i - 1, i]) nSoft = Math.max(nSoft, os.filter((o) => distAt(id, o, k) < 2 * BODY_RADIUS).length);
        const dv = Math.hypot(b.x - a.x, b.y - a.y) - TOL * (nSoft - 1);
        if (dv > worst) { worst = dv; at = { id, tick: i, a, b, nSoft }; }
      }
    }
    t.diagnostic(`${front}: max free dv - TOL*(nSoft-1) ${worst.toFixed(3)} yd/s per tick (limit ${(S.CUT_ACCEL * FIXED_DT).toFixed(3)} + TOL ${TOL.toFixed(3)}); worst collision rebound ${worstReb.toFixed(3)} (limit TOL); closest free defender to ball ${worstGuard.toFixed(3)}`);
    assert.ok(worst <= S.CUT_ACCEL * FIXED_DT + TOL, `${JSON.stringify(at)} dv ${worst}`);
    assert.ok(worstReb <= TOL, `rebound ${JSON.stringify(atReb)}`);
    assert.ok(worstGuard >= CONTACT_DIST - 1e-6, `F-34 guard: ${worstGuard} < ${CONTACT_DIST}`);
  });
}

// ---- T-173: lane threading bends around the near edge body ----
const R35 = 0.35;
function t173Run(start, goal, bodies, v0, n) {
  const p = { id: 'p', x: start.x, y: start.y, selfVel: { x: v0.x, y: v0.y }, vel: { x: v0.x, y: v0.y } };
  let maxDv = 0, minD = Infinity;
  const path = [];
  for (let i = 0; i < n && p.x < 1.5; i++) {
    const x0 = p.x, y0 = p.y;
    const D = Math.hypot(goal.x - p.x, goal.y - p.y);
    steerStep(p, { x: goal.x, y: goal.y, key: 'k', ignore: null, accel: S.CUT_ACCEL }, [p, ...bodies], Math.min(5 * DT, D), DT, R35);
    const v = { x: (p.x - x0) / DT, y: (p.y - y0) / DT };
    maxDv = Math.max(maxDv, Math.hypot(v.x - p.selfVel.x, v.y - p.selfVel.y));
    p.selfVel = v; p.vel = v;
    for (const b of bodies) minD = Math.min(minD, Math.hypot(p.x - b.x, p.y - b.y));
    path.push([p.x, p.y]);
  }
  return { p, maxDv, minD, path };
}

test('T-173 (a) flat-angle mover threads the lane around the near edge body', () => {
  const bodies = [{ id: 'a', x: -0.7, y: 0 }, { id: 'b', x: 0.7, y: 0 }];
  const ang = 15 * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
  const start = { x: -3 * c, y: -3 * s };
  const goal = { x: 6 * c, y: 6 * s };
  const r = t173Run(start, goal, bodies, { x: 4.5 * c, y: 4.5 * s }, 120);
  assert.ok(r.p.x >= 1.5, `past the lane: ${r.p.x}`);
  assert.ok(r.maxDv <= S.CUT_ACCEL / 60 + 1e-6, `dv ${r.maxDv}`);
  assert.ok(r.minD >= S.hardCore(R35) - 1e-6, `closest ${r.minD}`);
  const crossed = r.path.some(([x, y], i) => i > 0 && r.path[i - 1][0] < 0 && x >= 0 && Math.abs(x) < 5 && Math.abs(y) < 5);
  assert.ok(crossed);
});

test('T-173 (b) a line that already clears both bodies keeps the midpoint aim', () => {
  const bodies = [{ id: 'a', x: -0.7, y: 0 }, { id: 'b', x: 0.7, y: 0 }];
  const p = { id: 'p', x: 0, y: -3 };
  steerStep(p, { x: 0, y: 5, key: 'k', ignore: null }, [p, ...bodies], 6 * DT, DT, R35);
  assert.ok(Math.abs(p.x) < 1e-12 && Math.abs(p.y - (-3 + 6 * DT)) < 1e-12);
});

test('T-12: a forward goal never detours backward around a body on the held side', () => {
  const mk = (ox) => ({
    p: { id: 'p', x: 0, y: 0, steer: { key: 'k', side: 1, stuck: 0, flips: 0, lane: null } },
    bodies: [{ id: 'o', x: ox, y: 0.09 }],
  });
  const step = (ox, forward) => {
    const { p, bodies } = mk(ox);
    const g = { x: 0, y: 10, key: 'k' };
    if (forward) g.forward = true;
    steerStep(p, g, [p, ...bodies], 0.13, 1 / 60, 0.28);
    return p;
  };
  assert.ok(step(-0.51, false).y < 0);
  const f = step(-0.51, true);
  assert.ok(f.y >= -1e-9);
  assert.equal(f.steer.side, 1);
  const a = step(0.51, false), b = step(0.51, true);
  assert.equal(b.x, a.x);
  assert.equal(b.y, a.y);
});

// ---- T-58: no lane along the path ----
// Measured (F-55 #6d with T-49): climber C, LDT engaged by RG, MLB free. LDT and MLB sit one behind the
// other along C's path, so the midpoint between them lies on LDT's side, not across the path.
function t58Run(goalPt, n) {
  const R = 0.28;
  const bodies = [
    { id: 'LDT', x: 0.850, y: 26.545 },
    { id: 'RG', x: 1.008, y: 25.996, block: { target: 'LDT' } },
    { id: 'MLB', x: 1.051, y: 28.170 },
    { id: 'WLB', x: -0.017, y: 28.891 },
    { id: 'RT', x: 1.848, y: 26.514 },
    { id: 'RDT', x: 0.045, y: 25.606 },
    { id: 'LG', x: -0.016, y: 25.049 },
  ];
  const p = {
    id: 'C', x: 0.129, y: 26.470, v: 3.07, speed: 6,
    vel: { x: -0.55, y: 3.02 }, selfVel: { x: -0.55, y: 3.02 },
    steer: { key: 'aim:WLB', side: 1, stuck: 0, flips: 0, lane: null },
  };
  const steps = [], lanes = [], straight = [];
  for (let i = 0; i < n; i++) {
    const x0 = p.x, y0 = p.y;
    straight.push(6 * DT * (goalPt.x - p.x) / Math.hypot(goalPt.x - p.x, goalPt.y - p.y));
    steerStep(p, { x: goalPt.x, y: goalPt.y, key: 'aim:WLB' }, [p, ...bodies], 6 * DT, DT, R);
    const v = { x: (p.x - x0) / DT, y: (p.y - y0) / DT };
    p.selfVel = v; p.vel = v;
    steps.push(p.x - x0);
    lanes.push(p.steer && p.steer.lane ? p.steer.lane.join(',') : null);
  }
  return { steps, lanes, straight };
}

test('T-58 (a) no lane between two bodies stacked along the path', () => {
  const r = t58Run({ x: 0.5, y: 28.7 }, 6);
  assert.ok(r.lanes.every((l) => l !== 'LDT,MLB'), `lanes ${r.lanes}`);
  // never turns toward LDT's side further than the straight line to the goal does
  assert.ok(r.steps.every((dx, i) => dx <= r.straight[i] + 1e-9), `step x ${r.steps} vs ${r.straight}`);
});
