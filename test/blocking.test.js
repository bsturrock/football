import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HW } from '../src/util.js';
import {
  assignBlocks, setBlock, clearBlock, contactSpot, resolveBlock, stepBlocking,
  doubleTeamPeel, CONTACT_DIST, ENGAGE_TOL, Y_MAX, DRIVE_RATE, BODY_RADIUS, SPREAD, separateBodies, canEngage, SOFT_RATE,
  SHED_TIME, REENGAGE_DELAY, RELEASE_PAST,
} from '../src/dots/blocking.js';
import { hardCore } from '../src/dots/steering.js';
import { startReact, WIN_SPEED } from '../src/dots/react.js';

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
  s = contactSpot(ps, ps[0]); near(s.x, 2 - SPREAD / 2); near(s.y, 10 - CONTACT_DIST);
  s = contactSpot(ps, ps[1]); near(s.x, 2 + SPREAD / 2);
});

const MIX_CASES = [
  ['straight + left', ['straight', 'left']],
  ['straight + right', ['straight', 'right']],
  ['left + right', ['left', 'right']],
  ['two straight + left', ['straight', 'straight', 'left']],
  ['left + straight + right', ['left', 'straight', 'right']],
];

test('F-14 #12: mixed-angle double-team spots one body apart', () => {
  for (const [name, angles] of MIX_CASES) {
    const ps = [D('d', 0, 10)];
    angles.forEach((angle, i) => ps.push(O(`b${i}`, i, 0, { block: { target: 'd', angle, engaged: true, seq: i + 1 } })));
    const bs = ps.slice(1);
    const spots = bs.map((b) => contactSpot(ps, b));
    spots.forEach((s, i) => {
      assert.ok(Math.hypot(s.x, s.y - 10) >= CONTACT_DIST - 1e-9, `${name}: ${i} too close to target`);
      assert.ok(s.y < 10, `${name}: ${i} not behind target`);
      for (let j = i + 1; j < spots.length; j++) {
        const dist = Math.hypot(s.x - spots[j].x, s.y - spots[j].y);
        assert.ok(dist >= 2 * BODY_RADIUS - 1e-9, `${name}: ${i},${j} only ${dist} apart`);
      }
    });
    // a blocker stands opposite its push direction, so a left blocker's spot is on the +x side
    const rank = { left: 0, straight: 1, right: 2 };
    for (let i = 0; i < bs.length; i++) {
      for (let j = 0; j < bs.length; j++) {
        if (rank[angles[i]] < rank[angles[j]]) assert.ok(spots[i].x > spots[j].x, `${name}: side ${i},${j}`);
      }
    }
  }
});

test('F-14 #12: mixed-angle double team holds its spots', () => {
  const ps = [
    D('d', 0, 10, { speed: 0 }),
    O('a', 0, 0, { block: { target: 'd', angle: 'straight', engaged: true, seq: 1 } }),
    O('b', 0, 0, { block: { target: 'd', angle: 'left', engaged: true, seq: 2 } }),
  ];
  for (const b of [ps[1], ps[2]]) { const s = contactSpot(ps, b); b.x = s.x; b.y = s.y; }
  const ball = { x: 0, y: -50 };
  for (let f = 0; f < 60; f++) {
    const sep = stepBlocking(ps, ball, 1 / 60, { rule: null, seq: 2 });
    for (const b of [ps[1], ps[2]]) {
      const s = contactSpot(ps, b);
      assert.ok(Math.hypot(b.x - s.x, b.y - s.y) <= ENGAGE_TOL, `frame ${f}: ${b.id} off spot`);
    }
    const total = typeof sep === 'number' ? sep : (sep && typeof sep.separation === 'number' ? sep.separation : 0);
    assert.ok(total < 1e-6, `frame ${f}: separation ${total}`);
  }
});

test('stepBlocking closing, engaging, seq', () => {
  const ps = [O('a', 0, 0, { block: blk('d') }), O('b', 5, 0, { block: blk('d') }), D('d', 2.5, CONTACT_DIST + 0.1, { speed: 0 })];
  const ctx = { rule: null, seq: 0 };
  let prev = ps.map((p) => ({ x: p.x, y: p.y }));
  for (let i = 0; i < 600 && ps.some((p) => p.block && !p.block.engaged); i++) {
    stepBlocking(ps, { x: 2.5, y: -50 }, DT, ctx);
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
  const ps = [O('a', 0, 10 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 1 }) }), D('d', 0, 10)];
  const goal = { x: 0, y: 0 };
  const v = resolveBlock(ps[1], engagedOnList(ps), goal);
  stepBlocking(ps, goal, DT, { rule: null, seq: 1 });
  near(ps[1].y, 10 + v.vy * DT, 1e-12);
  near(ps[1].x, 0 + v.vx * DT, 1e-12);
  const spot = contactSpot(ps, ps[0]);
  assert.ok(Math.hypot(ps[0].x - spot.x, ps[0].y - spot.y) < 6 * DT + 1e-9);
  const ps2 = [O('a', 0, Y_MAX - 0.3 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 1 }) }), D('d', 0, Y_MAX - 0.3)];
  for (let i = 0; i < 20000; i++) stepBlocking(ps2, goal, DT, { rule: null, seq: 1 });
  assert.equal(ps2[1].y, Y_MAX);
  const s = contactSpot(ps2, ps2[0]);
  near(ps2[0].x, s.x, 1e-9); near(ps2[0].y, s.y, 1e-9);
});

test('stepBlocking engaged defender leans to his goal, else the ball', () => {
  const mkPs = () => [O('a', 0, 10 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 1 }) }), D('d', 0, 10)];
  const ball = { x: -10, y: 0 };
  const withGoal = mkPs();
  stepBlocking(withGoal, ball, DT, { rule: null, seq: 1, defGoals: { d: { x: 10, y: 10, key: 'gap', rate: 6 } } });
  assert.equal(withGoal[1].react.side, 1);
  const noGoal = mkPs();
  stepBlocking(noGoal, ball, DT, { rule: null, seq: 1, defGoals: {} });
  assert.equal(noGoal[1].react.side, -1);
});

test('resolveBlock adds react.hold', () => {
  const goal = { x: 0, y: 0 };
  const held = D('d', 0, 10, { react: { dir: { x: 0, y: -1 }, hold: { x: 0, y: -0.4 } } });
  const v = resolveBlock(held, [mk('straight')], goal);
  near(v.vy, (1 - 0.6 - 0.4) * DRIVE_RATE, 1e-9);
  const free = D('d', 0, 10, { react: { dir: { x: 0, y: -1 } } });
  const w = resolveBlock(free, [mk('straight')], goal);
  near(w.vy, 0.4 * DRIVE_RATE, 1e-9);
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
  O('lead', 0, 10 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 1 }) }),
  O('dt', 1, 10 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 2 }) }),
  D('d', 0.5, 10),
  D('lb', 1, 10.3),
];

test('doubleTeamPeel', () => {
  let ps = peelFixture();
  assert.deepEqual(doubleTeamPeel(ps, { x: 0, y: 0 }), [{ blocker: 'dt', target: 'lb' }]);
  ps = peelFixture(); ps[3].y = 10 - CONTACT_DIST - 2.5; ps[3].x = 1;
  assert.deepEqual(doubleTeamPeel(ps, {}), []);
  ps = peelFixture(); ps.push(O('other', 5, 0, { block: blk('lb') }));
  assert.deepEqual(doubleTeamPeel(ps, {}), []);
  ps = peelFixture(); ps[3].x = -1.5; ps[3].y = 10 - CONTACT_DIST;
  assert.deepEqual(doubleTeamPeel(ps, {}), []);
  ps = [
    O('lead', 0, 10 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 1 }) }),
    O('t1', 1, 10 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 2 }) }),
    O('t2', SPREAD, 10 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 3 }) }),
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
  const ps = [O('a', 0, 10 - CONTACT_DIST + 0.05, { block: blk('d') }), D('d', ENGAGE_TOL + 6 * DT + 0.02, 10, { speed: 0 })];
  const ctx = { rule: null, seq: 0 };
  const spot = contactSpot(ps, ps[0]);
  assert.ok(Math.hypot(spot.x - ps[0].x, spot.y - ps[0].y) > ENGAGE_TOL);
  stepBlocking(ps, { x: 0, y: -50 }, DT, ctx);
  assert.equal(ps[0].block.engaged, true);
  assert.equal(ps[0].block.seq, 1);
  assert.equal(ctx.seq, 1);
  assert.ok(Math.hypot(ps[0].x - 0, ps[0].y - (10 - CONTACT_DIST + 0.05)) <= 2 * 6 * DT + 1e-9);
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
  assert.ok(BODY_RADIUS > 0);
  assert.equal(CONTACT_DIST, 2 * BODY_RADIUS);
  assert.equal(SPREAD, 2 * BODY_RADIUS);
});

test('separateBodies', () => {
  // two free bodies split the overlap
  let ps = [D('a', 0, 10), D('b', 2 * BODY_RADIUS - 0.4, 10)];
  separateBodies(ps);
  near(ps[0].x, -0.2, 1e-9); near(ps[1].x, 2 * BODY_RADIUS - 0.2, 1e-9);
  // anchored (engaged blocker) stays, free moves the whole overlap
  ps = [O('o', 0, 10, { block: blk('t', { engaged: true, seq: 1 }) }), D('f', 2 * BODY_RADIUS - 0.4, 10)];
  separateBodies(ps);
  assert.equal(ps[0].x, 0);
  near(ps[1].x, 2 * BODY_RADIUS, 1e-9);
  // coincident: fixed +x axis, deterministic
  const run = () => { const q = [D('a', 5, 10), D('b', 5, 10)]; separateBodies(q); return q.map((p) => [p.x, p.y]); };
  const r = run();
  near(r[1][0] - r[0][0], 2 * BODY_RADIUS, 1e-9);
  assert.equal(r[0][1], r[1][1]);
  assert.deepEqual(run(), r);
  // already apart: untouched
  ps = [D('a', 1.1, 3.3), D('b', 1.1 + 2 * BODY_RADIUS, 3.3), D('c', 10, 10)];
  separateBodies(ps);
  assert.equal(ps[0].x, 1.1); assert.equal(ps[1].x, 1.1 + 2 * BODY_RADIUS); assert.equal(ps[1].y, 3.3);
  // clamp at HW
  ps = [D('a', HW - 0.1, 10), D('b', HW, 10)];
  separateBodies(ps);
  assert.ok(ps[0].x <= HW && ps[1].x <= HW);
});

test('separateBodies: soft zone relaxes by SOFT_RATE * dt, hard core holds', () => {
  const H = hardCore(BODY_RADIUS);
  const R2 = 2 * BODY_RADIUS;
  const k = Math.min(1, SOFT_RATE / 60);
  assert.equal(SOFT_RATE, 8);
  let d = (H + R2) / 2;
  let ps = [D('a', 0, 10), D('b', d, 10)];
  separateBodies(ps, 1 / 60);
  near(ps[1].x - ps[0].x, d + (R2 - d) * k, 1e-9);
  near(ps[0].x, -(R2 - d) * k / 2, 1e-9);
  near(ps[1].x, d + (R2 - d) * k / 2, 1e-9);
  // below the hard core: never closer than H afterwards
  ps = [D('a', 0, 10), D('b', H - 0.1, 10)];
  separateBodies(ps, 1 / 60);
  assert.ok(ps[1].x - ps[0].x >= H - 1e-9);
  // anchored pair holds; the free body takes the full soft amount
  const dist = (H + R2) / 2;
  ps = [
    O('o', 0, 10 - R2, { block: blk('d', { engaged: true, seq: 1 }) }),
    D('d', 0, 10),
    D('f', 0, 10 + dist),
  ];
  separateBodies(ps, 1 / 60);
  assert.equal(ps[0].y, 10 - R2);
  assert.equal(ps[1].y, 10);
  near(ps[2].y, 10 + dist + (R2 - dist) * k, 1e-9);
});

test('canEngage', () => {
  const T = D('t', 0, 10);
  const b = O('b', 0, 10 - CONTACT_DIST, { block: blk('t') });
  assert.equal(canEngage(b, T, { x: 0, y: 10 - CONTACT_DIST + 0.1 }), 'spot');
  assert.equal(canEngage(b, T, { x: 5, y: 5 }), 'contact');
  assert.equal(canEngage(O('c', 0, 5, { block: blk('t') }), T, { x: 0, y: 10 - CONTACT_DIST }), null);
  assert.equal(canEngage(O('c', 0, 11.1, { block: blk('t') }), T, { x: 0, y: 10 - CONTACT_DIST }), null);
});

test('canEngage: ball past the target and shed-free targets refuse engage', () => {
  const b = O('b', 0, 10 - CONTACT_DIST, { block: blk('t') });
  const spot = { x: 0, y: 10 - CONTACT_DIST + 0.1 };
  const contactSpotArg = { x: 5, y: 5 };
  const behind = { x: 0, y: 10 - 3 };
  const past = { x: 0, y: 10 + RELEASE_PAST };
  const T = D('t', 0, 10);
  // ball behind the target: same results as the 3-arg call
  assert.equal(canEngage(b, T, spot, behind), 'spot');
  assert.equal(canEngage(b, T, contactSpotArg, behind), 'contact');
  // ball at T.y + RELEASE_PAST: refused
  assert.equal(canEngage(b, T, spot, past), null);
  assert.equal(canEngage(b, T, contactSpotArg, past), null);
  // shedFree: refused while it runs, today's result at zero
  const shed = D('t', 0, 10, { shedFree: 0.2 });
  assert.equal(canEngage(b, shed, spot), null);
  assert.equal(canEngage(b, shed, contactSpotArg), null);
  const free = D('t', 0, 10, { shedFree: 0 });
  assert.equal(canEngage(b, free, spot), 'spot');
  assert.equal(canEngage(b, free, contactSpotArg), 'contact');
});

test('stepBlocking: a shed frees the defender from every blocker for REENGAGE_DELAY', () => {
  const DL = D('dl', 0, 10, { speed: 0 });
  const a = O('a', -CONTACT_DIST, 10 - CONTACT_DIST, { block: blk('dl', { engaged: true, seq: 1 }) });
  const b = O('b', CONTACT_DIST, 10 - CONTACT_DIST, { block: blk('dl', { engaged: true, seq: 2 }) });
  const ps = [a, b, DL];
  const ballPos = { x: 0, y: 10 - 3 };
  a.block.winT = SHED_TIME;
  // DL drove back against the push last tick, so this tick reads 'winning' and winT keeps running
  DL.react = startReact(DL);
  DL.react.py = DL.y + 2 * WIN_SPEED * DT;
  stepBlocking(ps, ballPos, DT, { rule: null, seq: 2 });
  assert.equal(a.block.released, 'shed');
  assert.ok(DL.shedFree > 0);
  assert.ok(DL.shedFree <= REENGAGE_DELAY + 1e-9);
  assert.equal(canEngage(b, DL, contactSpot(ps, b), ballPos), null);
});

test('separateBodies: a free body wedged against an anchor is not pushed back by a free body behind him', () => {
  const ps = [
    O('o', 0, 10, { block: blk('t', { engaged: true, seq: 1 }) }),
    D('f1', 2 * BODY_RADIUS, 10),
    D('f2', 4 * BODY_RADIUS - 0.5, 10),
  ];
  separateBodies(ps);
  assert.equal(ps[0].x, 0);
  near(ps[1].x, 2 * BODY_RADIUS, 1e-9);
  near(ps[2].x, 4 * BODY_RADIUS, 1e-9);
});
