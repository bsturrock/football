import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gapWindows, gapCenter, gapOpen, readHole, pickGap, startRun, stepCarrier,
  READS, MESH_AHEAD, SECURE_TIME, HANDOFF_DIST, GAP_BACK, GAP_DEPTH, LOCK_DEPTH, RUN_DEPTH, READ_TIME,
} from '../src/dots/carrier.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup } from '../src/dots/roster.js';

const LOS = 25;
const mk = () => buildLineup(LOS, 'insideZone').map((p) => ({ ...p }));
const num = (pl, playside) => numberPlay(pl, { los: LOS, centerId: 'C', playside });
const by = (pl, id) => pl.find((p) => p.id === id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const nearWin = (w, e) => { near(w.lo, e.lo); near(w.hi, e.hi); };

test('F-13 #1 gapWindows playside left: A, B, C from live line x (today -1.5/0, -3/-1.5, -4.5/-3)', () => {
  const pl = mk();
  const [LT, LG, C] = ['LT', 'LG', 'C'].map((id) => by(pl, id));
  const W = gapWindows(pl, num(pl, 'left'), -1);
  nearWin(W.A, { lo: LG.x, hi: C.x });
  nearWin(W.B, { lo: LT.x, hi: LG.x });
  nearWin(W.C, { lo: LT.x - (LG.x - LT.x), hi: LT.x });
});

test('F-13 #1 gapWindows playside right mirrors', () => {
  const pl = mk();
  const [C, RG, RT] = ['C', 'RG', 'RT'].map((id) => by(pl, id));
  const W = gapWindows(pl, num(pl, 'right'), 1);
  nearWin(W.A, { lo: C.x, hi: RG.x });
  nearWin(W.B, { lo: RG.x, hi: RT.x });
  nearWin(W.C, { lo: RT.x, hi: RT.x + (RT.x - RG.x) });
});

test('F-13 #1 gapWindows without LT: only A and B, B one A-width outside the guard', () => {
  const pl = mk();
  const numbers = num(pl, 'left');
  const noLT = pl.filter((p) => p.id !== 'LT');
  const [LG, C] = ['LG', 'C'].map((id) => by(pl, id));
  const W = gapWindows(noLT, numbers, -1);
  assert.deepEqual(Object.keys(W), ['A', 'B']);
  nearWin(W.B, { lo: LG.x - (C.x - LG.x), hi: LG.x });
});

test('F-13 #1 gapWindows follows live x: LT -0.3 moves B.lo and C.hi by -0.3, C.lo by -0.6', () => {
  const pl = mk();
  const numbers = num(pl, 'left');
  const before = gapWindows(pl, numbers, -1);
  by(pl, 'LT').x -= 0.3;
  const after = gapWindows(pl, numbers, -1);
  near(after.B.lo, before.B.lo - 0.3);
  near(after.C.hi, before.C.hi - 0.3);
  near(after.C.lo, before.C.lo - 0.6);
});

test('F-13 #2 gapOpen: defender depth and width rules', () => {
  const offense = mk().filter((p) => p.team === 'offense');
  const A = gapWindows(offense, num(mk(), 'left'), -1).A;
  const cx = gapCenter(A);
  const withD = (x, y) => [...offense, { id: 'D', team: 'defense', x, y }];
  assert.equal(gapOpen(withD(cx, LOS + BODY_RADIUS), A, LOS), false);
  assert.equal(gapOpen(withD(cx, LOS - GAP_BACK + 0.05), A, LOS), false);
  assert.equal(gapOpen(withD(cx, LOS + GAP_DEPTH + 0.05), A, LOS), true);
  assert.equal(gapOpen(withD(cx, LOS - GAP_BACK - 0.05), A, LOS), true);
  assert.equal(gapOpen(withD(A.lo, LOS + BODY_RADIUS), A, LOS), true);
  assert.equal(gapOpen([...offense, { id: 'O', team: 'offense', x: cx, y: LOS + BODY_RADIUS }], A, LOS), true);
});

test('F-13 #3 readHole: fixed A -> B -> C progression', () => {
  const base = mk();
  const numbers = num(base, 'left');
  const offense = base.filter((p) => p.team === 'offense');
  const W = gapWindows(offense, numbers, -1);
  const run = (gaps) => {
    const ds = base.filter((p) => p.team === 'defense').map((p, i) => ({ ...p, x: 15 + i, y: 45 }));
    gaps.forEach((g, i) => { ds[i].x = gapCenter(W[g]); ds[i].y = LOS + 2 * BODY_RADIUS; });
    return [...offense, ...ds];
  };
  assert.equal(readHole(run([]), W, LOS, 0), 0);
  assert.equal(readHole(run(['A']), W, LOS, 0), 1);
  assert.equal(readHole(run(['A', 'B']), W, LOS, 0), 2);
  assert.equal(readHole(run(['A', 'B', 'C']), W, LOS, 0), 2);
  assert.equal(readHole(run([]), W, LOS, 1), 1);
});

const setup = () => {
  const pl = mk();
  const numbers = num(pl, 'left');
  // Today's lineup has RDT (x -1.2) inside the A window, which would close A; park defenders so A reads open.
  pl.filter((p) => p.team === 'defense').forEach((d, i) => { d.x = 15 + i; d.y = 45; });
  const run = startRun(pl, { carrier: 'RB' }, { snapToId: 'QB', playside: 'left', numbers });
  return { pl, numbers, run, rb: by(pl, 'RB'), qb: by(pl, 'QB') };
};

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

test('F-13 stepCarrier: no handoff without the ball; then handoff reads A', () => {
  const { pl, numbers, run, rb } = setup();
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    assert.equal(stepCarrier(pl, run, { los: LOS, numbers, ballHeld: false, holdId: 'QB' }, dt), false);
  }
  assert.equal(run.carried, false);
  assert.ok(Math.hypot(rb.x - run.mesh.x, rb.y - run.mesh.y) <= HANDOFF_DIST);
  const n = Math.ceil(SECURE_TIME / dt - 1e-9);
  for (let i = 1; i <= n; i++) {
    const r = stepCarrier(pl, run, { los: LOS, numbers, ballHeld: true, holdId: 'QB' }, dt);
    if (i < n) {
      assert.ok(run.heldTime < SECURE_TIME - 1e-9);
      assert.equal(r, false);
    } else {
      assert.ok(run.heldTime >= SECURE_TIME - 1e-9);
      assert.equal(r, true);
    }
  }
  assert.equal(run.carried, true);
  assert.equal(run.gap, 'A');
  const A = gapWindows(pl, numbers, -1).A;
  near(run.aim.x, gapCenter(A));
  near(run.aim.y, LOS);
});

test('F-13 stepCarrier: lock freezes the hole and x, then runs RUN_DEPTH past the line', () => {
  const { pl, numbers, run, rb } = setup();
  const dt = 1 / 60;
  const A = gapWindows(pl, numbers, -1).A;
  rb.x = gapCenter(A);
  rb.y = LOS - LOCK_DEPTH + 0.05;
  run.carried = true;
  stepCarrier(pl, run, { los: LOS, numbers, ballHeld: true, holdId: 'QB' }, dt);
  assert.equal(run.locked, true);
  const { gap, x } = run;
  near(x, gapCenter(A));
  const ds = pl.filter((p) => p.team === 'defense');
  ds.forEach((d) => { d.x = gapCenter(A); d.y = LOS + BODY_RADIUS; });
  for (let i = 0; i < 10; i++) stepCarrier(pl, run, { los: LOS, numbers, ballHeld: true, holdId: 'QB' }, dt);
  assert.equal(run.gap, gap);
  assert.equal(run.x, x);
  assert.equal(run.aim.y, LOS + RUN_DEPTH);
});

const defAt = (id, x, y) => ({ id, team: 'defense', x, y });

test('F-13 #3 pickGap: reads A, B, C in order; last read defaults to A when closed', () => {
  const offense = mk().filter((p) => p.team === 'offense');
  const W = gapWindows(offense, num(mk(), 'left'), -1);
  const closed = (g) => [...offense, defAt('D', gapCenter(W[g]), LOS + BODY_RADIUS)];
  assert.equal(pickGap(offense, W, LOS, 0), READS[0]);
  assert.equal(pickGap(closed('A'), W, LOS, 0), READS[0]);
  assert.equal(pickGap(offense, W, LOS, 1), READS[1]);
  assert.equal(pickGap(closed('B'), W, LOS, 1), READS[1]);
  assert.equal(pickGap(offense, W, LOS, 2), 'C');
  assert.equal(pickGap(closed('C'), W, LOS, 2), 'A');
});

test('F-13 #3 pickGap without LT: B is the last read, so a closed B defaults to A', () => {
  const base = mk();
  const numbers = num(base, 'left');
  const noLT = base.filter((p) => p.team === 'offense' && p.id !== 'LT');
  const W = gapWindows(noLT, numbers, -1);
  assert.deepEqual(Object.keys(W), ['A', 'B']);
  assert.equal(pickGap(noLT, W, LOS, 1), 'B');
  assert.equal(pickGap([...noLT, defAt('D', gapCenter(W.B), LOS + BODY_RADIUS)], W, LOS, 1), 'A');
});

test('F-13 startRun: windows frozen at the snap', () => {
  const { pl, numbers, run } = setup();
  const snap = gapWindows(pl, numbers, -1);
  assert.deepEqual(run.windows, snap);
  const lg = by(pl, 'LG');
  lg.x -= 4 * BODY_RADIUS;
  run.carried = true;
  stepCarrier(pl, run, { los: LOS, ballHeld: true, holdId: 'QB' }, 1 / 60);
  near(run.aim.x, gapCenter(snap[run.gap]));
});

test('F-13 stepCarrier: read-time commit to A when nothing opens', () => {
  const { pl, numbers, run, rb } = setup();
  const dt = 1 / 60;
  const ds = pl.filter((p) => p.team === 'defense');
  READS.forEach((g, i) => { ds[i].x = gapCenter(run.windows[g]); ds[i].y = LOS + BODY_RADIUS; });
  const spot = { x: gapCenter(run.windows.A), y: LOS - 10 };
  run.carried = true;
  const N = Math.round(READ_TIME * 60);
  for (let i = 1; i <= N; i++) {
    rb.x = spot.x;
    rb.y = spot.y;
    stepCarrier(pl, run, { los: LOS, ballHeld: true, holdId: 'QB' }, dt);
    if (i < N) assert.equal(run.locked, false, `locked early on step ${i}`);
  }
  assert.equal(run.locked, true);
  assert.equal(run.gap, 'A');
  near(run.x, gapCenter(run.windows.A));
});

test('F-13 stepCarrier: read-time commit runs C when only A and B are closed', () => {
  const { pl, numbers, run, rb } = setup();
  const dt = 1 / 60;
  const ds = pl.filter((p) => p.team === 'defense');
  ['A', 'B'].forEach((g, i) => { ds[i].x = gapCenter(run.windows[g]); ds[i].y = LOS + BODY_RADIUS; });
  const spot = { x: gapCenter(run.windows.A), y: LOS - 10 };
  run.carried = true;
  const N = Math.round(READ_TIME * 60);
  for (let i = 1; i <= N; i++) {
    rb.x = spot.x;
    rb.y = spot.y;
    stepCarrier(pl, run, { los: LOS, ballHeld: true, holdId: 'QB' }, dt);
    if (i < N) assert.equal(run.locked, false, `locked early on step ${i}`);
  }
  assert.equal(run.locked, true);
  assert.equal(run.gap, 'C');
  near(run.x, gapCenter(run.windows.C));
});
