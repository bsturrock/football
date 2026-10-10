import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  laneWindows, freeLane, scoreLanes, chooseLane, startRun, stepCarrier,
  LANES, MESH_AHEAD, SECURE_TIME, HANDOFF_DIST, GAP_BACK, LOCK_DEPTH, GOAL_LINE_Y,
  LANE_AHEAD, MIN_LANE, SWITCH_MARGIN, PATIENCE_MAX, PRESS_DEPTH, PRESSURE_DIST, CUT_ALLOW,
  PHASE_PACE, patienceWindow, THREAT_MARGIN, ROOM_CAP, TRACK_COST, CUT_COST, CLEAR_ROOM, CLEAR_HOLD, BEND_MAX,
} from '../src/dots/carrier.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { hardCore, PACES } from '../src/dots/steering.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup, PLAYS } from '../src/dots/roster.js';

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
  const m = H + THREAT_MARGIN;
  near(f.x, (-4 + H + -1.9 - m) / 2);
  near(f.width, -1.9 - m - (-4 + H));
});

test('freeLane: an engaged defender removes only H, a free one H + THREAT_MARGIN', () => {
  const win = { lo: -3, hi: -1 };
  const withZ = (x, engaged) => {
    const pl = parked(mk());
    by(pl, 'LT').block = engaged ? { target: 'Z', engaged: true } : undefined;
    return freeLane([...pl, defAt('Z', x, LOS + 0.3)], win, 'RB', LOS);
  };
  const eng = withZ(-2, true);
  assert.equal(eng.open, true);
  assert.ok(Math.abs(eng.x + 2) >= H + MIN_LANE / 2 - 1e-9);
  assert.equal(withZ(-2, false).open, false);
  const e2 = withZ(-2.2, true);
  const f2 = withZ(-2.2, false);
  assert.equal(f2.open, true);
  assert.ok(Math.abs(f2.x + 2.2) >= H + THREAT_MARGIN + MIN_LANE / 2 - 1e-9, `free x ${f2.x}`);
  assert.ok(Math.abs(e2.x + 2.2) >= H + MIN_LANE / 2 - 1e-9);
  near(e2.width - f2.width, THREAT_MARGIN);
});

test('freeLane room: a free defender between the RB and the line counts; engaged, offensive and passed ones do not', () => {
  const win = { lo: -4, hi: -2 };
  const base = () => {
    const pl = parked(mk());
    const rb = by(pl, 'RB');
    rb.x = -3; rb.y = LOS - 3;
    return pl;
  };
  assert.equal(freeLane(base(), win, 'RB', LOS).room, Infinity);
  const free = freeLane([...base(), defAt('Z', -1.5, LOS - 1.5)], win, 'RB', LOS);
  near(free.room, 1.5 - H);
  const behind = freeLane([...base(), defAt('Z', -1.5, LOS - 3.5)], win, 'RB', LOS);
  assert.equal(behind.room, Infinity);
  const pl = [...base(), defAt('Z', -1.5, LOS - 1.5)];
  by(pl, 'LT').block = { target: 'Z', engaged: true };
  assert.equal(freeLane(pl, win, 'RB', LOS).room, Infinity);
  const off = freeLane([...base(), { id: 'O', team: 'offense', x: -1.5, y: LOS - 1.5 }], win, 'RB', LOS);
  assert.equal(off.room, Infinity);
  const nearest = freeLane([...base(), defAt('Z', -1.5, LOS - 1.5), defAt('Y', -4.6, LOS + 0.5)], win, 'RB', LOS);
  near(nearest.room, 1.5 - H);
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
  assert.ok(lanes.every((l) => l.room === Infinity));
  const e = pinned([['play', 'A']]);
  const trackX = by(e.pl, 'LG').x;
  for (const l of e.lanes) {
    assert.equal(typeof l.room, 'number');
    near(l.score, Math.min(l.room, ROOM_CAP) - TRACK_COST * Math.abs(l.x - trackX) - CUT_COST * Math.abs(l.x - e.rb.x));
  }
  assert.ok(e.lanes.some((l) => Number.isFinite(l.room)));
});

test('geometry: guard and center 0.99 apart, LT-LG 1.38 apart -> playside A is open and beats B', () => {
  const pl = parked(mk());
  by(pl, 'LG').x = -0.99;
  by(pl, 'LT').x = -0.99 - 1.38;
  const rb = by(pl, 'RB');
  rb.x = 0; rb.y = LOS - 4.7;
  const run = startRun(pl, { carrier: 'RB' }, { snapToId: 'QB', playside: 'left', numbers: num(pl, 'left') });
  const lanes = scoreLanes(pl, run, rb, LOS);
  const A = get(lanes, 'play', 'A');
  const B = get(lanes, 'play', 'B');
  assert.equal(A.open, true);
  assert.equal(B.open, true);
  assert.ok(A.score > B.score, `A ${A.score} B ${B.score}`);
  const pick = chooseLane(lanes, null);
  assert.equal(pick.side + pick.name, 'playA');
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
  rb.y = LOS + 0.05; // at the los: a closing lane no longer bends
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

test('clear hold: a lane with room Infinity commits clear on the tick clearTime reaches CLEAR_HOLD, not before', () => {
  const { pl, run } = atMesh(PATIENCE_MAX);
  const n = Math.ceil(CLEAR_HOLD * 60 - 1e-9);
  assert.ok(CLEAR_HOLD < 0.5 && n > 1);
  for (let i = 1; i < n; i++) {
    go(pl, run);
    assert.equal(run.locked, false, 'tick ' + i);
    near(run.clearTime, i / 60);
  }
  go(pl, run);
  assert.equal(run.locked, true);
  assert.equal(run.commitBy, 'clear');
  assert.ok(run.clearTime >= CLEAR_HOLD - 1e-9);
  assert.ok(run.pressTime < run.patience);
});

test('clear hold: a lane clear for less than CLEAR_HOLD then given a free defender within CLEAR_ROOM restarts its hold', () => {
  const { pl, run } = atMesh(PATIENCE_MAX);
  for (let i = 0; i < 8; i++) go(pl, run);
  assert.equal(run.locked, false);
  assert.ok(run.clearTime > 0 && run.clearTime < CLEAR_HOLD);
  const lane0 = { ...run.clearLane };
  const d = pl.find((p) => p.team === 'defense');
  d.x = run.aim.x + 1.0; d.y = LOS + LANE_AHEAD - 0.1;
  go(pl, run);
  assert.equal(run.locked, false);
  // the hold restarted: at most one tick, and on another lane if it is clear at all
  assert.ok(run.clearTime <= 1 / 60 + 1e-9, 'clearTime ' + run.clearTime);
  if (run.clearLane) assert.notDeepEqual(run.clearLane, lane0);
  d.x = 15; d.y = 45;
  go(pl, run);
  assert.equal(run.locked, false);
});

test('clear room: a picked open lane needs CLEAR_ROOM to every free defender to count as clear', () => {
  const { pl, run } = atMesh(PATIENCE_MAX);
  go(pl, run);
  const x = run.aim.x;
  const d = pl.find((p) => p.team === 'defense');
  d.x = x + H + CLEAR_ROOM + 0.05; d.y = LOS + LANE_AHEAD - 0.1;
  go(pl, run);
  assert.ok(run.clearTime > 0);
  d.x = x + H + CLEAR_ROOM - 0.05;
  go(pl, run);
  assert.equal(run.clearTime, 0);
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
  run.bends = BEND_MAX; // lane changes after the commit are the bend; covered below
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

test('data: insideZone declares patience 0.5', () => {
  assert.equal(PLAYS.insideZone.run.patience, 0.5);
});

// Bend: a locked RB behind the los whose committed lane closes re-picks once.
const lockedAtMesh = () => {
  const e = atMesh(0);
  go(e.pl, e.run);
  assert.equal(e.run.locked, true);
  assert.equal(e.run.bends, 0);
  return e;
};
const plugCommitted = (e) => {
  const d = e.pl.find((p) => p.team === 'defense');
  d.x = e.run.x; d.y = LOS + 0.3;
  return d;
};

test('bend: committed lane closed behind the los with another lane open -> moves to the picked lane', () => {
  const e = lockedAtMesh();
  const { run, pl } = e;
  const before = { ...run.lane };
  const by0 = run.commitBy;
  plugCommitted(e);
  assert.ok(e.rb.y < LOS);
  go(pl, run);
  const pick = chooseLane(run.lanes, null);
  assert.ok(pick.open);
  assert.notDeepEqual({ side: pick.side, name: pick.name }, before);
  assert.deepEqual(run.lane, { side: pick.side, name: pick.name });
  assert.equal(run.gap, pick.name);
  assert.equal(run.x, pick.x);
  assert.equal(run.bends, 1);
  assert.equal(run.locked, true);
  assert.equal(run.commitBy, by0);
  assert.ok(Math.abs(run.aim.x - run.x) <= CUT_ALLOW + 1e-9);
});

test('bend: none while the committed lane is open', () => {
  const e = lockedAtMesh();
  const lane = { ...e.run.lane };
  for (let i = 0; i < 5; i++) go(e.pl, e.run);
  assert.equal(e.run.bends, 0);
  assert.deepEqual(e.run.lane, lane);
});

test('bend: none at or past the los', () => {
  const e = lockedAtMesh();
  const lane = { ...e.run.lane };
  const x = e.run.x;
  plugCommitted(e);
  e.rb.y = LOS;
  go(e.pl, e.run);
  assert.equal(e.run.bends, 0);
  assert.deepEqual(e.run.lane, lane);
  assert.equal(e.run.x, x);
});

test('bend: none when no other lane is open', () => {
  const e = lockedAtMesh();
  const lane = { ...e.run.lane };
  const x = e.run.x;
  pinAll(e.pl, e.run);
  go(e.pl, e.run);
  assert.ok(e.run.lanes.every((l) => !l.open));
  assert.equal(e.run.bends, 0);
  assert.deepEqual(e.run.lane, lane);
  assert.equal(e.run.x, x);
});

test('bend: none once run.bends reaches BEND_MAX', () => {
  const e = lockedAtMesh();
  assert.ok(Number.isInteger(BEND_MAX) && BEND_MAX >= 1 && BEND_MAX <= 2);
  const lane = { ...e.run.lane };
  const x = e.run.x;
  e.run.bends = BEND_MAX;
  plugCommitted(e);
  go(e.pl, e.run);
  assert.equal(e.run.bends, BEND_MAX);
  assert.deepEqual(e.run.lane, lane);
  assert.equal(e.run.x, x);
});

test('startRun: bends starts at 0', () => {
  assert.equal(setup().run.bends, 0);
});
