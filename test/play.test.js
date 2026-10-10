import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, SNAP_DURATION, SIM_SPEED, SIM_SPEED_MIN, SIM_SPEED_MAX, MAX_SUBSTEP, FIXED_DT, DL_SHIFT_STEP, LB_SHIFT_STEP } from '../src/dots/play.js';
import { BODY_RADIUS, assignBlocks } from '../src/dots/blocking.js';
import { buildLineup, FRONTS, DL_ROLES, LB_ROLES, PERSONNEL, PLAYS } from '../src/dots/roster.js';
import { numberPlay } from '../src/dots/numbering.js';
import { zonePlan } from '../src/dots/zone.js';
import { hardCore } from '../src/dots/steering.js';

const H = hardCore(BODY_RADIUS);

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

test('mid-snap ballPosition is the C to QB lerp at ball.t', () => {
  const play = createPlay(25);
  play.snap();
  for (let i = 0; i < 7; i++) play.step(FIXED_DT);
  const t = play.ball.t;
  assert.ok(t > 0 && t < 1);
  const c = play.player('C');
  const qb = play.player('QB');
  const p = play.ballPosition();
  near(p.x, c.x + (qb.x - c.x) * t);
  near(p.y, c.y + (qb.y - c.y) * t);
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
  for (let i = 0; i < 6; i++) play.step(2 * FIXED_DT);
  assert.equal(play.ball.phase, 'snapping');
  assert.equal(play.ticks, 6);
  near(play.ball.t, (6 * FIXED_DT) / SNAP_DURATION);
  play.step(SNAP_DURATION * 2);
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
          assert.ok(d >= H - 0.02, `${ps[a].id}/${ps[b].id} ${d}`);
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
  assert.ok(Math.hypot(w.x - l.x, w.y - l.y) >= H - 1e-6);
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
      near(p.x, b.x + DL_SHIFT_STEP);
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
    near(play.player(b.id).x, b.x + 4 * DL_SHIFT_STEP);
  }
  const down = createPlay(25);
  for (let i = 0; i < 5; i++) down.shiftDL(-1);
  assert.equal(down.dlShift, -4);
  for (const b of base.filter((q) => DL_IDS.includes(q.id))) {
    near(down.player(b.id).x, b.x - 4 * DL_SHIFT_STEP);
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
    near(play.player(b.id).x, b.x + 2 * DL_SHIFT_STEP);
  }
});

test('F-9 #5: block assignment after snap sees the shifted D-line', () => {
  const targets = (play) =>
    Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT'].map((id) => [id, play.player(id).block.target]));

  // nearest-defender oracle: assign blocks on a lineup shifted by k steps, no snap involved
  const blockOracle = (k) => {
    const ps = buildLineup(25, 'base', { dlShift: k * DL_SHIFT_STEP });
    assignBlocks(ps);
    return Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT'].map((id) => [id, ps.find((p) => p.id === id).block.target]));
  };

  const base = createPlay(25);
  base.snap();
  assert.deepEqual(targets(base), { LT: 'RDE', LG: 'RDT', C: 'LDT', RG: 'LDT', RT: 'LDE' });

  const right = createPlay(25);
  for (let i = 0; i < 4; i++) right.shiftDL(1);
  right.snap();
  assert.deepEqual(targets(right), blockOracle(4));
  assert.notDeepEqual(targets(right), targets(base));

  const left = createPlay(25);
  for (let i = 0; i < 4; i++) left.shiftDL(-1);
  left.snap();
  assert.deepEqual(targets(left), blockOracle(-4));
  assert.notDeepEqual(targets(left), targets(base));
});

const FRONT_KEYS = Object.keys(FRONTS);
const defIds = (k) => new Set(FRONTS[k].defenders.map((d) => d.id));
const posOf = (players) => Object.fromEntries(players.map((p) => [p.id, [p.x, p.y]]));

test('F-18 #3: front defaults to base and is set by createPlay opts', () => {
  const play = createPlay(25);
  assert.equal(play.front, 'base');
  assert.deepEqual(posOf(play.players), posOf(buildLineup(25)));

  const bear = createPlay(25, 'insideZone', { front: 'bear' });
  assert.equal(bear.front, 'bear');
  const bearIds = new Set(bear.players.map((p) => p.id));
  for (const id of defIds('bear')) assert.ok(bearIds.has(id), id);
  assert.deepEqual(posOf(bear.players), posOf(buildLineup(25, 'insideZone', { front: 'bear' })));
});

test('F-18 #3: setFront swaps the defense, keeps offense, rejects unknown keys', () => {
  const play = createPlay(25, 'insideZone');
  const offenseBefore = posOf(play.players.filter((p) => p.team === 'offense'));
  assert.equal(play.setFront('odd34'), 'odd34');
  assert.equal(play.front, 'odd34');
  const expected = buildLineup(25, 'insideZone', { front: 'odd34' });
  assert.deepEqual(posOf(play.players), posOf(expected));
  assert.deepEqual(posOf(play.players.filter((p) => p.team === 'offense')), offenseBefore);
  for (const d of FRONTS.odd34.defenders) {
    const p = play.player(d.id);
    near(p.x, d.dx);
    near(p.y, 25 + d.dy);
  }

  const before = posOf(play.players);
  assert.equal(play.setFront('nope'), false);
  assert.equal(play.front, 'odd34');
  assert.deepEqual(posOf(play.players), before);
});

test('F-18 #3: setFront is refused once the ball is live; reset keeps the front', () => {
  const play = createPlay(25, 'insideZone');
  play.setFront('bear');
  play.snap();
  const snapshot = posOf(play.players);
  assert.equal(play.setFront('odd34'), false);
  assert.equal(play.front, 'bear');
  assert.deepEqual(posOf(play.players), snapshot);

  play.reset();
  assert.equal(play.front, 'bear');
  assert.deepEqual(posOf(play.players), posOf(buildLineup(25, 'insideZone', { front: 'bear' })));
});

test('F-18 #4: shiftDL and shiftLB move the front role players for every front', () => {
  for (const k of FRONT_KEYS) {
    const play = createPlay(25, 'insideZone');
    assert.equal(play.setFront(k), k);
    const before = posOf(play.players);
    assert.equal(play.shiftDL(1), 1, k);
    for (const p of play.players) {
      const [x0, y0] = before[p.id];
      if (DL_ROLES.includes(p.role)) {
        near(p.x, x0 + DL_SHIFT_STEP);
        near(p.y, y0);
      } else {
        assert.equal(p.x, x0, `${k} ${p.id}`);
        assert.equal(p.y, y0, `${k} ${p.id}`);
      }
    }

    const lbBefore = posOf(play.players);
    assert.equal(play.shiftLB(1), 1, k);
    for (const p of play.players) {
      const [x0, y0] = lbBefore[p.id];
      if (LB_ROLES.includes(p.role)) {
        near(p.x, x0 + LB_SHIFT_STEP);
        near(p.y, y0);
      } else {
        assert.equal(p.x, x0, `${k} ${p.id}`);
        assert.equal(p.y, y0, `${k} ${p.id}`);
      }
    }
  }
});

test('F-18 #4: dlShift survives setFront', () => {
  const play = createPlay(25, 'insideZone');
  play.shiftDL(1);
  play.shiftDL(1);
  assert.equal(play.setFront('bear'), 'bear');
  assert.equal(play.dlShift, 2);
  for (const d of FRONTS.bear.defenders.filter((q) => DL_ROLES.includes(q.role))) {
    near(play.player(d.id).x, d.dx + 2 * DL_SHIFT_STEP);
  }
});

test('F-18 #5: numbering, blocks and run follow the set front for every front', () => {
  for (const k of FRONT_KEYS) {
    const play = createPlay(25, 'insideZone', { front: k });
    assert.equal(play.front, k);
    assert.deepEqual(
      play.numbers,
      numberPlay(play.players, { los: 25, centerId: 'C', playside: 'left' }),
      k,
    );
    const ids = defIds(k);
    for (const id of Object.keys(play.numbers)) {
      if (play.player(id)?.team === 'defense') assert.ok(ids.has(id), `${k} ${id}`);
    }

    play.snap();
    for (const p of play.players) {
      if (p.role === 'OL' && p.block) assert.ok(ids.has(p.block.target), `${k} ${p.id} -> ${p.block.target}`);
    }
    for (let i = 0; i < 180; i++) play.step(1 / 60);
    assert.equal(play.run.carried, true, k);
  }
});

test('F-39 #3: personnel defaults to the play personnel and is set by createPlay opts', () => {
  const te = createPlay(25, 'insideZone', { personnel: 'te' });
  assert.equal(te.personnel, 'te');
  const tes = te.players.filter((p) => p.role === 'TE');
  assert.equal(tes.length, 1);

  const def = createPlay(25, 'insideZone');
  assert.equal(def.personnel, PLAYS.insideZone.personnel ?? 'noTe');
  assert.deepEqual(posOf(def.players), posOf(buildLineup(25, 'insideZone')));
});

test('F-39 #3: setPersonnel adds and removes the TE, rejects unknown keys', () => {
  const play = createPlay(25, 'insideZone');
  assert.equal(play.players.some((p) => p.role === 'TE'), false);

  assert.equal(play.setPersonnel('te'), 'te');
  assert.equal(play.personnel, 'te');
  assert.equal(play.players.filter((p) => p.role === 'TE').length, 1);

  const before = posOf(play.players);
  assert.equal(play.setPersonnel('nope'), false);
  assert.equal(play.personnel, 'te');
  assert.deepEqual(posOf(play.players), before);

  assert.equal(play.setPersonnel('noTe'), 'noTe');
  assert.equal(play.players.some((p) => p.role === 'TE'), false);
});

test('F-39 #3: setPersonnel is refused once the ball is live; reset, setFront and shiftDL keep it', () => {
  const play = createPlay(25, 'insideZone');
  play.setPersonnel('te');
  assert.equal(play.setFront('odd34'), 'odd34');
  assert.equal(play.personnel, 'te');
  assert.equal(play.players.filter((p) => p.role === 'TE').length, 1);
  assert.equal(play.shiftDL(1), 1);
  assert.equal(play.personnel, 'te');
  assert.equal(play.players.filter((p) => p.role === 'TE').length, 1);
  assert.deepEqual(posOf(play.players), posOf(buildLineup(25, 'insideZone', { front: 'odd34', dlShift: DL_SHIFT_STEP, personnel: 'te' })));

  play.reset();
  assert.equal(play.personnel, 'te');
  play.snap();
  assert.equal(play.setPersonnel('te'), false);
  assert.equal(play.setPersonnel('noTe'), false);
  assert.equal(play.personnel, 'te');
});

test('F-39 #3: the TE takes his zone-plan block at the snap', () => {
  const play = createPlay(25, 'insideZone', { personnel: 'te' });
  const plan = zonePlan(play.players, play.numbers, 25);
  assert.ok(plan.blocks.TE, 'zone plan blocks the TE');
  play.snap();
  const te = play.player('TE');
  assert.equal(te.block.target, plan.blocks.TE);
  assert.notEqual(te.block.target, null);
});

test('F-39 #7: TE engages and the play ends in a tackle on every front', () => {
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front, personnel: 'te' });
    play.snap();
    let engaged = false;
    for (let i = 0; i < 360 && play.ball.phase !== 'dead'; i++) {
      play.step(1 / 60);
      if (play.player('TE').block?.engaged) engaged = true;
    }
    assert.equal(play.ball.phase, 'dead', front);
    assert.equal(engaged, true, front);
  }
});
