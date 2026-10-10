// Ball carrier movement: playside gap windows frozen at the snap, the A -> B -> C
// hole read with an A default, read-time and depth locks, the QB/RB mesh handoff
// check (the QB must hold the snap SECURE_TIME before handing off), and carrier steering. Pure: no THREE, DOM, timers.
import { steerStep } from './steering.js';
import { BODY_RADIUS } from './blocking.js';
import { PLAYSIDE_SIGN, A_GAP_HALF } from './numbering.js';

export const READS = Object.freeze(['A', 'B', 'C']);
export const MESH_AHEAD = 2 * BODY_RADIUS; // RB touching the QB's front
export const HANDOFF_DIST = BODY_RADIUS;
export const GAP_BACK = 2 * BODY_RADIUS;
export const GAP_DEPTH = 4 * BODY_RADIUS;
export const LOCK_DEPTH = 2 * BODY_RADIUS;
export const RUN_DEPTH = 10; // yards past the line the carrier runs once committed
// Timing tunable, not a body size: seconds from the handoff to a forced commit.
export const READ_TIME = 0.75;
// Timing tunable: seconds the QB holds the snap, catching and presenting the ball, before a handoff.
export const SECURE_TIME = 0.15;

// Windows for the playside gaps, from offensive-line x. `numbers` are
// playside-positive whatever the direction; `side` is -1 or +1.
export function gapWindows(players, numbers, side) {
  const line = (n) => players.find((p) => p.team === 'offense' && numbers[p.id] === n);
  const out = {};
  let prevWidth = 2 * A_GAP_HALF;
  for (let k = 1; k <= READS.length; k++) {
    const inner = line(k - 1);
    if (!inner) break;
    const outer = line(k);
    const outerX = outer ? outer.x : inner.x + side * prevWidth;
    const lo = Math.min(inner.x, outerX);
    const hi = Math.max(inner.x, outerX);
    out[READS[k - 1]] = { lo, hi };
    prevWidth = hi - lo;
    if (!outer) break;
  }
  return out;
}

export const gapCenter = (w) => (w.lo + w.hi) / 2;

// The free lane between two linemen's bodies is (lo + R, hi - R), and a
// defender's body (x - R, x + R) overlaps it exactly when lo < x < hi, so the
// center test is radius-correct at any R.
export function gapOpen(players, w, los) {
  return !players.some(
    (p) => p.team === 'defense' && p.x > w.lo && p.x < w.hi && p.y >= los - GAP_BACK && p.y <= los + GAP_DEPTH,
  );
}

export function readHole(players, windows, los, idx) {
  let last = -1;
  READS.forEach((g, i) => { if (windows[g]) last = i; });
  while (idx < last && !gapOpen(players, windows[READS[idx]], los)) idx++;
  return idx;
}

// The gap the RB runs for read index `idx`: READS[idx], except that when `idx` is
// the last read present in `windows` and that gap is closed, he defaults to A.
export function pickGap(players, windows, los, idx) {
  let last = -1;
  READS.forEach((g, i) => { if (windows[g]) last = i; });
  if (idx === last && !gapOpen(players, windows[READS[idx]], los)) return READS[0];
  return READS[idx];
}

export function startRun(players, runDef, { snapToId, playside, numbers }) {
  const q = players.find((p) => p.id === snapToId);
  return {
    carrier: runDef.carrier,
    side: PLAYSIDE_SIGN[playside],
    mesh: { x: q.x, y: q.y + MESH_AHEAD },
    windows: gapWindows(players, numbers, PLAYSIDE_SIGN[playside]),
    read: 0,
    gap: READS[0],
    locked: false,
    carried: false,
    heldTime: 0,
    readTime: 0,
    x: null,
    aim: { x: q.x, y: q.y + MESH_AHEAD },
  };
}

export function stepCarrier(players, run, { los, ballHeld, holdId }, dt) {
  const rb = players.find((p) => p.id === run.carrier);
  let handoff = false;
  if (!run.carried && ballHeld) run.heldTime += dt;
  if (
    !run.carried &&
    ballHeld &&
    run.heldTime >= SECURE_TIME - 1e-9 &&
    Math.hypot(rb.x - run.mesh.x, rb.y - run.mesh.y) <= HANDOFF_DIST
  ) {
    run.carried = true;
    handoff = true;
  }
  if (run.carried && !run.locked) {
    run.read = readHole(players, run.windows, los, run.read);
    run.gap = pickGap(players, run.windows, los, run.read);
    run.aim = { x: gapCenter(run.windows[run.gap]), y: los };
    run.readTime += dt;
    if (rb.y >= los - LOCK_DEPTH || run.readTime >= READ_TIME - 1e-9) {
      run.locked = true;
      run.x = run.aim.x;
    }
  }
  let goal;
  if (!run.carried) {
    run.aim = { ...run.mesh };
    goal = { x: run.mesh.x, y: run.mesh.y, key: 'mesh', ignore: holdId };
  } else if (!run.locked) {
    goal = { ...run.aim, key: 'hole:' + run.gap, ignore: null };
  } else {
    run.aim = { x: run.x, y: los + RUN_DEPTH };
    goal = { ...run.aim, key: 'hole:' + run.gap, ignore: null };
  }
  steerStep(rb, goal, players, rb.speed * dt, dt, BODY_RADIUS);
  return handoff;
}
