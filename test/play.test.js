import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, SNAP_DURATION, SIM_SPEED, SIM_SPEED_MIN, SIM_SPEED_MAX, MAX_SUBSTEP } from '../src/dots/play.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { buildLineup } from '../src/dots/roster.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

test('new play: ball held by C pre-snap', () => {
  const play = createPlay(25);
  assert.equal(play.ball.holder, 'C');
  assert.equal(play.ball.phase, 'presnap');
  const c = play.player('C');
  assert.deepEqual(play.ballPosition(), { x: c.x, y: c.y });
});

test('snap() moves to snapping; second snap() is refused', () => {
  const play = createPlay(25);
  assert.equal(play.snap(), true);
  assert.equal(play.ball.phase, 'snapping');
  assert.equal(play.ball.holder, null);
  assert.equal(play.snap(), false);
});

test('mid-snap ballPosition is the midpoint of C and QB', () => {
  const play = createPlay(25);
  play.snap();
  play.step(SNAP_DURATION / 2);
  const c = play.player('C');
  const qb = play.player('QB');
  const p = play.ballPosition();
  near(p.x, (c.x + qb.x) / 2);
  near(p.y, (c.y + qb.y) / 2);
});

test('step past the end hands ball to QB and then does nothing', () => {
  const play = createPlay(25);
  play.snap();
  play.step(SNAP_DURATION * 2);
  assert.equal(play.ball.phase, 'held');
  assert.equal(play.ball.holder, 'QB');
  assert.equal(play.ball.t, 1);
  const qb = play.player('QB');
  assert.deepEqual(play.ballPosition(), { x: qb.x, y: qb.y });
  play.step(1);
  assert.equal(play.ball.t, 1);
  assert.equal(play.ball.holder, 'QB');
  assert.equal(play.ball.phase, 'held');
});

test('snap() while held returns false', () => {
  const play = createPlay(25);
  play.snap();
  play.step(SNAP_DURATION);
  assert.equal(play.snap(), false);
});

test('reset() mid-snap after mutation restores the pre-snap state', () => {
  const play = createPlay(25);
  play.snap();
  play.step(SNAP_DURATION / 3);
  play.player('LT').x = 99;
  play.reset();
  const fresh = buildLineup(25);
  assert.deepEqual(
    play.players.map((p) => [p.id, p.x, p.y]),
    fresh.map((p) => [p.id, p.x, p.y]),
  );
  assert.equal(play.ball.holder, 'C');
  assert.equal(play.ball.phase, 'presnap');
  assert.equal(play.snap(), true);
});

test('reset() from presnap is harmless', () => {
  const play = createPlay(25);
  play.reset();
  assert.equal(play.ball.holder, 'C');
  assert.equal(play.ball.phase, 'presnap');
  assert.equal(play.ball.t, 0);
});

test('time scale: defaults to real time; SIM_SPEED is the dots page default', () => {
  assert.equal(createPlay(25).timeScale, 1);
  assert.equal(SIM_SPEED, 0.35);
});

test('time scale: snap progress advances by dt * timeScale', () => {
  const play = createPlay(25, 'base', { timeScale: 0.5 });
  play.snap();
  play.step(SNAP_DURATION);
  assert.equal(play.ball.phase, 'snapping');
  near(play.ball.t, 0.5);
  play.step(SNAP_DURATION);
  assert.equal(play.ball.phase, 'held');
});

test('time scale: half speed with double dt matches full speed', () => {
  const a = createPlay(25);
  const b = createPlay(25, 'base', { timeScale: 0.5 });
  a.snap();
  b.snap();
  for (let i = 0; i < 30; i++) {
    a.step(1 / 60);
    b.step(2 / 60);
    for (const pa of a.players) {
      const pb = b.player(pa.id);
      near(pa.x, pb.x);
      near(pa.y, pb.y);
    }
  }
});

test('time scale: setTimeScale clamps, ignores non-finite, survives reset', () => {
  const play = createPlay(25);
  assert.equal(play.setTimeScale(5), SIM_SPEED_MAX);
  assert.equal(play.timeScale, SIM_SPEED_MAX);
  assert.equal(play.setTimeScale(0), SIM_SPEED_MIN);
  assert.equal(play.timeScale, SIM_SPEED_MIN);
  play.setTimeScale(0.4);
  assert.equal(play.setTimeScale(NaN), 0.4);
  assert.equal(play.timeScale, 0.4);
  play.reset();
  assert.equal(play.timeScale, 0.4);
});

test('MAX_SUBSTEP is 1/60', () => {
  assert.equal(MAX_SUBSTEP, 1 / 60);
});

test('2x time scale with 0.05 steps matches six 1/60 steps', () => {
  const A = createPlay(25);
  const B = createPlay(25, 'base', { timeScale: 2 });
  A.snap();
  B.snap();
  for (let i = 0; i < 50; i++) {
    for (let k = 0; k < 6; k++) A.step(1 / 60);
    B.step(0.05);
    A.players.forEach((a, j) => {
      near(a.x, B.players[j].x);
      near(a.y, B.players[j].y);
    });
  }
});

for (const [label, rule] of [['default rule', undefined], ['null rule', null]]) {
  test(`no body overlap at 2x (${label})`, () => {
    const B = createPlay(25, 'base', { timeScale: 2 });
    if (rule === null) B.retargetRule = null;
    B.snap();
    for (let i = 0; i < 50; i++) {
      B.step(0.05);
      const ps = B.players;
      for (let a = 0; a < ps.length; a++) {
        for (let b = a + 1; b < ps.length; b++) {
          const d = Math.hypot(ps[a].x - ps[b].x, ps[a].y - ps[b].y);
          assert.ok(d >= 2 * BODY_RADIUS - 0.02, `${ps[a].id}/${ps[b].id} ${d}`);
        }
      }
    }
  });
}

test('no tunnelling at 2x with a 0.05 step', () => {
  const p = createPlay(25);
  p.snap();
  p.step(SNAP_DURATION + 0.01);
  p.players = p.players.filter((q) => ['QB', 'WLB', 'LG', 'RDE'].includes(q.id));
  const get = (id) => p.players.find((q) => q.id === id);
  const set = (id, x, y) => {
    get(id).x = x;
    get(id).y = y;
  };
  set('QB', 0, 40);
  set('WLB', 0, 30);
  set('RDE', 0, 5);
  set('LG', 0, 31.3);
  assert.equal(p.engage('LG', 'RDE'), true);
  p.setTimeScale(2);
  p.step(0.05);
  const w = get('WLB');
  const l = get('LG');
  assert.ok(w.y < l.y, `${w.y} ${l.y}`);
  assert.ok(Math.hypot(w.x - l.x, w.y - l.y) >= 2 * BODY_RADIUS - 1e-6);
});

const DL_IDS = ['LDE', 'LDT', 'RDT', 'RDE'];

test('F-9 #1: shiftDL(1) moves only the DL by one step; shiftDL(-1) restores', () => {
  const play = createPlay(25);
  assert.equal(play.dlShift, 0);
  const base = buildLineup(25);
  assert.equal(play.shiftDL(1), 1);
  for (const b of base) {
    const p = play.player(b.id);
    if (DL_IDS.includes(b.id)) {
      near(p.x, b.x + 0.6);
      near(p.y, b.y);
    } else {
      assert.equal(p.x, b.x, b.id);
      assert.equal(p.y, b.y, b.id);
    }
  }
  assert.equal(play.shiftDL(-1), 0);
  for (const b of base) {
    const p = play.player(b.id);
    near(p.x, b.x);
    near(p.y, b.y);
  }
});

test('F-9 #2: shift clamps at +-4 steps; invalid dir returns current shift unchanged', () => {
  const play = createPlay(25);
  const base = buildLineup(25);
  for (let i = 0; i < 5; i++) play.shiftDL(1);
  assert.equal(play.dlShift, 4);
  for (const b of base.filter((q) => DL_IDS.includes(q.id))) {
    near(play.player(b.id).x, b.x + 2.4);
  }
  const down = createPlay(25);
  for (let i = 0; i < 5; i++) down.shiftDL(-1);
  assert.equal(down.dlShift, -4);
  for (const b of base.filter((q) => DL_IDS.includes(q.id))) {
    near(down.player(b.id).x, b.x - 2.4);
  }
  for (const bad of [0, 2, 0.5, NaN]) {
    const snapshot = play.players.map((p) => [p.id, p.x, p.y]);
    assert.equal(play.shiftDL(bad), 4, String(bad));
    assert.deepEqual(play.players.map((p) => [p.id, p.x, p.y]), snapshot);
  }
});

test('F-9 #3: shiftDL is refused once the ball is live', () => {
  const play = createPlay(25);
  play.shiftDL(1);
  play.snap();
  const snapshot = play.players.map((p) => [p.id, p.x, p.y]);
  assert.equal(play.shiftDL(1), false);
  assert.equal(play.dlShift, 1);
  assert.deepEqual(play.players.map((p) => [p.id, p.x, p.y]), snapshot);
  play.step(SNAP_DURATION * 2);
  assert.equal(play.ball.phase, 'held');
  const held = play.players.map((p) => [p.id, p.x, p.y]);
  assert.equal(play.shiftDL(-1), false);
  assert.equal(play.dlShift, 1);
  assert.deepEqual(play.players.map((p) => [p.id, p.x, p.y]), held);
});

test('F-9 #4: dlShift survives reset() and reset rebuilds at the shift', () => {
  const play = createPlay(25);
  play.shiftDL(1);
  play.shiftDL(1);
  play.snap();
  play.step(1);
  play.reset();
  assert.equal(play.dlShift, 2);
  assert.equal(play.ball.phase, 'presnap');
  const base = buildLineup(25);
  for (const b of base.filter((q) => DL_IDS.includes(q.id))) {
    near(play.player(b.id).x, b.x + 1.2);
  }
});

test('F-9 #5: block assignment after snap sees the shifted D-line', () => {
  const targets = (play) =>
    Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT'].map((id) => [id, play.player(id).block.target]));

  const base = createPlay(25);
  base.snap();
  assert.deepEqual(targets(base), { LT: 'RDE', LG: 'RDT', C: 'LDT', RG: 'LDT', RT: 'LDE' });

  const right = createPlay(25);
  for (let i = 0; i < 4; i++) right.shiftDL(1);
  right.snap();
  assert.deepEqual(targets(right), { LT: 'RDE', LG: 'RDE', C: 'RDT', RG: 'RDT', RT: 'LDT' });

  const left = createPlay(25);
  for (let i = 0; i < 4; i++) left.shiftDL(-1);
  left.snap();
  assert.deepEqual(targets(left), { LT: 'RDT', LG: 'LDT', C: 'LDT', RG: 'LDE', RT: 'LDE' });
});
