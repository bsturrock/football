import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TECHNIQUES, PHASES, stepDir, aimPoint, driveDir, rideSign, rideDir, nextTech,
  startFoot, retargetFoot, footGoal, footPush,
} from '../src/dots/technique.js';

const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m ?? ''} ${a} vs ${b}`);
const nearPt = (p, x, y) => { near(p.x, x, 'x'); near(p.y, y, 'y'); };
const rad = (d) => (d * Math.PI) / 180;

test('stepDir every tech/shade', () => {
  for (const [t, row] of Object.entries(TECHNIQUES)) {
    for (const [s, a] of Object.entries(row.step)) {
      for (const side of [-1, 1]) nearPt(stepDir(t, s, side), side * Math.cos(rad(a)), Math.sin(rad(a)));
    }
  }
  nearPt(stepDir('zone', 'head', -1), -Math.cos(rad(60)), Math.sin(rad(60)));
  nearPt(stepDir('cutoff', 'none', 1), Math.cos(rad(10)), Math.sin(rad(10)));
  assert.equal(stepDir('nope', 'head', 1), null);
  assert.equal(stepDir('zone', 'nope', 1), null);
});

test('aimPoint', () => {
  nearPt(aimPoint({ x: 1, y: 2 }, 'zone', -1, 0.35), 0.825, 2);
  nearPt(aimPoint({ x: 1, y: 2 }, 'cutoff', -1, 0.35), 0.65, 2);
});

test('driveDir', () => {
  nearPt(driveDir('zone', { x: 0, y: 0 }, { x: 1, y: 4 }), 0, 1);
  nearPt(driveDir('combo', { x: 0, y: 0 }, null), 0, 1);
  const l = Math.atan2(1, 4);
  nearPt(driveDir('combo', { x: 0, y: 0 }, { x: 1, y: 4 }), Math.sin(l), Math.cos(l));
  nearPt(driveDir('combo', { x: 0, y: 0 }, { x: 5, y: 1 }), 0.5, Math.cos(rad(30)));
  nearPt(driveDir('combo', { x: 0, y: 0 }, { x: -1, y: -1 }), -0.5, Math.cos(rad(30)));
  nearPt(driveDir('combo', { x: 0, y: 0 }, { x: 0, y: -1 }), 0, 1);
});

test('rideSign', () => {
  assert.equal(rideSign(0, 0.29), 0);
  assert.equal(rideSign(0, 0.3), 1);
  assert.equal(rideSign(1, -0.1), 1);
  assert.equal(rideSign(1, -0.5), -1);
});

test('rideDir', () => {
  nearPt(rideDir({ x: 0, y: 1 }, 1), 0.7071067811865476, 0.7071067811865476);
  const d = { x: 0, y: 1 };
  assert.equal(rideDir(d, 0), d);
});

test('nextTech', () => {
  assert.equal(nextTech('combo'), 'climb');
  assert.equal(nextTech('zone'), 'zone');
  assert.equal(nextTech('nope'), null);
});

test('startFoot / retargetFoot', () => {
  const f = startFoot('combo', 'playside', 'MLB', { x: 1, y: 2 }, { x: 0, y: 3 });
  assert.deepEqual(f, { tech: 'combo', shade: 'playside', watch: 'MLB', phase: 'step', ox: 1, oy: 2, ride: 0, tx: 0, push: null });
  assert.equal(startFoot('nope', 'head', null, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
  const g = startFoot('combo', undefined, undefined, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(g.shade, 'none');
  assert.equal(g.watch, null);
  const clone = structuredClone(f);
  const r = retargetFoot(f, { x: 1.5, y: 2.5 }, { x: 2, y: 6 });
  assert.deepEqual(r, { tech: 'climb', shade: 'none', watch: null, phase: 'aim', ox: 1.5, oy: 2.5, ride: 0, tx: 2, push: null });
  assert.deepEqual(f, clone);
  assert.equal(retargetFoot({ ...f, tech: 'nope' }, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
});

test('footGoal', () => {
  const mk = (extra) => ({ tech: 'zone', shade: 'playside', watch: null, phase: 'step', ox: 0, oy: 0, ride: 0, tx: 0, push: null, ...extra });
  const spot = { x: 3, y: 1 };
  let foot = mk();
  let r = footGoal(foot, { x: 0, y: 0 }, spot, -1, 0.35);
  assert.equal(r.phase, 'step');
  nearPt(r.goal, -0.25 * Math.cos(rad(45)), 0.25 * Math.sin(rad(45)));
  assert.ok(!('squeeze' in r.goal));
  r = footGoal(foot, { x: 0, y: 0.25 - 1e-10 }, spot, -1, 0.35);
  assert.equal(r.phase, 'aim');
  nearPt(r.goal, 2.825, 1);
  r = footGoal(foot, { x: 0, y: 0.1 }, spot, -1, 0.35);
  assert.equal(r.phase, 'step');
  r = footGoal(mk({ phase: 'aim' }), { x: 0, y: 0 }, spot, -1, 0.35);
  assert.equal(r.phase, 'aim');
  const clone = structuredClone(foot);
  footGoal(foot, { x: 0, y: 1 }, spot, -1, 0.35);
  assert.deepEqual(foot, clone);
  assert.throws(() => footGoal(mk({ phase: 'bogus' }), { x: 0, y: 0 }, spot, -1, 0.35), /bogus/);
});

test('zone and combo take a short step at >= 45 degrees', () => {
  for (const tech of ['zone', 'combo']) {
    const row = TECHNIQUES[tech];
    assert.ok(row.stepLen <= 0.25, tech);
    for (const shade of Object.keys(row.step)) {
      assert.ok(row.step[shade] >= 45, `${tech} ${shade}`);
      for (const side of [-1, 1]) {
        const foot = startFoot(tech, shade, null, { x: 2, y: 3 }, { x: 0, y: 0 });
        const g = footGoal(foot, { x: 2, y: 3 }, { x: 0, y: 5 }, side, 0.35).goal;
        const dx = side * (g.x - 2);
        const dy = g.y - 3;
        assert.ok(Math.hypot(dx, dy) <= row.stepLen + 1e-9, `${tech} ${shade} len`);
        assert.ok(Math.atan2(dy, dx) >= rad(45) - 1e-9, `${tech} ${shade} angle`);
      }
    }
  }
});

test('footPush', () => {
  const mk = (extra) => ({ tech: 'zone', shade: 'none', watch: null, phase: 'aim', ox: 0, oy: 0, ride: 0, tx: 0, push: null, ...extra });
  let r = footPush(mk(), { x: 0.01, y: 5 }, null, 1 / 60);
  assert.equal(r.ride, 1);
  nearPt(r.push, 0.7071067811865476, 0.7071067811865476);
  r = footPush(mk({ ride: 1 }), { x: 0.001, y: 5 }, null, 1 / 60);
  assert.equal(r.ride, 1);
  r = footPush(mk(), { x: 0, y: 5 }, null, 1 / 60);
  nearPt(r.push, 0, 1);
  const c = mk({ tech: 'combo' });
  const d = driveDir('combo', { x: 0, y: 0 }, { x: 1, y: 4 });
  r = footPush(c, { x: 0, y: 0 }, { x: 1, y: 4 }, 1 / 60);
  nearPt(r.push, d.x, d.y);
  assert.equal(footPush(mk({ ride: -1 }), { x: 5, y: 0 }, null, 0).ride, -1);
  const f = mk();
  const clone = structuredClone(f);
  footPush(f, { x: 1, y: 1 }, null, 0.1);
  assert.deepEqual(f, clone);
});

test('frozen and consistent', () => {
  assert.ok(Object.isFrozen(TECHNIQUES) && Object.isFrozen(PHASES));
  for (const row of Object.values(TECHNIQUES)) {
    assert.ok(Object.isFrozen(row) && Object.isFrozen(row.step) && Object.isFrozen(row.phases));
    for (const p of row.phases) assert.ok(p in PHASES);
    assert.ok(row.phases.includes(row.retarget));
  }
  for (const p of Object.values(PHASES)) assert.ok(Object.isFrozen(p));
});
