import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HW } from '../src/util.js';
import {
  assignBlocks, setBlock, clearBlock, contactSpot, resolveBlock, stepBlocking,
  doubleTeamPeel, CONTACT_DIST, ENGAGE_TOL, Y_MAX, DRIVE_RATE, BODY_RADIUS, SPREAD, separateBodies, canEngage, SOFT_RATE,
  SHED_TIME, REENGAGE_DELAY, RELEASE_PAST, blockPush, BLOCK_ANGLES, blockForce, CONTACT_TURN,
  contactImpulse, carryVelocity, massOf, CONTACT_GRIP, IMPACT_TIME, ENGAGE_TAU, FOLLOW_TAU, dampedFollow,
} from '../src/dots/blocking.js';
import { hardCore } from '../src/dots/steering.js';
import { startFoot, RIDE_MIN } from '../src/dots/technique.js';
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

test('blockPush sums the blockers and counts them (n)', () => {
  assert.deepEqual(blockPush([]), { x: 0, y: 0, n: 0 });
  const o = O('a', 0, 0, { block: blk('d', { engaged: true }) });
  const one = blockPush([o]);
  assert.equal(one.n, 1);
  near(one.x, blockForce(o) * BLOCK_ANGLES.straight.x);
  near(one.y, blockForce(o) * BLOCK_ANGLES.straight.y);
  const two = blockPush([o, O('b', 1, 0, { block: blk('d', { engaged: true }) })]);
  assert.equal(two.n, 2);
  near(two.x, 2 * one.x);
  near(two.y, 2 * one.y);
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
  const g = resolveBlock(ps[1], engagedOnList(ps), goal);
  const kd = 1 - Math.exp(-DT / ENGAGE_TAU);
  stepBlocking(ps, goal, DT, { rule: null, seq: 1 });
  near(ps[1].y, 10 + kd * g.vy * DT, 1e-12);
  near(ps[1].x, 0 + kd * g.vx * DT, 1e-12);
  // the blocker rides the defender's displacement plus the damped correction toward his spot
  const b0 = { x: 0.05, y: 10 - CONTACT_DIST };
  const q = [O('a', b0.x, b0.y, { vel: { x: 1, y: 0 }, block: blk('d', { engaged: true, seq: 1 }) }), D('d', 0, 10)];
  stepBlocking(q, goal, DT, { rule: null, seq: 1 });
  const T = q[1];
  const dT = { x: T.x - 0, y: T.y - 10 };
  const fa0 = Math.atan2(T.x - b0.x, T.y - b0.y); // contact line blocker -> (moved) target
  const fa = fa0 - Math.sign(fa0) * Math.min(Math.abs(fa0), CONTACT_TURN * DT); // turns toward straight
  near(q[0].block.fa, fa, 1e-12);
  const spot = { x: T.x - Math.sin(fa) * CONTACT_DIST, y: T.y - Math.cos(fa) * CONTACT_DIST };
  const sx = dampedFollow(b0.x + dT.x - spot.x, 1 - 0, DT, FOLLOW_TAU);
  const sy = dampedFollow(b0.y + dT.y - spot.y, 0 - 0, DT, FOLLOW_TAU);
  assert.ok(Math.hypot(spot.x + sx.e - b0.x, spot.y + sy.e - b0.y) < 6 * DT, 'speed cap not binding');
  near(q[0].x, spot.x + sx.e, 1e-12);
  near(q[0].y, spot.y + sy.e, 1e-12);
  near(q[0].block.fu.x, sx.u, 1e-12); near(q[0].block.fu.y, sy.u, 1e-12);
  const ps2 = [O('a', 0, Y_MAX - 0.3 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 1 }) }), D('d', 0, Y_MAX - 0.3)];
  for (let i = 0; i < 20000; i++) stepBlocking(ps2, goal, DT, { rule: null, seq: 1 });
  assert.equal(ps2[1].y, Y_MAX);
  const s = contactSpot(ps2, ps2[0]);
  near(ps2[0].x, s.x, 1e-9); near(ps2[0].y, s.y, 1e-9);
});

test('contactImpulse head-on closing: equal masses meet at the mean normal speed, momentum conserved', () => {
  const d = { x: 0, y: 1, strength: 1, vel: { x: 0, y: 1 } };
  const b = { x: 0, y: 0, strength: 1, vel: { x: 0, y: 5 } };
  const i = contactImpulse(d, b);
  near(d.vel.y + i.d.y, 3); near(b.vel.y + i.b.y, 3);
  near(massOf(d) * i.d.y + massOf(b) * i.b.y, 0);
  near(i.d.x, 0); near(i.b.x, 0);
});

test('contactImpulse separating has no normal part, zero when coincident', () => {
  const d = { x: 0, y: 1, strength: 1, vel: { x: 0, y: 5 } };
  const b = { x: 0, y: 0, strength: 1, vel: { x: 0, y: 1 } };
  const i = contactImpulse(d, b);
  near(i.d.y, 0); near(i.b.y, 0);
  const z = contactImpulse({ x: 1, y: 1, strength: 1 }, { x: 1, y: 1, strength: 1, vel: { x: 3, y: 3 } });
  assert.deepEqual(z, { d: { x: 0, y: 0 }, b: { x: 0, y: 0 } });
});

test('contactImpulse grips the defender sliding only', () => {
  const d = { x: 0, y: 1, strength: 1, vel: { x: 4, y: 0 } };
  const b = { x: 0, y: 0, strength: 1, vel: { x: -2, y: 0 } };
  const i = contactImpulse(d, b);
  near(i.d.x, -CONTACT_GRIP * 4); near(i.d.y, 0);
  near(i.b.x, 0); near(i.b.y, 0);
});

test('contactImpulse weights by mass: the heavier body changes less', () => {
  const d = { x: 0, y: 1, strength: 3, vel: { x: 0, y: 0 } };
  const b = { x: 0, y: 0, strength: 1, vel: { x: 0, y: 4 } };
  const i = contactImpulse(d, b);
  near(i.d.y, 1); near(i.b.y, -3);
  near(massOf(d) * i.d.y + massOf(b) * i.b.y, 0);
});

test('carryVelocity relaxes toward the goal; the easing acts on the post-hit velocity while the impact counts down', () => {
  const k = 1 - Math.exp(-DT / 0.2);
  const v = carryVelocity({ x: 1, y: 0 }, { x: 0, y: 2 }, null, DT, 0.2);
  near(v.vx, 1 - k, 1e-12); near(v.vy, 2 * k, 1e-12);
  // R0 = impulse still to deliver = (15, -30) * DT; this tick delivers kick = (10, -20) * DT. The easing
  // acts on prev + R0 and the undelivered rest is taken back out: v = (R0)(1 - k) - (R0 - kick).
  const imp = { ax: 10, ay: -20, t: DT * 1.5 };
  const w = carryVelocity({ x: 0, y: 0 }, { x: 0, y: 0 }, imp, DT, 0.2);
  near(w.vx, 10 * DT - k * 15 * DT, 1e-12); near(w.vy, -20 * DT + k * 30 * DT, 1e-12);
  near(w.kick.x, 10 * DT, 1e-12); near(w.kick.y, -20 * DT, 1e-12);
  near(imp.t, DT * 0.5, 1e-12);
  const w2 = carryVelocity({ x: w.vx, y: w.vy }, { x: 0, y: 0 }, imp, DT, 0.2);
  assert.ok(imp.t <= 0);
  // the window is over: the velocity is the whole impulse, eased over both ticks
  near(w2.vx, 15 * DT * (1 - k) ** 2, 1e-12); near(w2.vy, -30 * DT * (1 - k) ** 2, 1e-12);
  const z = carryVelocity({ x: 0, y: 0 }, { x: 0, y: 0 }, imp, DT, 0.2);
  near(z.vx, 0, 1e-12); near(z.vy, 0, 1e-12);
  near(z.kick.x, 0, 1e-12); near(z.kick.y, 0, 1e-12);
  assert.ok(IMPACT_TIME > 0);
});

test('R-71: a head-on hit takes the defender to the common velocity and eases him to the goal, no overshoot', () => {
  // A linebacker sliding into a climbing blocker at 5.9 yd/s (R-71's WIL: vy -5.88), the block-resolved
  // goal pointing back at 0.8 yd/s. The blocker's speed is set so the common velocity is R-71's +0.37.
  const d = D('d', 0, 10, { strength: 0.5, vel: { x: 0, y: -5.9 } });
  const md = massOf(d);
  const mb = 1;
  const common = 0.37;
  const b = O('b', 0, 10 - CONTACT_DIST, { strength: mb, vel: { x: 0, y: (common * (md + mb) - md * -5.9) / mb } });
  const goal = { x: 0, y: 0.8 };
  for (const dt of [DT, IMPACT_TIME / 2.5]) {
    const imp = contactImpulse(d, b);
    near(d.vel.y + imp.d.y, common, 1e-9);
    const impact = { ax: imp.d.x / IMPACT_TIME, ay: imp.d.y / IMPACT_TIME, t: IMPACT_TIME };
    const window = Math.ceil(IMPACT_TIME / dt - 1e-9);
    const cap = Math.max(common, goal.y);
    let v = { x: d.vel.x, y: d.vel.y };
    let prev = -Infinity;
    for (let i = 0; i < window + 20; i++) {
      const s = carryVelocity(v, goal, impact, dt, ENGAGE_TAU);
      v = { x: s.vx, y: s.vy };
      assert.ok(v.y <= cap + 1e-9, `dt ${dt} tick ${i}: velocity ${v.y} past ${cap}`);
      if (i >= window - 1) {
        assert.ok(v.y >= prev - 1e-12, `dt ${dt} tick ${i}: ${prev} -> ${v.y} not monotone toward the goal`);
        prev = v.y;
      }
    }
    // at the end of the window it is exactly the post-hit velocity eased over the window
    const after = { ax: impact.ax, ay: impact.ay, t: IMPACT_TIME };
    let u = { x: d.vel.x, y: d.vel.y };
    for (let i = 0; i < window; i++) {
      const s = carryVelocity(u, goal, after, dt, ENGAGE_TAU);
      u = { x: s.vx, y: s.vy };
    }
    near(u.y, goal.y + (common - goal.y) * Math.exp(-(window * dt) / ENGAGE_TAU), 1e-9);
  }
});

test('dampedFollow: an error decays monotonically to 0 with no sign change', () => {
  let s = { e: 1, u: 0 };
  let prev = 1;
  for (let i = 0; i < 600; i++) {
    s = dampedFollow(s.e, s.u, DT, FOLLOW_TAU);
    assert.ok(s.e >= 0, `tick ${i}: sign change ${s.e}`);
    assert.ok(s.e <= prev + 1e-15, `tick ${i}: grew ${prev} -> ${s.e}`);
    prev = s.e;
  }
  assert.ok(Math.abs(s.e) < 1e-6 && Math.abs(s.u) < 1e-6, `not settled: ${s.e}, ${s.u}`);
});

test('dampedFollow: a ramp-then-hold spot is followed with no overshoot', () => {
  // follower position p tracks spot q; e = p - q. The spot ramps at 1.5 yd/s for 0.4 s, then holds.
  let p = 0;
  let q = 0;
  let u = 0; // follower velocity; the spot's own rate is not fed in
  for (let i = 0; i < 240; i++) {
    const rate = i < 24 ? 1.5 : 0;
    q += rate * DT;
    const s = dampedFollow(p - q, u, DT, FOLLOW_TAU);
    p = q + s.e;
    u = s.u;
    assert.ok(p <= q + 1e-12, `tick ${i}: overshot the spot by ${p - q}`);
  }
  near(p, q, 1e-6);
});

test('dampedFollow is exact: many small steps equal one large step', () => {
  const big = dampedFollow(0.7, -2, 0.3, FOLLOW_TAU);
  let s = { e: 0.7, u: -2 };
  for (let i = 0; i < 300; i++) s = dampedFollow(s.e, s.u, 0.001, FOLLOW_TAU);
  near(s.e, big.e, 1e-9);
  near(s.u, big.u, 1e-9);
});

test('a hit gives the defender his whole impulse over IMPACT_TIME (the blocker pass keeps his impact)', () => {
  const d = D('d', 0, 10, { speed: 0, strength: 0.6, vel: { x: 0, y: 0 } });
  const a = O('a', -CONTACT_DIST - 0.02, 10, { facing: Math.PI / 2, vel: { x: 4, y: 0 }, block: blk('d') });
  const ps = [a, d];
  const ctx = { rule: null, seq: 0 };
  const ball = { x: 0, y: -50 };
  const imp = contactImpulse(d, a);
  assert.ok(imp.d.x > 1, `impulse ${imp.d.x}`);
  stepBlocking(ps, ball, DT, ctx);
  assert.ok(a.block.engaged, 'engages on the first pass');
  stepBlocking(ps, ball, DT, ctx);
  assert.ok(d.impact, 'impact survives the pass after the engage');
  let best = d.vel.x;
  for (let i = 0; i < Math.ceil(IMPACT_TIME / DT); i++) {
    stepBlocking(ps, ball, DT, ctx);
    best = Math.max(best, d.vel.x);
  }
  // R-71: the easing acts on the post-hit velocity from the hit on, so by the end of the window the
  // whole impulse has been delivered and eased for IMPACT_TIME (block-resolved goal x is 0 here).
  const eased = imp.d.x * Math.exp(-IMPACT_TIME / ENGAGE_TAU);
  assert.ok(best >= 0.8 * eased, `defender x velocity ${best} of eased impulse ${eased}`);
  assert.equal(d.impact, null);
});

test('blindside (F-49 #8): a hit from the side carries the defender along and pushes the blocker with it', () => {
  const d = D('d', 0, 10, { speed: 1, vel: { x: 0, y: 0.5 } });
  const a = O('a', -CONTACT_DIST - 0.05, 10, { facing: Math.PI / 2, vel: { x: 5, y: 0 } });
  a.block = blk('d', { foot: startFoot('zone', 'head', null, a, d) });
  const ps = [a, d];
  const ctx = { rule: null, seq: 0, side: 1 };
  let ticks = 0;
  while (!a.block.engaged && ticks < 5) { stepBlocking(ps, { x: 0, y: 0 }, DT, ctx); ticks++; }
  assert.ok(a.block.engaged, 'engages within 5 ticks');
  for (let i = 0; i < 12; i++) {
    const x0 = d.x;
    stepBlocking(ps, { x: 0, y: 0 }, DT, ctx);
    assert.ok((d.x - x0) / DT > 0, `tick ${i}: defender x velocity ${(d.x - x0) / DT}`);
    assert.ok(a.block.foot.push.x > 0, `tick ${i}: push.x ${a.block.foot.push.x}`);
  }
});

const minPair = (ps) => Math.min(...ps.flatMap((p, i) => ps.slice(i + 1).map((q) => Math.hypot(p.x - q.x, p.y - q.y))));

test('inelastic separation: an engaged defender driven into a stationary anchored body stops there, no rebound', () => {
  const u = Math.SQRT1_2;
  // d (no strength of his own, sliding in at 2 yd/s) is driven up and right by b; d2 sits on that line,
  // anchored by b2, whose push d2 exactly matches (equal strength, goal straight back), so d2 is stationary.
  const d = D('d', 0, 10, { strength: 0, vel: { x: 2 * u, y: 2 * u } });
  const b = O('b', -CONTACT_DIST * u, 10 - CONTACT_DIST * u, { block: blk('d', { engaged: true, seq: 1, angle: 'right' }) });
  const d2 = D('d2', 0.8 * u, 10 + 0.8 * u, { strength: 1 });
  const b2 = O('b2', d2.x + CONTACT_DIST * u, d2.y - CONTACT_DIST * u, { block: blk('d2', { engaged: true, seq: 2, angle: 'left' }) });
  const ps = [b, d, b2, d2];
  const ctx = { rule: null, seq: 2, fightBlocks: false, defGoals: { d: { x: 0, y: -40 }, d2: { x: d2.x + 40, y: d2.y - 40 } } };
  let contact = null;
  for (let i = 0; i < 120 && (contact === null || i <= contact + 15); i++) {
    stepBlocking(ps, { x: 0, y: -40 }, DT, ctx);
    const dist = Math.hypot(d.x - d2.x, d.y - d2.y);
    if (contact === null && dist < 2 * BODY_RADIUS) contact = i;
    if (contact === null || i === contact) continue;
    const away = (d.vel.x * (d.x - d2.x) + d.vel.y * (d.y - d2.y)) / dist;
    assert.ok(away <= 0.05, `tick ${i - contact} after contact: ${away.toFixed(3)} yd/s away from the body`);
    assert.ok(b.block.engaged && b2.block.engaged, `tick ${i}: blocks hold`);
  }
  assert.ok(contact !== null, 'd reaches d2');
});

test('a rider cannot carry a third body: an engaged blocker yields to another engaged defender', () => {
  const u = Math.SQRT1_2;
  // c rides m playside (+x) at about 1.3 yd/s; d, engaged by b, is in c's path (not m's) and b pushes him
  // back toward c. When c reaches d, c is held up; d is not dragged along in c's direction of travel.
  const m = D('m', 0, 10, { strength: 0.707 });
  const c = O('c', -CONTACT_DIST * u, 10 - CONTACT_DIST * u, { block: blk('m', { engaged: true, seq: 1, angle: 'right' }) });
  const d = D('d', 1.0, c.y - 0.3, { strength: 0.707 });
  const b = O('b', d.x + CONTACT_DIST * u, d.y - CONTACT_DIST * u, { block: blk('d', { engaged: true, seq: 2, angle: 'left' }) });
  const ps = [c, m, b, d];
  const H = hardCore(BODY_RADIUS);
  const ctx = { rule: null, seq: 2, fightBlocks: false, defGoals: { m: { x: 40, y: -30 }, d: { x: d.x + 24, y: d.y - 32 } } };
  let contact = null;
  let travel = null;
  let fastest = 0;
  for (let i = 0; i < 120 && (contact === null || i <= contact + 20); i++) {
    stepBlocking(ps, { x: 0, y: -40 }, DT, ctx);
    assert.ok(minPair(ps) >= H - 1e-9, `tick ${i}: a pair is closer than H`);
    if (contact === null) {
      fastest = Math.max(fastest, Math.hypot(c.vel.x, c.vel.y));
      if (Math.hypot(c.x - d.x, c.y - d.y) < 2 * BODY_RADIUS) {
        contact = i;
        const s = Math.hypot(c.vel.x, c.vel.y);
        travel = { x: c.vel.x / s, y: c.vel.y / s };
      }
      continue;
    }
    const along = d.vel.x * travel.x + d.vel.y * travel.y;
    assert.ok(along < RIDE_MIN, `tick ${i - contact} after contact: d moves ${along.toFixed(2)} yd/s in c's direction`);
  }
  assert.ok(contact !== null, 'c reaches d');
  assert.ok(fastest >= 1.2 && travel.x > 0.9, `c rides m playside before the contact (${fastest.toFixed(2)} yd/s)`);
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

test('T-118: a free defender with a goal stops at CONTACT_DIST from the ball', () => {
  const ballAt = (p) => ({ x: p.x, y: p.y });
  const holder = O('rb', 0, 10 - CONTACT_DIST - 0.05);
  const ps = [D('d', 0, 10), holder];
  const ball = ballAt(holder);
  const ctx = { rule: null, seq: 0, defGoals: { d: { x: holder.x, y: holder.y, key: 'def:pursue', rate: 7 } } };
  const before = Math.hypot(ball.x - ps[0].x, ball.y - ps[0].y);
  stepBlocking(ps, ball, DT, ctx);
  const after = Math.hypot(ball.x - ps[0].x, ball.y - ps[0].y);
  assert.ok(after >= CONTACT_DIST - 1e-9, `distance ${after} below CONTACT_DIST`);
  assert.ok(after < before, 'defender moved toward the ball');
});

test('T-118: a free defender already at CONTACT_DIST holds still', () => {
  const d = D('d', 0, CONTACT_DIST - 0.01);
  const ps = [d];
  const ball = { x: 0, y: 0 };
  const ctx = { rule: null, seq: 0, defGoals: { d: { x: 0, y: 0, key: 'def:pursue', rate: 7 } } };
  stepBlocking(ps, ball, DT, ctx);
  near(ps[0].x, 0, 1e-9);
  near(ps[0].y, CONTACT_DIST - 0.01, 1e-9);
});

test('T-118: a goal far from the ball still moves a free defender g.rate * DT', () => {
  const holder = O('rb', -10, 0);
  const d = D('d', 0, 0);
  const ps = [d, holder];
  const ball = { x: -10, y: 0 };
  const g = { x: 10, y: 10, key: 'def:gap', rate: 6 };
  const start = Math.hypot(g.x - d.x, g.y - d.y);
  stepBlocking(ps, ball, DT, { rule: null, seq: 0, defGoals: { d: g } });
  const moved = Math.hypot(d.x, d.y);
  near(moved, 6 * DT, 1e-6);
  assert.ok(Math.hypot(g.x - ps[0].x, g.y - ps[0].y) < start);
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

test('F-41 #2: an engaged blocker follows his spot before the lost check', () => {
  const ps = [O('a', 0, 10 - (CONTACT_DIST + ENGAGE_TOL - 0.005), { block: blk('d', { engaged: true, seq: 1, held: 0, winT: 0 }) }), D('d', 0, 10)];
  stepBlocking(ps, { x: 0, y: 0 }, DT, { rule: null, seq: 1 });
  assert.equal(ps[0].block.engaged, true);
  assert.notEqual(ps[0].block.released, 'lost');
});

test('F-49 #1: p.vel is the displacement over the stepBlocking pass divided by dt', () => {
  const free = D('f', 0, 10, { speed: 6 });
  const still = D('s', 5, 10, { speed: 0 });
  const ps = [free, still];
  stepBlocking(ps, { x: 0, y: -50 }, DT, { rule: null, seq: 0, defGoals: { f: { x: 3, y: 10, rate: 3, key: 'g' } } });
  near(free.vel.x, free.x / DT, 1e-6);
  near(free.vel.y, (free.y - 10) / DT, 1e-6);
  assert.ok(free.vel.x > 0);
  assert.deepEqual(still.vel, { x: 0, y: 0 });
});

test('F-49 #4: canEngage contact uses the blocker facing', () => {
  const T = D('d', 0.5, 10, { speed: 0 });
  const mkB = (o) => O('b', 0.5 - CONTACT_DIST, 10, { block: blk('d'), ...o });
  const far = { x: 20, y: 10 };
  const spot = { x: 5, y: 5 }; // away from the blocker, so only 'contact' can match
  assert.equal(canEngage(mkB({ facing: Math.PI / 2 }), T, spot, far), 'contact');
  assert.equal(canEngage(mkB({ facing: -Math.PI / 2 }), T, spot, far), null);
  // missing facing reads as upfield: a target level with the blocker (dot 0) counts
  assert.equal(canEngage(mkB({}), T, spot, far), 'contact');
  const behind = O('b', 0.5, 10 + CONTACT_DIST, { block: blk('d') });
  assert.equal(canEngage(behind, T, spot, far), null);
});

test('F-49 #5: a lone engaged blocker keeps his side and turns gradually', () => {
  const a36 = (36 * Math.PI) / 180;
  const T = D('d', 0, 10, { speed: 0, strength: 2 });
  const b = O('b', -CONTACT_DIST * Math.cos(a36), 10 - CONTACT_DIST * Math.sin(a36), {
    block: blk('d', { engaged: true, seq: 1, held: 0, winT: 0 }),
  });
  const ps = [b, T];
  const bearing = () => Math.atan2(b.x - T.x, b.y - T.y);
  let prev = bearing();
  for (let i = 0; i < 10; i++) {
    stepBlocking(ps, { x: 0, y: 0 }, DT, { rule: null, seq: 1 });
    const now = bearing();
    assert.ok(Math.abs(now - prev) <= CONTACT_TURN * DT + 0.02, `tick ${i} turned ${Math.abs(now - prev)}`);
    prev = now;
    if (i === 8) assert.ok(b.x < T.x, `snapped under the defender: dx ${b.x - T.x}`);
  }
});

test('F-49 #5: two engaged on one target still take the contactSpot group placement', () => {
  const T = D('d', 0, 10, { speed: 0 });
  const mkE = (id, x) => O(id, x, 10 - CONTACT_DIST, { block: blk('d', { engaged: true, seq: 1, held: 0, winT: 0 }) });
  const ps = [mkE('a', -0.1), mkE('b', 0.1), T];
  const spots = ps.slice(0, 2).map((p) => contactSpot(ps, p));
  assert.ok(Math.hypot(spots[0].x - spots[1].x, spots[0].y - spots[1].y) >= 2 * BODY_RADIUS - 1e-9);
  for (let i = 0; i < 120; i++) stepBlocking(ps, { x: 0, y: 0 }, DT, { rule: null, seq: 1 });
  const fin = ps.slice(0, 2).map((p) => contactSpot(ps, p));
  assert.ok(Math.hypot(fin[0].x - fin[1].x, fin[0].y - fin[1].y) >= 2 * BODY_RADIUS - 1e-9);
  assert.ok(Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) >= hardCore(BODY_RADIUS) - 1e-6);
});

test('F-49 #10: a lone footless blocker settles straight below a still target without wobble', () => {
  const T = D('d', 0, 10, { speed: 0 });
  const a60 = (60 * Math.PI) / 180;
  const b = O('b', -CONTACT_DIST * Math.sin(a60), 10 - CONTACT_DIST * Math.cos(a60), {
    block: blk('d', { engaged: true, seq: 1, held: 0, winT: 0 }),
  });
  const ps = [b, T];
  const bearing = () => Math.atan2(b.x - T.x, T.y - b.y); // 0 = straight below the target
  let prev = bearing();
  assert.ok(prev < 0);
  let settled = false;
  for (let i = 0; i < 90; i++) {
    stepBlocking(ps, { x: 0, y: 10 }, DT, { rule: null, seq: 1, defGoals: { d: { x: 0, y: 10, rate: 0 } } });
    const now = bearing();
    assert.ok(now >= prev - 1e-6, `tick ${i} bearing went back ${prev} -> ${now}`);
    assert.ok(now <= 1e-6 + (0.5 * Math.PI) / 180, `tick ${i} overshot straight below: ${now}`);
    if (settled) assert.ok(Math.abs(now) <= (0.5 * Math.PI) / 180, `tick ${i} left the settle band: ${now}`);
    if (Math.abs(now) <= (0.5 * Math.PI) / 180) settled = true;
    prev = now;
  }
  assert.ok(settled, `never settled, bearing ${prev}`);
});
