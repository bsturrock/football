// Ball carrier movement: playside gap windows frozen at the snap, the A -> B -> C
// hole read with an A default, read-time and depth locks, the QB/RB mesh handoff
// check (the QB must hold the snap SECURE_TIME before handing off), and carrier steering. Pure: no THREE, DOM, timers.
import { steerStep } from './steering.js';
import { BODY_RADIUS } from './blocking.js';
import { PLAYSIDE_SIGN } from './numbering.js';
import { liveGaps } from './front.js';

export const READS = Object.freeze(['A', 'B', 'C']);
export const MESH_AHEAD = 2 * BODY_RADIUS; // RB touching the QB's front
export const HANDOFF_DIST = BODY_RADIUS;
export const GAP_BACK = 2 * BODY_RADIUS;
export const GAP_DEPTH = 4 * BODY_RADIUS;
export const LOCK_DEPTH = 2 * BODY_RADIUS;
// The opponent goal line in field y (the shared convention: y is the yard line, 0 own goal to 100 opponent goal).
// The carrier runs to it once locked; the play-end rule (tackle.js) imports it for the touchdown check, so this is its single source.
export const GOAL_LINE_Y = 100;
// Timing tunable, not a body size: seconds from the handoff to a forced commit.
export const READ_TIME = 0.75;
// Timing tunable: seconds the QB holds the snap, catching and presenting the ball, before a handoff.
export const SECURE_TIME = 0.15;

// Windows for the playside gaps, from offensive-line x. `numbers` are
// playside-positive whatever the direction; `side` is -1 or +1.
export function gapWindows(players, numbers, side) {
  const line = players
    .filter((p) => p.team === 'offense' && numbers[p.id] != null)
    .map((p) => ({ id: p.id, n: numbers[p.id] }));
  const spans = liveGaps(players, line, side, 1, READS.length);
  const out = {};
  for (let k = 0; k < spans.length; k++) {
    out[READS[k]] = { lo: spans[k].lo, hi: spans[k].hi };
    if (!spans[k].outer) break;
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
  const rb = players.find((p) => p.id === runDef.carrier);
  // Aim at the tangent point beside the QB's front shoulder, not through him (steering stalls on his contact circle).
  let approach = { x: q.x, y: q.y + MESH_AHEAD };
  const rx = rb.x - q.x;
  const ry = rb.y - q.y;
  const d = Math.hypot(rx, ry);
  if (d > MESH_AHEAD) {
    const th = Math.atan2(ry, rx);
    const a = Math.acos(MESH_AHEAD / d);
    const c = [th + a, th - a].map((t) => ({ x: q.x + MESH_AHEAD * Math.cos(t), y: q.y + MESH_AHEAD * Math.sin(t) }));
    approach = c[0].y >= c[1].y ? c[0] : c[1];
  }
  return {
    carrier: runDef.carrier,
    approach,
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
    aim: { ...approach },
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
    run.aim = { ...run.approach };
    goal = { x: run.approach.x, y: run.approach.y, key: 'mesh', ignore: holdId };
  } else if (!run.locked) {
    goal = { ...run.aim, key: 'hole:' + run.gap, ignore: null };
  } else {
    run.aim = { x: run.x, y: GOAL_LINE_Y };
    goal = { ...run.aim, key: 'hole:' + run.gap, ignore: null };
  }
  steerStep(rb, goal, players, rb.speed * dt, dt, BODY_RADIUS);
  return handoff;
}
