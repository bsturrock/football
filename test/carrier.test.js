import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  laneWindows, freeLane, scoreLanes, chooseLane, startRun, stepCarrier,
  LANES, MESH_AHEAD, SECURE_TIME, HANDOFF_DIST, GAP_BACK, LOCK_DEPTH, GOAL_LINE_Y,
  LANE_AHEAD, MIN_LANE, SWITCH_MARGIN, PATIENCE_MAX, PRESS_DEPTH, CLEAR_LANE, PRESSURE_DIST, CUT_ALLOW,
  PHASE_PACE, patienceWindow,
} from '../src/dots/carrier.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { hardCore, PACES } from '../src/dots/steering.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup } from '../src/dots/roster.js';

const LOS = 25;
const H = hardCore(BODY_RADIUS);
const mk = () => buildLineup(LOS, 'insideZone').map((p) => ({ ...p }));
const num = (pl, playside) => numberPlay(pl, { los: LOS, centerId: 'C', playside });
const by = (pl, id) => pl.find((p) => p.id === id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const nearWin = (w, e) => { near(w.lo, e.lo); near(w.hi, e.hi); };
const defAt = (id, x, y) => ({ id, team: 'defense', x, y });
const lineOf = (pl, numbers) => pl.filter((p) => p.team === 'offense' && numbers[p.id] != null).map((p) => ({ id: p.id, n: numbers[p.id] }));
const get = (ws, side, name) => ws.find((w) => w.side === side && w.name === name);

test('laneWindows playside left: play A, B, C and back A, B from live line x', () => {
  const pl = mk();
  const [LT, LG, C, RG, RT] = ['LT', 'LG', 'C', 'RG', 'RT'].map((id) => by(pl, id));
  const W = laneWindows(pl, lineOf(pl, num(pl, 'left')), -1);
  assert.deepEqual(W.map((w) => w.side + w.name), ['playA', 'playB', 'playC', 'backA', 'backB']);
  nearWin(get(W, 'play', 'A'), { lo: LG.x, hi: C.x });
  nearWin(get(W, 'play', 'B'), { lo: LT.x, hi: LG.x });
  nearWin(get(W, 'play', 'C'), { lo: LT.x - (LG.x - LT.x), hi: LT.x });
  nearWin(get(W, 'back', 'A'), { lo: C.x, hi: RG.x });
  nearWin(get(W, 'back', 'B'), { lo: RG.x, hi: RT.x });
});

test('laneWindows playside right mirrors', () => {
  const pl = mk();
  const [LG, C, RG, RT] = ['LG', 'C', 'RG', 'RT'].map((id) => by(pl, id));
  const W = laneWindows(pl, lineOf(pl, num(pl, 'right')), 1);
  nearWin(get(W, 'play', 'A'), { lo: C.x, hi: RG.x });
  nearWin(get(W, 'play', 'B'), { lo: RG.x, hi: RT.x });
  nearWin(get(W, 'play', 'C'), { lo: RT.x, hi: RT.x + (RT.x - RG.x) });
  nearWin(get(W, 'back', 'A'), { lo: LG.x, hi: C.x });
});

test('laneWindows: a missing outer lineman stops that side after the first gap with outer false', () => {
  const pl = mk();
  const numbers = num(pl, 'left');
  const noLT = pl.filter((p) => p.id !== 'LT');
  const W = laneWindows(noLT, lineOf(noLT, numbers), -1);
  assert.deepEqual(W.map((w) => w.side + w.name), ['playA', 'playB', 'backA', 'backB']);
  const [LG, C] = ['LG', 'C'].map((id) => by(pl, id));
  nearWin(get(W, 'play', 'B'), { lo: LG.x - (C.x - LG.x), hi: LG.x });
  const noRT = pl.filter((p) => p.id !== 'RT');
  const W2 = laneWindows(noRT, lineOf(noRT, numbers), -1);
  assert.deepEqual(W2.map((w) => w.side + w.name), ['playA', 'playB', 'playC', 'backA', 'backB']);
  const noRG = pl.filter((p) => p.id !== 'RG');
  const W3 = laneWindows(noRG, lineOf(noRG, numbers), -1);
  assert.deepEqual(W3.map((w) => w.side + w.name), ['playA', 'playB', 'playC', 'backA']);
});

test('laneWindows: no center gives []', () => {
  const pl = mk().filter((p) => p.id !== 'C');
  assert.deepEqual(laneWindows(pl, lineOf(mk(), num(mk(), 'left')).filter((l) => l.n !== 0), -1), []);
});

const parked = (pl) => { pl.filter((p) => p.team === 'defense').forEach((d, i) => { d.x = 15 + i; d.y = 45; }); return pl; };

const setup = (patience) => {
  const pl = parked(mk());
  const numbers = num(pl, 'left');
  const run = startRun(pl, { carrier: 'RB', patience }, { snapToId: 'QB', playside: 'left', numbers });
  return { pl, numbers, run, rb: by(pl, 'RB'), qb: by(pl, 'QB') };
};
const go = (pl, run, dt = 1 / 60) => stepCarrier(pl, run, { los: LOS, ballHeld: true, holdId: 'QB' }, dt);

test('laneWindows follows live x: moving a lineman after startRun moves that lane on the next stepCarrier', () => {
  const { pl, run, rb } = setup(PATIENCE_MAX);
  run.carried = true;
  rb.x = run.mesh.x; rb.y = run.mesh.y;
  go(pl, run);
  const before = get(run.lanes, 'play', 'B');
  by(pl, 'LT').x -= 0.3;
  go(pl, run);
  const after = get(run.lanes, 'play', 'B');
  near(after.lo, before.lo - 0.3);
  near(after.hi, before.hi);
});

test('freeLane: empty band is open at the window middle', () => {
  const pl = parked(mk());
  const win = { lo: -4, hi: -2 };
  const f = freeLane(pl, win, 'RB', LOS);
  assert.equal(f.open, true);
  near(f.x, -3);
  near(f.width, 2 - 2 * H);
});

test('freeLane: a defender at the middle closes a narrow window; depth band edges are respected', () => {
  const pl = parked(mk());
  const win = { lo: -1.2, hi: 0 };
  const withD = (x, y) => [...pl, defAt('Z', x, y)];
  assert.equal(freeLane(withD(-0.6, LOS + BODY_RADIUS), win, 'RB', LOS).open, false);
  assert.equal(freeLane(withD(-0.6, LOS - GAP_BACK + 0.01), win, 'RB', LOS).open, false);
  assert.equal(freeLane(withD(-0.6, LOS + LANE_AHEAD - 0.01), win, 'RB', LOS).open, false);
  assert.equal(freeLane(withD(-0.6, LOS + LANE_AHEAD + 0.01), win, 'RB', LOS).open, true);
  assert.equal(freeLane(withD(-0.6, LOS - GAP_BACK - 0.01), win, 'RB', LOS).open, true);
  const closed = freeLane(withD(-0.6, LOS + BODY_RADIUS), win, 'RB', LOS);
  assert.equal(closed.width < MIN_LANE, true);
  near(closed.x, -0.6);
});

test('freeLane: the carrier himself is ignored', () => {
  const pl = parked(mk());
  const rb = by(pl, 'RB');
  rb.x = -3; rb.y = LOS + BODY_RADIUS;
  assert.equal(freeLane(pl, { lo: -4, hi: -2 }, 'RB', LOS).open, true);
  near(freeLane(pl, { lo: -4, hi: -2 }, 'RB', LOS).x, -3);
});

test('freeLane: an offensive player inside an open window pushes x clear of him or closes the lane', () => {
  const pl = parked(mk());
  const win = { lo: -4, hi: -2 };
  for (const ox of [-3.5, -3.2, -3, -2.8, -2.5]) {
    const f = freeLane([...pl, { id: 'O', team: 'offense', x: ox, y: LOS + BODY_RADIUS }], win, 'RB', LOS);
    if (f.open) assert.ok(Math.abs(f.x - ox) >= H + MIN_LANE / 2 - 1e-9, `ox ${ox} x ${f.x}`);
  }
  const f = freeLane([...pl, { id: 'O', team: 'offense', x: -3, y: LOS + BODY_RADIUS }], { lo: -3.6, hi: -2.4 }, 'RB', LOS);
  assert.equal(f.open, false);
});

test('freeLane: x is the middle of the widest remaining segment', () => {
  const pl = parked(mk());
  const f = freeLane([...pl, defAt('Z', -1.9, LOS + 0.3)], { lo: -4, hi: 0 }, 'RB', LOS);
  assert.equal(f.open, true);
  near(f.x, (-4 + H + -1.9 - H) / 2);
  near(f.width, -1.9 - H - (-4 + H));
});

// RB at the mesh; defenders pinned at lane middles at y = LOS + BODY_RADIUS.
const pinned = (closed) => {
  const { pl, run, rb } = setup();
  run.carried = true;
  rb.x = run.mesh.x; rb.y = run.mesh.y;
  const ws = laneWindows(pl, run.line, run.side);
  const ds = pl.filter((p) => p.team === 'defense');
  closed.forEach(([s, n], i) => {
    const w = get(ws, s, n);
    ds[i].x = (w.lo + w.hi) / 2;
    ds[i].y = LOS + BODY_RADIUS;
  });
  return { pl, run, rb, lanes: scoreLanes(pl, run, rb, LOS) };
};

test('scoreLanes: LANES order, with the documented score', () => {
  const { lanes } = pinned([]);
  assert.deepEqual(lanes.map((l) => [l.side, l.name]), LANES.map((l) => [l.side, l.name]));
  assert.ok(lanes.every((l) => l.open));
});

test('chooseLane: play A open -> A; closing lanes in turn walks B, back A, C', () => {
  const pick = (closed) => { const { lanes } = pinned(closed); const l = chooseLane(lanes, null); return l.side + l.name; };
  assert.equal(pick([]), 'playA');
  assert.equal(pick([['play', 'A']]), 'playB');
  assert.equal(pick([['play', 'A'], ['play', 'B']]), 'backA');
  assert.equal(pick([['play', 'A'], ['play', 'B'], ['back', 'A'], ['back', 'B']]), 'playC');
});

test('chooseLane: all closed keeps current, else the first lane', () => {
  const all = [['play', 'A'], ['play', 'B'], ['play', 'C'], ['back', 'A'], ['back', 'B']];
  const { lanes } = pinned(all);
  assert.ok(lanes.every((l) => !l.open));
  const k = chooseLane(lanes, { side: 'back', name: 'A' });
  assert.equal(k.side + k.name, 'backA');
  const f = chooseLane(lanes, null);
  assert.equal(f.side + f.name, 'playA');
});

test('chooseLane hysteresis: keep an open current unless a rival beats it by more than SWITCH_MARGIN', () => {
  const mkL = (a, b, aOpen = true) => [
    { side: 'play', name: 'A', open: aOpen, score: a },
    { side: 'play', name: 'B', open: true, score: b },
  ];
  const cur = { side: 'play', name: 'A' };
  assert.equal(chooseLane(mkL(0, SWITCH_MARGIN - 0.01), cur).name, 'A');
  assert.equal(chooseLane(mkL(0, SWITCH_MARGIN), cur).name, 'A');
  assert.equal(chooseLane(mkL(0, SWITCH_MARGIN + 0.01), cur).name, 'B');
  assert.equal(chooseLane(mkL(0, -1, false), cur).name, 'B');
  assert.equal(chooseLane(mkL(0, 0), { side: 'play', name: 'B' }).name, 'B');
});

test('chooseLane and scoreLanes are deterministic', () => {
  const a = pinned([['play', 'A']]);
  const b = pinned([['play', 'A']]);
  assert.deepEqual(a.lanes, b.lanes);
  assert.deepEqual(chooseLane(a.lanes, null), chooseLane(b.lanes, null));
});

test('F-13 stepCarrier: mesh is in front of the QB', () => {
  const { run, qb } = setup();
  near(run.mesh.x, qb.x);
  near(run.mesh.y, qb.y + MESH_AHEAD);
});

test('F-21 startRun: approach is the tangent point in front of the QB, inside HANDOFF_DIST of the mesh', () => {
  const { run, qb } = setup();
  near(Math.hypot(run.approach.x - qb.x, run.approach.y - qb.y), MESH_AHEAD);
  assert.ok(run.approach.y > qb.y);
  assert.ok(Math.hypot(run.approach.x - run.mesh.x, run.approach.y - run.mesh.y) <= HANDOFF_DIST);
});

test('startRun: lane state and the optional track number', () => {
  const { run } = setup();
  assert.deepEqual(run.lane, { side: 'play', name: 'A' });
  assert.deepEqual(run.lanes, []);
  assert.equal(run.gap, 'A');
  assert.equal(run.track, 1);
  const pl = parked(mk());
  const r2 = startRun(pl, { carrier: 'RB', track: 0 }, { snapToId: 'QB', playside: 'left', numbers: num(pl, 'left') });
  assert.equal(r2.track, 0);
});

test('F-13 stepCarrier: no handoff without the ball; then handoff reads a lane', () => {
  const { pl, run, rb } = setup();
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    assert.equal(stepCarrier(pl, run, { los: LOS, ballHeld: false, holdId: 'QB' }, dt), false);
  }
  assert.equal(run.carried, false);
  assert.ok(Math.hypot(rb.x - run.mesh.x, rb.y - run.mesh.y) <= HANDOFF_DIST);
  const n = Math.ceil(SECURE_TIME / dt - 1e-9);
  for (let i = 1; i <= n; i++) {
    const r = go(pl, run, dt);
    if (i < n) {
      assert.ok(run.heldTime < SECURE_TIME - 1e-9);
      assert.equal(r, false);
    } else {
      assert.ok(run.heldTime >= SECURE_TIME - 1e-9);
      assert.equal(r, true);
    }
  }
  assert.equal(run.carried, true);
  assert.equal(run.lanes.length, 5);
  assert.equal(run.gap, run.lane.name);
  const l = get(run.lanes, run.lane.side, run.lane.name);
  assert.equal(run.locked, true);
  near(run.x, l.x);
  near(run.aim.y, GOAL_LINE_Y);
});

test('F-13 stepCarrier: lock freezes lane and x, then runs to the goal line', () => {
  const { pl, run, rb } = setup(PATIENCE_MAX);
  run.carried = true;
  rb.x = -0.6;
  rb.y = LOS - LOCK_DEPTH + 0.05;
  go(pl, run);
  assert.equal(run.locked, true);
  const { gap, x, lane } = run;
  assert.ok(Number.isFinite(x));
  const ds = pl.filter((p) => p.team === 'defense');
  ds.forEach((d) => { d.x = x; d.y = LOS + BODY_RADIUS; });
  for (let i = 0; i < 10; i++) go(pl, run);
  assert.equal(run.gap, gap);
  assert.deepEqual(run.lane, lane);
  assert.equal(run.x, x);
  assert.equal(run.aim.y, GOAL_LINE_Y);
  assert.ok(Math.abs(run.aim.x - run.x) <= CUT_ALLOW + 1e-9);
});

test('F-31 stepCarrier: locked carrier with no defenders runs past los + 10 and is still moving', () => {
  const { pl, run, rb } = setup();
  const offense = pl.filter((p) => p.team === 'offense');
  const dt = 1 / 60;
  rb.x = -0.6;
  rb.y = LOS - LOCK_DEPTH + 0.05;
  run.carried = true;
  const steps = Math.ceil((12 / rb.speed + 1) / dt);
  let prevY = rb.y;
  for (let i = 0; i < steps; i++) {
    prevY = rb.y;
    stepCarrier(offense, run, { los: LOS, ballHeld: true, holdId: 'QB' }, dt);
  }
  assert.equal(run.locked, true);
  assert.ok(rb.y > LOS + 10, `rb.y ${rb.y} not past los + 10`);
  assert.ok(rb.y > prevY, `rb.y ${rb.y} not increasing (prev ${prevY})`);
});

const pinAll = (pl, run) => {
  const ws = laneWindows(pl, run.line, run.side);
  const ds = pl.filter((p) => p.team === 'defense');
  ws.forEach((w, i) => { ds[i].x = (w.lo + w.hi) / 2; ds[i].y = LOS + BODY_RADIUS; });
  return ds;
};
const atMesh = (patience) => {
  const e = setup(patience);
  e.run.carried = true;
  e.rb.x = e.run.mesh.x; e.rb.y = e.run.mesh.y;
  return e;
};

test('patienceWindow: absent 0, passthrough, clamped to PATIENCE_MAX, negative 0, rb.patience scales', () => {
  assert.equal(patienceWindow({}, {}), 0);
  assert.equal(patienceWindow({ patience: 0.5 }, {}), 0.5);
  assert.equal(patienceWindow({ patience: 2 }, {}), PATIENCE_MAX);
  assert.equal(patienceWindow({ patience: -1 }, {}), 0);
  assert.equal(patienceWindow({ patience: 0.5 }, { patience: 0.5 }), 0.25);
});

test('startRun: patience state fields', () => {
  const { run } = setup(0.5);
  assert.equal(run.patience, 0.5);
  assert.equal(run.pressTime, 0);
  assert.equal(run.cut, 0);
  assert.equal(run.press, null);
  assert.equal(run.commitBy, null);
  assert.equal(PHASE_PACE.press, PACES.press);
  assert.equal(PHASE_PACE.commit, PACES.burst);
  assert.ok(PRESS_DEPTH > LOCK_DEPTH);
});

test('patience 0 commits on the handoff call', () => {
  const { pl, run } = setup(0);
  let handed = false;
  for (let i = 0; i < 200 && !handed; i++) {
    handed = go(pl, run);
    if (!handed) assert.equal(run.locked, false);
  }
  assert.equal(handed, true);
  assert.equal(run.locked, true);
  assert.equal(run.commitBy, 'window');
});

test('press: no commit before the window, re-reads lanes, commits at the window, paces', () => {
  const { pl, run, rb } = atMesh(0.5);
  const ds = pinAll(pl, run);
  const dt = 1 / 60;
  delete rb.v;
  let moved = false;
  let guard = 0;
  while (run.pressTime + dt < 0.5 - 1e-9 && guard++ < 1000) {
    const x0 = rb.x; const y0 = rb.y;
    go(pl, run, dt);
    assert.equal(run.locked, false, 'pressTime ' + run.pressTime);
    assert.ok(Math.hypot(rb.x - x0, rb.y - y0) <= PACES.press.frac * rb.speed * dt + 1e-9);
    assert.ok(rb.y < LOS - LOCK_DEPTH, 'press never reaches the line lock');
    assert.equal(run.press.y, LOS - PRESS_DEPTH);
    if (run.pressTime > 0.2 && !moved) {
      moved = true;
      const before = { ...run.lane };
      const w = get(laneWindows(pl, run.line, run.side), 'back', 'B');
      assert.deepEqual(before, { side: 'play', name: 'A' });
      ds.forEach((d, i) => { if (i === 4) { d.x = 15; d.y = 45; } });
      assert.ok(w);
      go(pl, run, dt);
      assert.equal(run.locked, false);
      assert.deepEqual(run.lane, { side: 'back', name: 'B' });
    }
  }
  assert.ok(moved);
  go(pl, run, dt);
  assert.equal(run.pressTime >= 0.5 - 1e-9, true);
  assert.equal(run.locked, true);
  assert.equal(run.commitBy, 'window');
  const lane = { ...run.lane };
  const x = run.x;
  const y0 = rb.y;
  rb.x = x; rb.y = LOS - 3; // unobstructed: pinned bodies sit at lane middles; clear space behind the line
  ds.forEach((d) => { d.x = 15; d.y = 45; });
  const p0 = { x: rb.x, y: rb.y };
  go(pl, run, dt);
  assert.ok(Math.abs(Math.hypot(rb.x - p0.x, rb.y - p0.y) - rb.speed * dt) < 1e-6, 'committed step at full speed');
  assert.deepEqual(run.lane, lane);
  assert.ok(y0 < LOS);
});

test('clear lane: a widened lane with an empty band commits at once, before the window', () => {
  const { pl, run } = atMesh(PATIENCE_MAX);
  by(pl, 'LG').x -= 0.6;
  go(pl, run);
  assert.equal(run.locked, true);
  assert.equal(run.commitBy, 'clear');
  assert.ok(run.pressTime < PATIENCE_MAX);
  const l = get(run.lanes, run.lane.side, run.lane.name);
  assert.ok(l.width >= CLEAR_LANE);
});

test('pressure: unblocked defender within PRESSURE_DIST ends the patience', () => {
  const place = (dist, block) => {
    const e = atMesh(PATIENCE_MAX);
    const d = e.pl.find((p) => p.team === 'defense');
    d.x = e.rb.x; d.y = e.rb.y + dist;
    if (block) e.pl.find((p) => p.id === 'LT').block = { target: d.id, engaged: true };
    go(e.pl, e.run);
    return e.run;
  };
  const near1 = place(PRESSURE_DIST - 0.01, false);
  assert.equal(near1.locked, true);
  assert.equal(near1.commitBy, 'pressure');
  assert.equal(place(PRESSURE_DIST + 0.01, false).locked, false);
  assert.equal(place(PRESSURE_DIST - 0.01, true).locked, false);
  // an offensive player nearby never triggers it
  const e = atMesh(PATIENCE_MAX);
  by(e.pl, 'C').x = e.rb.x; by(e.pl, 'C').y = e.rb.y + 0.5;
  go(e.pl, e.run);
  assert.equal(e.run.locked, false);
});

test('line: pressing never locks by itself; an RB at los - LOCK_DEPTH commits at once', () => {
  const { pl, run, rb } = atMesh(PATIENCE_MAX);
  rb.x = -0.6; rb.y = LOS - LOCK_DEPTH - 0.05;
  go(pl, run);
  assert.equal(run.locked, false);
  rb.y = LOS - LOCK_DEPTH + 0.01;
  go(pl, run);
  assert.equal(run.locked, true);
  assert.equal(run.commitBy, 'line');
  assert.ok(Number.isFinite(run.x));
});

test('commit: lane and x are fixed; aim moves at most CUT_ALLOW from run.x', () => {
  const { pl, run, rb } = atMesh(0);
  go(pl, run);
  assert.equal(run.locked, true);
  const lane = { ...run.lane };
  const x = run.x;
  const ds = pl.filter((p) => p.team === 'defense');
  for (let i = 0; i < 90; i++) {
    if (i === 2) { ds[0].x = x; ds[0].y = LOS + BODY_RADIUS; }
    if (i === 5) { ds[1].x = x + 0.3; ds[1].y = LOS + 2 * BODY_RADIUS; }
    go(pl, run);
    assert.deepEqual(run.lane, lane);
    assert.equal(run.x, x);
    assert.ok(Math.abs(run.aim.x - run.x) <= CUT_ALLOW + 1e-9);
    assert.equal(run.aim.y, GOAL_LINE_Y);
  }
  assert.ok(rb.y > 0);
});
