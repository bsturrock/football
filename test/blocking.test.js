import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HW } from '../src/util.js';
import {
  assignBlocks, setBlock, clearBlock, contactSpot, resolveBlock, stepBlocking,
  doubleTeamPeel, CONTACT_DIST, ENGAGE_TOL, Y_MAX, BODY_RADIUS, SPREAD, separateBodies, canEngage,
} from '../src/dots/blocking.js';

const DT = 1 / 60;
const near = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) < tol, `${a} !~ ${b}`);
const O = (id, x, y, o = {}) => ({ id, team: 'offense', role: 'OL', x, y, speed: 6, strength: 1, block: null, ...o });
const D = (id, x, y, o = {}) => ({ id, team: 'defense', role: 'DT', x, y, speed: 6.5, strength: 0.6, block: null, ...o });
const blk = (target, o = {}) => ({ target, angle: 'straight', engaged: false, seq: null, ...o });
const mk = (angle) => ({ id: 'b', block: { target: 'd', angle, engaged: true, seq: 1 }, strength: 1 });

test('resolveBlock exact values', () => {
  const def = { x: 0, y: 10, strength: 0.6 };
  const goal = { x: 0, y: 0 };
  const cases = [
    [[mk('straight')], 0, 0.6],
    [[mk('left')], -1.06066, 0.16066],
    [[mk('right')], 1.06066, 0.16066],
    [[mk('straight'), mk('straight')], 0, 2.1],
  ];
  for (const [bs, vx, vy] of cases) {
    const v = resolveBlock(def, bs, goal);
    near(v.vx, vx); near(v.vy, vy);
  }
  const v3 = resolveBlock({ ...def, strength: 0 }, [mk('straight'), mk('straight'), mk('straight')], goal);
  near(v3.vx, 0); near(v3.vy, 2.5);
  const v0 = resolveBlock({ x: 0, y: 0, strength: 0.6 }, [mk('straight')], goal);
  near(v0.vx, 0); near(v0.vy, 1.5);
});

test('OL win at every angle', () => {
  for (const s of [0.5, 0.6]) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const goal = { x: Math.cos(a) * 10, y: 10 + Math.sin(a) * 10 };
      for (const ang of ['straight', 'left', 'right']) {
        const v = resolveBlock({ x: 0, y: 10, strength: s }, [mk(ang)], goal);
        assert.ok(v.vy > 0, `${s} ${i} ${ang}`);
      }
    }
  }
});

test('assignBlocks', () => {
  const ps = [O('a', 0, 0), D('d1', -3, 5), D('d2', 3, 5), { id: 'q', team: 'offense', role: 'QB', x: 0, y: -5, block: blk('x') }];
  assignBlocks(ps);
  assert.deepEqual(ps[0].block, { target: 'd1', angle: 'straight', engaged: false, seq: null });
  assert.equal(ps[1].block, null);
  assert.equal(ps[3].block, null);
  ps[0].x = 1;
  assignBlocks(ps);
  assert.equal(ps[0].block.target, 'd2');
});

test('setBlock / clearBlock', () => {
  const ps = [O('a', 0, 0), D('d1', 0, 3), D('d2', 1, 3)];
  assert.equal(setBlock(ps, 'd1', 'd2'), false);
  assert.equal(setBlock(ps, 'a', 'a'), false);
  assert.equal(setBlock(ps, 'a', 'd1', 'up'), false);
  assert.equal(ps[0].block, null);
  assert.equal(clearBlock(ps, 'a'), false);
  assert.equal(setBlock(ps, 'a', 'd1'), true);
  ps[0].block.engaged = true; ps[0].block.seq = 4;
  assert.equal(setBlock(ps, 'a', 'd1', 'left'), true);
  assert.deepEqual(ps[0].block, { target: 'd1', angle: 'left', engaged: true, seq: 4 });
  setBlock(ps, 'a', 'd2');
  assert.deepEqual(ps[0].block, blk('d2'));
  assert.equal(clearBlock(ps, 'd1'), false);
  assert.equal(clearBlock(ps, 'a'), true);
  assert.equal(ps[0].block, null);
});

test('contactSpot', () => {
  const ps = [O('a', 0, 0, { block: blk('d') }), D('d', 2, 10)];
  let s = contactSpot(ps, ps[0]);
  near(s.x, 2); near(s.y, 10 - CONTACT_DIST);
  ps.splice(1, 0, O('b', 1, 0, { block: blk('d') }));
  s = contactSpot(ps, ps[0]); near(s.x, 1.4); near(s.y, 10 - CONTACT_DIST);
  s = contactSpot(ps, ps[1]); near(s.x, 2.6);
});

test('stepBlocking closing, engaging, seq', () => {
  const ps = [O('a', 0, 0, { block: blk('d') }), O('b', 5, 0, { block: blk('d') }), D('d', 2.5, 1.2 + 0.1, { speed: 0 })];
  const ctx = { rule: null, seq: 0 };
  let prev = ps.map((p) => ({ x: p.x, y: p.y }));
  for (let i = 0; i < 600 && ps.some((p) => p.block && !p.block.engaged); i++) {
    stepBlocking(ps, { x: 2.5, y: 50 }, DT, ctx);
    for (const j of [0, 1]) {
      if (!ps[j].block.engaged) assert.ok(Math.hypot(ps[j].x - prev[j].x, ps[j].y - prev[j].y) <= 6 * DT + 1e-9);
    }
    prev = ps.map((p) => ({ x: p.x, y: p.y }));
  }
  assert.deepEqual([ps[0].block.seq, ps[1].block.seq].sort(), [1, 2]);
  assert.equal(ps[0].block.seq, 1);
  assert.equal(ctx.seq, 2);
});

test('stepBlocking engaged defender, clamp, blocker follows', () => {
  const ps = [O('a', 0, 8.8, { block: blk('d', { engaged: true, seq: 1 }) }), D('d', 0, 10)];
  const goal = { x: 0, y: 0 };
  const v = resolveBlock(ps[1], engagedOnList(ps), goal);
  stepBlocking(ps, goal, DT, { rule: null, seq: 1 });
  near(ps[1].y, 10 + v.vy * DT, 1e-12);
  near(ps[1].x, 0 + v.vx * DT, 1e-12);
  const spot = contactSpot(ps, ps[0]);
  assert.ok(Math.hypot(ps[0].x - spot.x, ps[0].y - spot.y) < 6 * DT + 1e-9);
  for (let i = 0; i < 20000; i++) stepBlocking(ps, goal, DT, { rule: null, seq: 1 });
  assert.equal(ps[1].y, Y_MAX);
  const s = contactSpot(ps, ps[0]);
  near(ps[0].x, s.x, 1e-9); near(ps[0].y, s.y, 1e-9);
});
function engagedOnList(ps) { return ps.filter((p) => p.block && p.block.engaged); }

test('stepBlocking pursuit', () => {
  const ps = [D('d', 0, 10, { speed: 6 })];
  const ball = { x: 0, y: 0 };
  stepBlocking(ps, ball, DT, { rule: null, seq: 0 });
  near(ps[0].y, 10 - 6 * DT, 1e-9);
  for (let i = 0; i < 600; i++) stepBlocking(ps, ball, DT, { rule: null, seq: 0 });
  near(ps[0].y, CONTACT_DIST, 1e-9);
  stepBlocking(ps, ball, DT, { rule: null, seq: 0 });
  near(ps[0].y, CONTACT_DIST, 1e-9);
});

const peelFixture = () => [
  O('lead', 0, 8.8, { block: blk('d', { engaged: true, seq: 1 }) }),
  O('dt', 1, 8.8, { block: blk('d', { engaged: true, seq: 2 }) }),
  D('d', 0.5, 10),
  D('lb', 1, 10.3),
];

test('doubleTeamPeel', () => {
  let ps = peelFixture();
  assert.deepEqual(doubleTeamPeel(ps, { x: 0, y: 0 }), [{ blocker: 'dt', target: 'lb' }]);
  ps = peelFixture(); ps[3].y = 8.8 - 2.5; ps[3].x = 1;
  assert.deepEqual(doubleTeamPeel(ps, {}), []);
  ps = peelFixture(); ps.push(O('other', 5, 0, { block: blk('lb') }));
  assert.deepEqual(doubleTeamPeel(ps, {}), []);
  ps = peelFixture(); ps[3].x = -1.5; ps[3].y = 8.8;
  assert.deepEqual(doubleTeamPeel(ps, {}), []);
  ps = [
    O('lead', 0, 8.8, { block: blk('d', { engaged: true, seq: 1 }) }),
    O('t1', 1, 8.8, { block: blk('d', { engaged: true, seq: 2 }) }),
    O('t2', 1.2, 8.8, { block: blk('d', { engaged: true, seq: 3 }) }),
    D('d', 0.5, 10), D('lb', 1, 9.5),
  ];
  assert.deepEqual(doubleTeamPeel(ps, {}), [{ blocker: 't1', target: 'lb' }]);
});

test('stepBlocking with peel rule', () => {
  let ps = peelFixture();
  ps[3].x = 1.8;
  stepBlocking(ps, { x: 0, y: 0 }, DT, { rule: doubleTeamPeel, seq: 2 });
  assert.deepEqual(ps[1].block, blk('lb'));
  assert.equal(ps[0].block.engaged, true);
  assert.equal(ps[0].block.target, 'd');
  ps = peelFixture();
  stepBlocking(ps, { x: 0, y: 0 }, DT, { rule: null, seq: 2 });
  assert.equal(ps[1].block.target, 'd');
  assert.equal(ps[1].block.engaged, true);
});

test('closing blocker engages on body contact without teleporting', () => {
  const ps = [O('a', 0, 8.9, { block: blk('d') }), D('d', 0.6, 10, { speed: 0 })];
  const ctx = { rule: null, seq: 0 };
  const spot = contactSpot(ps, ps[0]);
  assert.ok(Math.hypot(spot.x - ps[0].x, spot.y - ps[0].y) > ENGAGE_TOL);
  stepBlocking(ps, { x: 0, y: -50 }, DT, ctx);
  assert.equal(ps[0].block.engaged, true);
  assert.equal(ps[0].block.seq, 1);
  assert.equal(ctx.seq, 1);
  assert.ok(Math.hypot(ps[0].x - 0, ps[0].y - 8.9) <= 2 * 6 * DT + 1e-9);
});

test('closing blocker behind the defender does not engage', () => {
  const ps = [O('a', 0, 11, { block: blk('d') }), D('d', 0, 10, { speed: 0 })];
  const ctx = { rule: null, seq: 0 };
  stepBlocking(ps, { x: 0, y: -50 }, DT, ctx);
  assert.equal(ps[0].block.engaged, false);
  assert.equal(ps[0].block.seq, null);
  assert.equal(ctx.seq, 0);
});

test('body constants', () => {
  assert.equal(BODY_RADIUS, 0.6);
  assert.equal(CONTACT_DIST, 2 * BODY_RADIUS);
  assert.equal(SPREAD, 2 * BODY_RADIUS);
});

test('separateBodies', () => {
  // two free bodies split the overlap
  let ps = [D('a', 0, 10), D('b', 0.8, 10)];
  separateBodies(ps);
  near(ps[0].x, -0.2, 1e-9); near(ps[1].x, 1.0, 1e-9);
  // anchored (engaged blocker) stays, free moves the whole overlap
  ps = [O('o', 0, 10, { block: blk('t', { engaged: true, seq: 1 }) }), D('f', 0.8, 10)];
  separateBodies(ps);
  assert.equal(ps[0].x, 0);
  near(ps[1].x, 1.2, 1e-9);
  // coincident: fixed +x axis, deterministic
  const run = () => { const q = [D('a', 5, 10), D('b', 5, 10)]; separateBodies(q); return q.map((p) => [p.x, p.y]); };
  const r = run();
  near(r[1][0] - r[0][0], 1.2, 1e-9);
  assert.equal(r[0][1], r[1][1]);
  assert.deepEqual(run(), r);
  // already apart: untouched
  ps = [D('a', 1.1, 3.3), D('b', 2.3, 3.3), D('c', 10, 10)];
  separateBodies(ps);
  assert.equal(ps[0].x, 1.1); assert.equal(ps[1].x, 2.3); assert.equal(ps[1].y, 3.3);
  // clamp at HW
  ps = [D('a', HW - 0.1, 10), D('b', HW, 10)];
  separateBodies(ps);
  assert.ok(ps[0].x <= HW && ps[1].x <= HW);
});

test('canEngage', () => {
  const T = D('t', 0, 10);
  const b = O('b', 0, 8.8, { block: blk('t') });
  assert.equal(canEngage(b, T, { x: 0, y: 8.9 }), 'spot');
  assert.equal(canEngage(b, T, { x: 5, y: 5 }), 'contact');
  assert.equal(canEngage(O('c', 0, 5, { block: blk('t') }), T, { x: 0, y: 8.8 }), null);
  assert.equal(canEngage(O('c', 0, 11.1, { block: blk('t') }), T, { x: 0, y: 8.8 }), null);
});

test('separateBodies: a free body wedged against an anchor is not pushed back by a free body behind him', () => {
  const ps = [
    O('o', 0, 10, { block: blk('t', { engaged: true, seq: 1 }) }),
    D('f1', 1.2, 10),
    D('f2', 1.9, 10),
  ];
  separateBodies(ps);
  assert.equal(ps[0].x, 0);
  near(ps[1].x, 1.2, 1e-9);
  near(ps[2].x, 2.4, 1e-9);
});
