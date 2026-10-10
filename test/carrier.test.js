import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  laneWindows, freeLane, scoreLanes, chooseLane, startRun, stepCarrier,
  LANES, MESH_AHEAD, SECURE_TIME, HANDOFF_DIST, GAP_BACK, LOCK_DEPTH, GOAL_LINE_Y,
  GAP_DEPTH, LANE_AHEAD, MIN_LANE, SWITCH_MARGIN, PATIENCE_MAX, PRESS_DEPTH, PRESSURE_DIST, CUT_ALLOW,
  PHASE_PACE, patienceWindow, THREAT_MARGIN, ROOM_CAP, TRACK_COST, CUT_COST, CLEAR_ROOM, CLEAR_HOLD, BEND_MAX,
  AVOID_SIGHT_MIN, AVOID_SIGHT_MAX, AVOID_FAN, AVOID_CONTACT, AVOID_CLOSE, AVOID_SIDELINE, AVOID_HOLD, AVOID_SWITCH, AVOID_AIM_DIST, visionOf,
} from '../src/dots/carrier.js';
import { BODY_RADIUS, engagedOn } from '../src/dots/blocking.js';
import { hardCore, PACES } from '../src/dots/steering.js';
import { numberPlay, A_GAP_HALF } from '../src/dots/numbering.js';
import { buildLineup, PLAYS, FRONTS } from '../src/dots/roster.js';
import { createPlay } from '../src/dots/play.js';
import { HW } from '../src/util.js';

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

test('freeLane with a projection: a free defender closing downhill from beyond the band closes the lane; standing or leaving does not', () => {
  const pl = parked(mk());
  const win = { lo: -1.2, hi: 0 };
  const far = LOS + LANE_AHEAD + 2; // beyond the static band
  const withD = () => [...pl, defAt('Z', -0.6, far)];
  const proj = (vy) => ({ vel: { Z: { vx: 0, vy } }, horizon: 0.5 });
  // without a projection the defender is invisible (unchanged read)
  assert.equal(freeLane(withD(), win, 'RB', LOS).open, true);
  const closing = freeLane(withD(), win, 'RB', LOS, proj(-6));
  const still = freeLane(withD(), win, 'RB', LOS, proj(0));
  const leaving = freeLane(withD(), win, 'RB', LOS, proj(6));
  assert.equal(closing.open, false);
  assert.equal(still.open, true);
  assert.equal(leaving.open, true);
  assert.equal(still.room, Infinity);
  assert.equal(leaving.room, Infinity);
  assert.ok(closing.room < still.room);
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
  near(run.aim.y, LOS + GAP_DEPTH);
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
  // Past the los with defenders right in front of him: he bends away but still gains ground (F-48 #5).
  assert.ok(run.aim.y > rb.y);
  assert.ok(Math.abs(Math.atan2(run.aim.x - rb.x, run.aim.y - rb.y)) <= AVOID_FAN + 1e-9);
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
    const behind = rb.y < LOS;
    go(pl, run);
    assert.deepEqual(run.lane, lane);
    assert.equal(run.x, x);
    if (behind && !run.pastLos) {
      assert.ok(Math.abs(run.aim.x - run.x) <= CUT_ALLOW + 1e-9);
      assert.equal(run.aim.y, LOS + GAP_DEPTH);
    } else {
      assert.ok(run.aim.y > rb.y);
      assert.ok(Math.abs(Math.atan2(run.aim.x - rb.x, run.aim.y - rb.y)) <= AVOID_FAN + 1e-9);
    }
  }
  assert.ok(rb.y > 0);
});

test('T-148: a committed RB enters his lane at the line', () => {
  const { pl, run, rb } = setup(PATIENCE_MAX);
  run.carried = true;
  run.locked = true;
  run.lane = { side: 'play', name: 'B' };
  run.gap = 'B';
  rb.x = 0;
  rb.y = LOS - 3 * BODY_RADIUS;
  run.x = 2.5;
  run.cut = 0;
  run.bends = BEND_MAX;
  let crossed = false;
  for (let i = 0; i < 300 && !crossed; i++) {
    const behind = rb.y < LOS;
    go(pl, run);
    if (behind) assert.equal(run.aim.y, LOS + GAP_DEPTH);
    if (rb.y >= LOS + GAP_DEPTH) {
      crossed = true;
      assert.ok(Math.abs(rb.x - run.x) <= A_GAP_HALF + BODY_RADIUS, `x ${rb.x} vs lane ${run.x}`);
    }
  }
  assert.ok(crossed);
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

test('F-48 #11b: once past the los the committed aim never returns to the hole', () => {
  const DT = 1 / 60;
  for (const front of Object.keys(FRONTS)) {
    for (const personnel of ['noTe', 'te']) {
      const tag = `front ${front}, personnel ${personnel}`;
      const play = createPlay(25, 'insideZone', { front, personnel });
      play.snap();
      const rb = play.player(play.run.carrier);
      let latched = false, bends = 0, px = rb.x, lastSign = 0, lastRev = -2;
      for (let i = 0; i < 300 && !play.result; i++) {
        play.step(DT);
        if (latched) {
          assert.ok(play.run.aim.y > rb.y && play.run.aim.y !== LOS + GAP_DEPTH, `${tag}: tick ${i} aim left the past-the-los run`);
          assert.ok(play.run.bends <= bends, `${tag}: tick ${i} bent after the line`);
        }
        if (play.run.pastLos) { latched = true; bends = play.run.bends; }
        if (front === 'walkedUp' && personnel === 'noTe' && play.run.locked) {
          const dx = rb.x - px;
          if (Math.abs(dx) > 0.5 * DT) {
            const sign = Math.sign(dx);
            if (lastSign && sign !== lastSign) {
              assert.ok(lastRev !== i - 1, `walkedUp/noTe: tick ${i} lateral motion reversed on two consecutive ticks`);
              lastRev = i;
            }
            lastSign = sign;
          } else lastSign = 0;
        } else lastSign = 0;
        px = rb.x;
      }
    }
  }
});

// F-48 #5-#9, #11c: open-field avoidance past the los.
const bearing = (rb, a) => Math.atan2(a.x - rb.x, a.y - rb.y);
const past = (vision) => {
  const e = atMesh(0);
  if (vision !== undefined) e.rb.vision = vision;
  go(e.pl, e.run);
  e.run.bends = BEND_MAX;
  e.rb.x = e.run.x;
  e.rb.y = LOS + 0.5;
  go(e.pl, e.run); // latches pastLos
  assert.equal(e.run.pastLos, true);
  e.rb.x = e.run.x;
  e.rb.y = LOS + 0.5;
  e.ds = e.pl.filter((p) => p.team === 'defense');
  return e;
};
// True when a seen free defender (in sight, not behind him) is within AVOID_CLOSE of the RB.
const seenClose = (play, rb) => {
  const sight = AVOID_SIGHT_MIN + visionOf(rb) * (AVOID_SIGHT_MAX - AVOID_SIGHT_MIN);
  return play.players.some((d) => {
    if (d.team !== 'defense' || d.y < rb.y - 2 * BODY_RADIUS || engagedOn(play.players, d.id).length) return false;
    const dist = Math.hypot(d.x - rb.x, d.y - rb.y);
    return dist <= sight && dist < AVOID_CLOSE;
  });
};
const place = (d, x, y) => { d.x = x; d.y = y; d.speed = d.speed || 7; };

test('F-48 #5: a free defender ahead and to one side bends the aim to the other side', () => {
  for (const sgn of [1, -1]) {
    const { pl, run, rb, ds } = past(1);
    place(ds[0], rb.x + sgn * 0.4, rb.y + 3);
    const at = { x: rb.x, y: rb.y }; // the aim is chosen from where he stands before the step
    go(pl, run);
    assert.ok(run.aim.y > at.y);
    assert.ok(Math.sign(run.aim.x - at.x) === -sgn, `aim x ${run.aim.x} vs rb ${at.x}`);
    assert.ok(Math.abs(bearing(at, run.aim)) <= AVOID_FAN + 1e-9);
    near(Math.hypot(run.aim.x - at.x, run.aim.y - at.y), AVOID_AIM_DIST);
  }
});

test('F-48 #5: over a run of ticks the aim is never toward a free defender ahead of him', () => {
  const { pl, run, rb, ds } = past(1);
  place(ds[0], rb.x + 0.3, rb.y + 5);
  const d = ds[0];
  d.speed = 0.01; // a man planted in his path
  let checked = 0;
  for (let i = 0; i < 40 && d.y > rb.y + 0.5; i++) {
    const at = { x: rb.x, y: rb.y };
    go(pl, run);
    assert.ok(run.aim.y > at.y);
    const ab = bearing(at, run.aim);
    const db = bearing(at, d);
    const dist = Math.hypot(d.x - at.x, d.y - at.y);
    if (dist > AVOID_CLOSE) assert.ok(Math.abs(ab - db) > 0.05, `tick ${i}: aim bearing ${ab} at defender bearing ${db}`);
    checked++;
  }
  assert.ok(checked > 10);
});

test('F-48 #6: nobody in sight gives the vertical aim exactly', () => {
  const { pl, run, rb } = past(1);
  go(pl, run);
  assert.deepEqual(run.aim, { x: run.x + run.cut, y: GOAL_LINE_Y });
  assert.equal(run.avoid, null);
  assert.ok(rb.y > LOS);
});

test('F-48 #7: vision sets his sight; a man inside the minimum range bends everyone', () => {
  const bends = (vision, dist) => {
    const { pl, run, rb, ds } = past(vision);
    place(ds[0], rb.x + 0.3, rb.y + dist);
    const y0 = rb.y;
    go(pl, run);
    return Math.abs(run.aim.x - (run.x + run.cut)) > 0.1 && run.aim.y > y0;
  };
  const mid = (AVOID_SIGHT_MIN + AVOID_SIGHT_MAX) / 2;
  assert.equal(bends(1, mid), true);
  assert.equal(bends(0, mid), false);
  assert.equal(bends(0, AVOID_SIGHT_MIN - 0.5), true);
  assert.equal(bends(1, AVOID_SIGHT_MIN - 0.5), true);
  assert.equal(visionOf({ vision: 0 }), 0);
});

test('F-48 #8: behind the los the aim ignores a free defender beyond the line', () => {
  const { pl, run, rb } = atMesh(0);
  const ds = pl.filter((p) => p.team === 'defense');
  go(pl, run);
  run.bends = BEND_MAX;
  rb.x = run.x;
  rb.y = LOS - 1;
  place(ds[0], rb.x + 0.2, LOS + 1.5);
  go(pl, run);
  assert.equal(run.pastLos, false);
  assert.equal(run.aim.y, LOS + GAP_DEPTH);
  assert.ok(Math.abs(run.aim.x - run.x) <= CUT_ALLOW + 1e-9);
});

test('F-48 #9: near the sideline with a defender inside, the aim stays off the sideline', () => {
  for (const sgn of [1, -1]) {
    const { pl, run, rb, ds } = past(1);
    rb.x = sgn * (HW - 1.5);
    run.x = rb.x;
    place(ds[0], rb.x - sgn * 0.4, rb.y + 3);
    for (let i = 0; i < 20; i++) {
      go(pl, run);
      assert.ok(Math.abs(run.aim.x) <= HW - AVOID_SIDELINE + 1e-9, `tick ${i} aim x ${run.aim.x}`);
      assert.ok(run.aim.y > rb.y);
    }
  }
});

test('F-48 #9: a static defender gives a stable heading, no alternating sign', () => {
  const { pl, run, rb, ds } = past(1);
  const d = ds[0];
  place(d, rb.x + 0.05, rb.y + 2.5);
  d.speed = 0.01;
  let flips = 0;
  let last = 0;
  const heads = new Set();
  for (let i = 0; i < 30; i++) {
    rb.x = 0;
    rb.y = LOS + 0.5;
    run.x = 0;
    go(pl, run);
    const sg = Math.sign(run.aim.x - rb.x);
    if (sg && last && sg !== last) flips++;
    if (sg) last = sg;
    heads.add(run.avoid);
  }
  assert.equal(flips, 0);
  assert.equal(heads.size, 1);
});

test('F-48 #5/#9 play level: past the los every front gains ground and never aims at a close free defender', () => {
  const DT = 1 / 60;
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front });
    play.snap();
    const rb = play.player(play.run.carrier);
    for (let i = 0; i < 300 && !play.result; i++) {
      play.step(DT);
      if (!play.run.pastLos) continue;
      assert.ok(play.run.aim.y > rb.y, `${front} tick ${i}`);
      const ab = bearing(rb, play.run.aim);
      if (seenClose(play, rb)) continue;
      for (const d of play.players) {
        if (d.team !== 'defense' || d.y <= rb.y || engagedOn(play.players, d.id).length) continue;
        const dist = Math.hypot(d.x - rb.x, d.y - rb.y);
        if (dist > AVOID_SIGHT_MIN || dist <= AVOID_CLOSE) continue;
        assert.ok(Math.abs(ab - bearing(rb, d)) > 0.02, `${front} tick ${i}: aim at ${d.id}`);
      }
    }
  }
});

test('F-48 #11c: past the los the aim x reverses at most once in 0.5 s and a heading is held', () => {
  const DT = 1 / 60;
  const report = [];
  for (const front of Object.keys(FRONTS)) {
    for (const personnel of ['noTe', 'te']) {
      const tag = `front ${front}, personnel ${personnel}`;
      const play = createPlay(25, 'insideZone', { front, personnel });
      play.snap();
      const run = play.run;
      let px = null, lastSign = 0, lastRev = -Infinity, lastChange = -Infinity, prevAvoid = null, revs = 0;
      const rbp = play.player(run.carrier);
      for (let i = 0; i < 300 && !play.result; i++) {
        const before = run.avoid;
        const closeBefore = run.pastLos && seenClose(play, rbp);
        play.step(DT);
        if (!run.pastLos) { px = null; continue; }
        if (closeBefore) assert.equal(run.avoid, before, `${tag}: tick ${i} heading changed with a man inside AVOID_CLOSE`);
        if (px !== null) {
          const dx = run.aim.x - px;
          if (Math.abs(dx) > 0.01) {
            const sg = Math.sign(dx);
            if (lastSign && sg !== lastSign) {
              revs++;
              assert.ok((i - lastRev) * DT >= 0.5 - 1e-9, `${tag}: tick ${i} aim x reversed twice within 0.5 s`);
              lastRev = i;
            }
            lastSign = sg;
          }
        }
        px = run.aim.x;
        if (run.avoid !== prevAvoid) {
          if (run.avoid !== null && prevAvoid !== null) {
            assert.ok((i - lastChange) * DT >= AVOID_HOLD - 1e-9 || run.avoidForced, `${tag}: tick ${i} heading changed inside the hold`);
          }
          if (run.avoid !== null) lastChange = i;
          prevAvoid = run.avoid;
        }
      }
      report.push(`${front}/${personnel}=${revs}`);
    }
  }
  console.log('F-48 #11c reversals: ' + report.join(' '));
});

test('F-48 #12 (a): a free defender inside AVOID_CLOSE and no held heading gives the vertical aim', () => {
  for (const sgn of [1, -1]) {
    const { pl, run, rb, ds } = past(1);
    place(ds[0], rb.x + sgn * 0.4, rb.y + AVOID_CLOSE - 0.3);
    go(pl, run);
    assert.deepEqual(run.aim, { x: run.x + run.cut, y: GOAL_LINE_Y });
    assert.equal(run.avoid, null);
  }
});

test('F-48 #12 (b): a held cut is not changed or restarted while a man is inside AVOID_CLOSE', () => {
  const { pl, run, rb, ds } = past(1);
  place(ds[0], rb.x + 0.4, rb.y + 3);
  ds[0].speed = 0.01;
  go(pl, run);
  assert.notEqual(run.avoid, null);
  const held = run.avoid;
  const line = { ...run.avoidLine };
  for (let i = 0; i < Math.ceil((AVOID_HOLD + 0.2) * 60); i++) go(pl, run);
  assert.equal(run.avoid, held);
  // Move the man inside AVOID_CLOSE on the held line and park there.
  const d = ds[0];
  d.speed = 0.01;
  for (let i = 0; i < 40; i++) {
    d.x = rb.x + Math.sin(line.th) * 0.9;
    d.y = rb.y + Math.cos(line.th) * 0.9;
    go(pl, run);
    assert.equal(run.avoid, held, `tick ${i}`);
    assert.ok(run.aim.y > rb.y);
    assert.ok(Math.abs(bearing(line, run.aim) - line.th) < 1e-6 || Math.abs(run.aim.x - (line.x + (run.aim.y - line.y) * Math.tan(line.th))) < 1e-6);
  }
});
