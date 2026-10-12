import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TECHNIQUES, PHASES, stepDir, stepLenOf, techniqueLabel, HINGE_GIVE, WALL_LEAN, aimPoint, driveDir, leanDir, rotate, signedAngle, rotateToward, nextTech,
  RIDE_MAX, RIDE_FULL, RIDE_MIN, PUSH_TURN,
  startFoot, retargetFoot, footGoal, footPush, COMBO_LEAN,
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
  nearPt(stepDir('zone', 'head', -1), -Math.cos(rad(TECHNIQUES.zone.step.head)), Math.sin(rad(TECHNIQUES.zone.step.head)));
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
  const T = { x: 0, y: 0 };
  const cases = [[T, { x: 1, y: 4 }, 1], [T, { x: 1, y: 4 }, -1], [T, { x: 1, y: 4 }, undefined],
    [T, { x: 5, y: 1 }, 1], [T, { x: -1, y: -1 }, -1], [T, { x: 0, y: -1 }, undefined], [T, null, 1]];
  for (const [t, w, s] of cases) {
    const a = driveDir('combo', t, w, s);
    const b = leanDir(TECHNIQUES.combo.drive, t, w, s);
    near(a.x, b.x);
    near(a.y, b.y);
  }
});

test('leanDir watch', () => {
  const T = { x: 0, y: 0 };
  nearPt(leanDir('watch', T, null), 0, 1);
  const l = Math.atan2(1, 4);
  nearPt(leanDir('watch', T, { x: 1, y: 4 }), Math.sin(l), Math.cos(l));
  nearPt(leanDir('watch', T, { x: 5, y: 1 }), 0.5, Math.cos(rad(30)));
  nearPt(leanDir('watch', T, { x: -1, y: -1 }), -0.5, Math.cos(rad(30)));
  nearPt(leanDir('watch', T, { x: 0, y: -1 }), 0, 1);
});

// The lean moved 30 -> 40 for F-3 #3; the cases stay and are restated on COMBO_LEAN.
test('leanDir playside', () => {
  const T = { x: 0, y: 0 };
  nearPt(leanDir('playside', T, null, 1), Math.sin(rad(COMBO_LEAN)), Math.cos(rad(COMBO_LEAN)));
  nearPt(leanDir('playside', T, null, -1), -Math.sin(rad(COMBO_LEAN)), Math.cos(rad(COMBO_LEAN)));
  nearPt(leanDir('playside', T, null, undefined), 0, 1);
  nearPt(leanDir('playside', T, { x: 5, y: 1 }, 1), Math.sin(rad(COMBO_LEAN)), Math.cos(rad(COMBO_LEAN)));
  nearPt(leanDir('playside', T, { x: -1, y: -1 }, -1), -Math.sin(rad(COMBO_LEAN)), Math.cos(rad(COMBO_LEAN)));
  nearPt(leanDir('vertical', T, { x: 1, y: 4 }, 1), 0, 1);
});

test('rotate / signedAngle / rotateToward', () => {
  nearPt(rotate({ x: 1, y: 0 }, Math.PI / 2), 0, 1);
  near(signedAngle({ x: 0, y: 1 }, { x: -1, y: 0 }), Math.PI / 2);
  const t = { x: 0, y: 1 };
  nearPt(rotateToward({ x: 1, y: 0 }, t, 0.1), Math.cos(0.1), Math.sin(0.1));
  nearPt(rotateToward({ x: 1, y: 0 }, t, 3), 0, 1);
});

test('nextTech', () => {
  assert.equal(nextTech('combo'), 'climb');
  assert.equal(nextTech('zone'), 'zone');
  assert.equal(nextTech('nope'), null);
});

test('startFoot / retargetFoot', () => {
  const f = startFoot('combo', 'playside', 'MLB', { x: 1, y: 2 }, { x: 0, y: 3 });
  assert.deepEqual(f, { tech: 'combo', shade: 'playside', watch: 'MLB', phase: 'step', ox: 1, oy: 2, ride: 0, push: null });
  assert.equal(startFoot('nope', 'head', null, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
  const g = startFoot('combo', undefined, undefined, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(g.shade, 'none');
  assert.equal(g.watch, null);
  const clone = structuredClone(f);
  const r = retargetFoot(f, { x: 1.5, y: 2.5 }, { x: 2, y: 6 });
  assert.deepEqual(r, { tech: 'climb', shade: 'none', watch: null, phase: 'aim', ox: 1.5, oy: 2.5, ride: 0, push: null });
  assert.deepEqual(f, clone);
  assert.equal(retargetFoot({ ...f, tech: 'nope' }, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
});

test('footGoal', () => {
  const mk = (extra) => ({ tech: 'zone', shade: 'playside', watch: null, phase: 'step', ox: 0, oy: 0, ride: 0, tx: 0, push: null, ...extra });
  const spot = { x: 3, y: 1 };
  let foot = mk();
  let r = footGoal(foot, { x: 0, y: 0 }, spot, -1, 0.35);
  assert.equal(r.phase, 'step');
  const len = stepLenOf('zone', 'playside');
  const a = TECHNIQUES.zone.step.playside;
  nearPt(r.goal, -len * Math.cos(rad(a)), len * Math.sin(rad(a)));
  assert.ok(!('squeeze' in r.goal));
  r = footGoal(foot, { x: 0, y: len - 1e-10 }, spot, -1, 0.35);
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

test('F-55 #4: zone and combo take a short step at >= 45 degrees, except the playside reach', () => {
  for (const tech of ['zone', 'combo']) {
    const row = TECHNIQUES[tech];
    for (const shade of Object.keys(row.step)) {
      // F-55 #4: head, backside and none steps are short and steep; the playside reach is flatter and longer.
      if (shade === 'playside') {
        assert.ok(row.step[shade] < 45, `${tech} ${shade}`);
        assert.ok(stepLenOf(tech, shade) > stepLenOf(tech, 'head'), `${tech} ${shade} longer`);
      } else {
        assert.ok(row.step[shade] >= 45, `${tech} ${shade}`);
        assert.ok(stepLenOf(tech, shade) <= 0.25, `${tech} ${shade} short`);
      }
      for (const side of [-1, 1]) {
        const foot = startFoot(tech, shade, null, { x: 2, y: 3 }, { x: 0, y: 0 });
        const g = footGoal(foot, { x: 2, y: 3 }, { x: 0, y: 5 }, side, 0.35).goal;
        const dx = side * (g.x - 2);
        const dy = g.y - 3;
        assert.ok(Math.hypot(dx, dy) <= stepLenOf(tech, shade) + 1e-9, `${tech} ${shade} len`);
        if (shade !== 'playside') assert.ok(Math.atan2(dy, dx) >= rad(45) - 1e-9, `${tech} ${shade} angle`);
      }
    }
  }
});

const DT = 1 / 60;
const mkFoot = (extra) => ({ tech: 'zone', shade: 'none', watch: null, phase: 'aim', ox: 0, oy: 0, ride: 0, push: null, ...extra });
const V = { x: 0, y: 1 };
const ang = (p) => Math.atan2(p.x, p.y);
function settle(foot, target, watch, vel, contact, n = 90) {
  let f = foot;
  let r;
  for (let i = 0; i < n; i++) {
    r = footPush(f, target, watch, vel, contact, DT);
    f = { ...f, ride: r.ride, push: r.push };
  }
  return r;
}

test('footPush (a) ride toward travel scales with speed', () => {
  let r = settle(mkFoot(), { x: 0, y: 5 }, null, { x: 3, y: 0 }, V);
  near(ang(r.push), rad(RIDE_MAX));
  r = settle(mkFoot(), { x: 0, y: 5 }, null, { x: 1.5, y: 0 }, V);
  near(ang(r.push), rad(RIDE_MAX) * 1.5 / RIDE_FULL);
});

test('footPush (b) mirrored', () => {
  const r = settle(mkFoot(), { x: 0, y: 5 }, null, { x: -3, y: 0 }, V);
  near(ang(r.push), -rad(RIDE_MAX));
});

// Holds because the target is neither scraping nor coming into the drive (no along component).
test('footPush (c) ride holds under RIDE_MIN', () => {
  const r = footPush(mkFoot({ ride: 0.4, push: V }), { x: 0, y: 5 }, null, { x: RIDE_MIN - 0.01, y: 0 }, V, DT);
  near(r.ride, 0.4);
});

test('footPush squares up when the target comes downhill into the drive (climb spec case 3)', () => {
  const p0 = { x: Math.sin(0.4), y: Math.cos(0.4) };
  let f = mkFoot({ ride: 0.4, push: p0 });
  let r;
  for (let i = 0; i < Math.round(0.3 / DT); i++) {
    r = footPush(f, { x: 0, y: 5 }, null, { x: 0, y: -2 }, V, DT);
    f = { ...f, ride: r.ride, push: r.push };
  }
  assert.ok(Math.abs(r.ride) < 0.05, `ride ${r.ride}`);
  assert.ok(Math.abs(ang(r.push)) < rad(5), `push angle ${ang(r.push)}`);
});

test('footPush (d) turn bound', () => {
  const c = { x: Math.sin(rad(60)), y: Math.cos(rad(60)) };
  const r = footPush(mkFoot(), { x: 0, y: 5 }, null, { x: 0, y: 0 }, c, DT);
  const moved = Math.abs(signedAngle(c, r.push));
  assert.ok(moved > 0 && moved <= PUSH_TURN * DT + 1e-9, `moved ${moved}`);
  const f = mkFoot({ push: V, ride: 0 });
  const r2 = footPush(f, { x: 0, y: 5 }, null, { x: 3, y: 0 }, V, DT);
  assert.ok(Math.abs(signedAngle(V, r2.push)) <= PUSH_TURN * DT + 1e-9);
  const r3 = footPush(f, { x: 0, y: 5 }, null, { x: 3, y: 0 }, V, 0);
  nearPt(r3.push, 0, 1);
  near(r3.ride, 0);
});

test('footPush (e) blindside', () => {
  const r = settle(mkFoot(), { x: 0, y: 5 }, null, { x: 0, y: 0 }, { x: 1, y: 0 });
  nearPt(r.push, 1, 0);
  const c20 = { x: Math.sin(rad(20)), y: Math.cos(rad(20)) };
  const r2 = settle(mkFoot(), { x: 0, y: 5 }, null, { x: 0, y: 0 }, c20);
  nearPt(r2.push, 0, 1);
});

test('footPush (f) combo lean is the base near the contact', () => {
  const d = leanDir(TECHNIQUES.combo.drive, { x: 0, y: 0 }, { x: 1, y: 4 });
  const r = settle(mkFoot({ tech: 'combo' }), { x: 0, y: 0 }, { x: 1, y: 4 }, { x: 0, y: 0 }, V);
  nearPt(r.push, d.x, d.y);
});

test('footPush (g) pure', () => {
  const foot = mkFoot({ push: V });
  const target = { x: 1, y: 1 };
  const vel = { x: 2, y: 1 };
  const contact = { x: 0.6, y: 0.8 };
  const snap = structuredClone([foot, target, vel, contact]);
  footPush(foot, target, { x: 1, y: 2 }, vel, contact, 0.1);
  assert.deepEqual([foot, target, vel, contact], snap);
});

test('footPush (h) no wobble', () => {
  let f = mkFoot();
  const tgt = { x: 0, y: 5 };
  const step = (vel) => {
    const r = footPush(f, tgt, null, vel, V, DT);
    f = { ...f, ride: r.ride, push: r.push };
    return ang(r.push);
  };
  for (let i = 0; i < 10; i++) step({ x: 0, y: 0 });
  const fin = Math.atan2(2, 0) > 0 ? rad(RIDE_MAX) * 2 / RIDE_FULL : 0;
  let prev = ang(f.push);
  for (let i = 0; i < 60; i++) {
    const a = step({ x: 2, y: 0 });
    assert.ok(a >= prev - 1e-9, 'monotonic');
    assert.ok(a <= fin + 1e-9, 'no overshoot');
    prev = a;
  }
  assert.ok(Math.abs(prev - fin) < rad(1));
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

test('F-55 #4 techniqueLabel', () => {
  for (const tech of ['zone', 'combo']) {
    assert.equal(techniqueLabel(tech, 'playside'), 'reach');
    assert.equal(techniqueLabel(tech, 'head'), 'zone step');
    assert.equal(techniqueLabel(tech, 'backside'), 'drive');
  }
  assert.equal(techniqueLabel('zone', 'none'), 'zone step');
  assert.equal(techniqueLabel('combo', 'none'), 'square step');
  assert.equal(techniqueLabel('climb', 'head'), 'climb');
  assert.equal(techniqueLabel('cutoff', 'backside'), 'hinge');
  assert.equal(techniqueLabel('nope', 'head'), null);
  assert.equal(techniqueLabel('zone', 'nope'), null);
});

test('F-55 #4 stepLenOf', () => {
  assert.equal(stepLenOf('zone', 'head'), TECHNIQUES.zone.stepLen.head);
  assert.equal(stepLenOf('combo', 'none'), TECHNIQUES.combo.stepLen.none);
  assert.ok(stepLenOf('zone', 'playside') > stepLenOf('zone', 'head'));
  // Rows with no stepLen use the default; unknown tech falls back to it too.
  assert.equal(stepLenOf('climb', 'head'), 0.5);
  assert.equal(stepLenOf('cutoff', 'none'), 0.5);
  assert.equal(stepLenOf('nope', 'head'), 0.5);
  // The step phase reads it.
  const foot = startFoot('zone', 'head', null, { x: 0, y: 0 }, { x: 0, y: 3 });
  const g = footGoal(foot, { x: 0, y: 0 }, { x: 0, y: 3 }, 1, 0.35).goal;
  near(Math.hypot(g.x, g.y), stepLenOf('zone', 'head'));
});

test('F-55 #5 hinge: the cutoff row steps then hinges, wall spot playside of and behind the target, wall drive leans backside', () => {
  const row = TECHNIQUES.cutoff;
  assert.deepEqual([...row.phases], ['step', 'hinge']);
  assert.equal(row.retarget, 'hinge');
  assert.equal(row.drive, 'wall');
  // first step unchanged: inside/playside and flat
  nearPt(stepDir('cutoff', 'backside', 1), Math.cos(rad(10)), Math.sin(rad(10)));
  const spot = { x: 3, y: 1 };
  for (const side of [-1, 1]) {
    const foot = startFoot('cutoff', 'backside', null, { x: 0, y: 0 }, spot);
    const first = footGoal(foot, { x: 0, y: 0 }, spot, side, 0.35);
    assert.equal(first.phase, 'step');
    const after = footGoal(foot, { x: 0, y: 5 }, spot, side, 0.35);
    assert.equal(after.phase, 'hinge');
    nearPt(after.goal, spot.x + side * row.aim * 0.35, spot.y - HINGE_GIVE);
    assert.ok(side * (after.goal.x - spot.x) > 0, 'playside of the target');
    assert.ok(after.goal.y < spot.y, 'behind the target');
    const d = leanDir('wall', { x: 0, y: 0 }, null, side);
    nearPt(d, -side * Math.sin(rad(WALL_LEAN)), Math.cos(rad(WALL_LEAN)));
    nearPt(driveDir('cutoff', { x: 0, y: 0 }, null, side), d.x, d.y);
  }
  nearPt(leanDir('wall', { x: 0, y: 0 }, null, undefined), 0, 1);
  const re = retargetFoot(startFoot('cutoff', 'backside', null, { x: 0, y: 0 }, spot), { x: 1, y: 1 }, spot);
  assert.equal(re.phase, 'hinge');
});
