// Ball carrier movement: live lane read on both sides of the center (laneWindows, freeLane,
// scoreLanes, chooseLane), the QB/RB mesh handoff check (the QB must hold
// the snap SECURE_TIME before handing off), and carrier steering. Pure: no THREE, DOM, timers.
import { steerStep, hardCore, PACES } from './steering.js';
import { BODY_RADIUS, engagedOn } from './blocking.js';
import { PLAYSIDE_SIGN } from './numbering.js';
import { liveGaps } from './front.js';

const H = hardCore(BODY_RADIUS);
export const MESH_AHEAD = 2 * BODY_RADIUS; // RB touching the QB's front
export const HANDOFF_DIST = BODY_RADIUS;
export const GAP_BACK = 2 * BODY_RADIUS;
export const GAP_DEPTH = 4 * BODY_RADIUS;
export const LOCK_DEPTH = 2 * BODY_RADIUS;
// The opponent goal line in field y (the shared convention: y is the yard line, 0 own goal to 100 opponent goal).
// The carrier runs to it once locked; the play-end rule (tackle.js) imports it for the touchdown check, so this is its single source.
export const GOAL_LINE_Y = 100;
// Timing tunable: seconds the QB holds the snap, catching and presenting the ball, before a handoff.
export const SECURE_TIME = 0.15;

// Candidate gaps, in tie-break order (frozen data).
export const LANES = Object.freeze([
  Object.freeze({ side: 'play', name: 'A' }),
  Object.freeze({ side: 'play', name: 'B' }),
  Object.freeze({ side: 'play', name: 'C' }),
  Object.freeze({ side: 'back', name: 'A' }),
  Object.freeze({ side: 'back', name: 'B' }),
]);
// Tunables (line number of the track point; distances in body radii; costs in score per yard).
export const TRACK = 1; // default track point: the numbered line player with this number (playside guard)
export const LANE_AHEAD = 6 * BODY_RADIUS; // band depth past the los
export const MIN_LANE = BODY_RADIUS / 4; // narrowest slack he squeezes through: a segment this wide counts as open
export const THREAT_MARGIN = BODY_RADIUS / 2; // extra room a free (unblocked) defender needs on top of the contact distance
export const ROOM_CAP = 4 * BODY_RADIUS; // room beyond this scores no more
export const TRACK_COST = 0.5; // score per yard from the track point
export const CUT_COST = 0.25; // score per yard from the RB's own x
export const CLOSING_FRACTION = 1 / 8; // a free defender moving downhill faster than this fraction of his top speed is closing at full speed
export const SWITCH_MARGIN = BODY_RADIUS / 2; // score a rival lane must beat the current one by

// Vision (F-48): the RB looks past the line band to the second level when scoring a hole.
export const DEFAULT_VISION = 0.5; // a back with no vision rating
export const SECOND_LEVEL_DEPTH = 18 * BODY_RADIUS; // yd: depth of the second level beyond los + LANE_AHEAD
export const LEVEL2_CAP = 8 * BODY_RADIUS; // yd: lateral clearance beyond which a second-level defender no longer matters
export const LEVEL2_COST = 0.25; // score per yard of missing clearance, times vision
export const FLOW_HORIZON = 0.6; // s: longest look-ahead when projecting a second-level defender sideways

// Patience tunables (F-35): the RB presses toward the track point behind the line while he re-reads lanes, then commits.
export const PATIENCE_MAX = 0.8; // s: longest patience window
export const PRESS_DEPTH = 3 * BODY_RADIUS; // press point depth behind the los; must exceed LOCK_DEPTH so pressing never line-locks
export const CLEAR_ROOM = 4 * BODY_RADIUS; // a picked open lane with this much room to every free defender is clear
export const CLEAR_HOLD = 0.25; // s a lane must stay clear before it ends the patience (stays below the play's patience)
export const PRESSURE_DIST = 8 * BODY_RADIUS; // an unblocked defender this close ends the patience
export const BEND_MAX = 1; // times a committed RB may re-pick his lane while still behind the los (at most 2)
export const CUT_ALLOW = BODY_RADIUS / 2; // after the commit, how far the aim x may move from run.x
// The RB's pace per phase, as data.
export const SHUFFLE_WIDTH = BODY_RADIUS; // yd: lateral half-width of the patience shuffle around the track point
export const SHUFFLE_STEP = 0.12; // s: quick feet, time spent shuffling toward one side before flipping
export const SHUFFLE_LEAD = 0.5 * SHUFFLE_WIDTH; // yd: while he is farther than this from the track point the shuffle centers this far ahead of him, so the sides still reverse on the way in
export const SHUFFLE_CREEP = BODY_RADIUS; // yd: how far ahead of the RB (toward the press depth) the shuffle goal sits, so he creeps forward
export const PHASE_PACE = Object.freeze({ press: PACES.press, commit: PACES.burst });

// Patience window in seconds. `rb.patience` is the per-back rating hook (no roster value yet; absent means 1).
export function patienceWindow(runDef, rb) {
  return Math.min(PATIENCE_MAX, Math.max(0, (runDef.patience ?? 0) * (rb.patience ?? 1)));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const visionOf = (rb) => clamp(rb.vision ?? DEFAULT_VISION, 0, 1);

const PLAY_COUNT = LANES.filter((l) => l.side === 'play').length;
const BACK_COUNT = LANES.filter((l) => l.side === 'back').length;

// Live lane windows for both sides of the center. `line` = [{id, n}] of the numbered offensive
// players (identity only; positions are read live). A side stops after its first gap whose outer is false.
export function laneWindows(players, line, side) {
  const out = [];
  for (const [dir, count, key] of [[1, PLAY_COUNT, 'play'], [-1, BACK_COUNT, 'back']]) {
    const names = LANES.filter((l) => l.side === key).map((l) => l.name);
    const spans = liveGaps(players, line, side, dir, count);
    for (let k = 0; k < spans.length; k++) {
      out.push({ side: key, name: names[k], lo: spans[k].lo, hi: spans[k].hi });
      if (!spans[k].outer) break;
    }
  }
  return out;
}

// Free space of a window: [lo + H, hi - H] minus the removed interval of every other body in the band
// [los - GAP_BACK, los + LANE_AHEAD]. Fit versus threat: an offensive body or a defender with a blocker engaged is a
// wall he squeezes past (removes x +- H); a free defender is a threat and needs THREAT_MARGIN more each side.
// `room` is the least clearance |d.x - x| - H to any free defender between the carrier and the band's far edge.
// Optional `proj` = { vel: {id: {vx, vy}}, horizon } projects each free defender forward by `horizon` seconds (the RB's time
// to the los). A projected spot inside the band counts as a second body: it removes only H each side (a prediction, not yet
// a threat margin) and, as a free defender, lowers `room`. So a defender closing downhill from beyond the band is seen
// before he is in it. Without `proj` the read is the static band only.
export function freeLane(players, win, carrierId, los, proj) {
  let segs = win.lo + H < win.hi - H ? [[win.lo + H, win.hi - H]] : [];
  const free = (d) => d.team === 'defense' && engagedOn(players, d.id).length === 0;
  const bodies = [];
  for (const p of players) {
    if (p.id === carrierId) continue;
    if (p.y >= los - GAP_BACK && p.y <= los + LANE_AHEAD) bodies.push(p);
    const v = proj && free(p) ? proj.vel[p.id] : null;
    if (v) {
      const q = { id: p.id, team: p.team, projected: true, x: p.x + v.vx * proj.horizon, y: p.y + v.vy * proj.horizon };
      if (q.y >= los - GAP_BACK && q.y <= los + LANE_AHEAD && q.y < p.y) bodies.push(q);
    }
  }
  for (const p of bodies) {
    const m = H + (free(p) && !p.projected ? THREAT_MARGIN : 0);
    const l = p.x - m;
    const r = p.x + m;
    const next = [];
    for (const [s, e] of segs) {
      if (l > s) next.push([s, Math.min(e, l)]);
      if (r < e) next.push([Math.max(s, r), e]);
    }
    segs = next.filter(([s, e]) => e > s);
  }
  const mid = (win.lo + win.hi) / 2;
  let best = null;
  for (const [s, e] of segs) {
    const w = e - s;
    const d = Math.abs((s + e) / 2 - mid);
    if (!best || w > best.w + 1e-12 || (Math.abs(w - best.w) <= 1e-12 && d < best.d)) best = { w, d, x: (s + e) / 2 };
  }
  const width = best ? best.w : 0;
  const open = width >= MIN_LANE;
  const x = open ? best.x : mid;
  const rb = players.find((p) => p.id === carrierId);
  const yLo = rb ? rb.y : -Infinity;
  let room = Infinity;
  for (const d of [...players.filter((q) => q.id !== carrierId && q.y <= los + LANE_AHEAD), ...bodies.filter((q) => q.projected)]) {
    if (!free(d) || d.y < yLo) continue;
    room = Math.min(room, Math.abs(d.x - x) - H);
  }
  return { x, width, open, room };
}

// Live x of the track point: the numbered line player run.track, else the center, else the RB.
function trackPointX(players, run, rb) {
  const xOfN = (n) => {
    const e = run.line.find((l) => l.n === n);
    const p = e && players.find((q) => q.id === e.id);
    return p ? p.x : null;
  };
  return xOfN(run.track) ?? xOfN(0) ?? rb.x;
}

// Optional `flow` = {id: vx}: each defender's measured lateral velocity (no entry means 0). The second-level term projects
// every free defender between los + LANE_AHEAD and that plus SECOND_LEVEL_DEPTH sideways by the RB's time to the band
// (capped at FLOW_HORIZON); a lane loses vision * LEVEL2_COST per yard its clearance to the nearest one falls short of LEVEL2_CAP.
export function scoreLanes(players, run, rb, los, proj, flow) {
  const trackX = trackPointX(players, run, rb);
  const vision = visionOf(rb);
  const t = Math.min(FLOW_HORIZON, Math.max(0, los + LANE_AHEAD - rb.y) / (rb.speed || 1));
  const near = los + LANE_AHEAD;
  const second = players
    .filter((d) => d.team === 'defense' && d.y > near && d.y <= near + SECOND_LEVEL_DEPTH && engagedOn(players, d.id).length === 0)
    .map((d) => d.x + (flow?.[d.id] ?? 0) * t);
  return laneWindows(players, run.line, run.side).map((w) => {
    const f = freeLane(players, w, rb.id, los, proj);
    let room2 = Infinity;
    for (const px of second) room2 = Math.min(room2, Math.abs(px - f.x) - H);
    const level2 = vision * LEVEL2_COST * Math.max(0, LEVEL2_CAP - room2);
    const score = Math.min(f.room, ROOM_CAP) - TRACK_COST * Math.abs(f.x - trackX) - CUT_COST * Math.abs(f.x - rb.x) - level2;
    return { side: w.side, name: w.name, lo: w.lo, hi: w.hi, x: f.x, width: f.width, room: f.room, open: f.open, score, level2 };
  });
}

// R-45: seeded randomness chooses among open lanes within SWITCH_MARGIN of the best here; nothing else picks a lane.
export function chooseLane(lanes, current) {
  const cur = current ? lanes.find((l) => l.side === current.side && l.name === current.name) : undefined;
  let best = null;
  for (const l of lanes) if (l.open && (!best || l.score > best.score)) best = l;
  if (!best) return cur ?? lanes[0];
  if (cur && cur.open && best.score - cur.score <= SWITCH_MARGIN) return cur;
  return best;
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
    seen: {},
    mesh: { x: q.x, y: q.y + MESH_AHEAD },
    line: players.filter((p) => p.team === 'offense' && numbers[p.id] != null).map((p) => ({ id: p.id, n: numbers[p.id] })),
    track: runDef.track ?? TRACK,
    lane: { side: 'play', name: 'A' },
    lanes: [],
    gap: 'A',
    locked: false,
    patience: patienceWindow(runDef, rb),
    pressTime: 0,
    clearTime: 0,
    clearLane: null,
    bends: 0,
    pastLos: false,
    cut: 0,
    press: null,
    commitBy: null,
    carried: false,
    heldTime: 0,
    x: null,
    aim: { ...approach },
  };
}

// Carrier-owned memory: each free defender's velocity from his last-seen position, plus the RB's time to get through the band.
function readProjection(players, run, rb, los, dt) {
  const vel = {};
  const flow = {};
  for (const d of players) {
    if (d.team !== 'defense') continue;
    const prev = run.seen[d.id];
    if (prev && dt > 0) {
      const vx = (d.x - prev.x) / dt;
      const vy = (d.y - prev.y) / dt;
      const sp = Math.hypot(vx, vy);
      // A defender heading downhill is projected at his top speed along his heading (he is still accelerating); others at their velocity.
      const top = d.speed ?? 0;
      flow[d.id] = vx;
      vel[d.id] = vy < 0 && sp > top * CLOSING_FRACTION && top > 0 ? { vx: 0, vy: (vy / sp) * top } : { vx: 0, vy };
    }
    run.seen[d.id] = { x: d.x, y: d.y };
  }
  return { vel, flow, horizon: Math.max(0, los - rb.y) / (rb.speed || 1) };
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
  let justCommitted = false;
  const proj = readProjection(players, run, rb, los, dt);
  if (run.carried && !run.locked) {
    run.lanes = scoreLanes(players, run, rb, los, undefined, proj.flow);
    let pick = null;
    if (run.lanes.length) {
      pick = chooseLane(run.lanes, run.lane);
      run.lane = { side: pick.side, name: pick.name };
      run.gap = pick.name;
      run.aim = { x: pick.x, y: los };
    } else {
      run.aim = { x: rb.x, y: los };
    }
    run.pressTime += dt;
    const clear = !!(pick && pick.open && pick.room >= CLEAR_ROOM);
    if (clear && run.clearLane && run.clearLane.side === pick.side && run.clearLane.name === pick.name) run.clearTime += dt;
    else run.clearTime = clear ? dt : 0;
    run.clearLane = clear ? { side: pick.side, name: pick.name } : null;
    let by = null;
    if (run.pressTime >= run.patience - 1e-9) by = 'window';
    else if (run.clearTime >= CLEAR_HOLD - 1e-9) by = 'clear';
    else if (rb.y >= los - LOCK_DEPTH) by = 'line';
    else if (
      players.some(
        (d) => d.team === 'defense' && Math.hypot(d.x - rb.x, d.y - rb.y) <= PRESSURE_DIST && engagedOn(players, d.id).length === 0,
      )
    ) by = 'pressure';
    if (by) {
      run.commitBy = by;
      run.locked = true;
      run.x = run.aim.x;
      run.cut = 0;
      justCommitted = true;
    }
  }
  const key = 'lane:' + run.lane.side + ':' + run.lane.name;
  let goal;
  if (!run.carried) {
    run.aim = { ...run.approach };
    goal = { x: run.approach.x, y: run.approach.y, key: 'mesh', ignore: holdId };
  } else if (!run.locked) {
    run.press = { x: trackPointX(players, run, rb), y: los - PRESS_DEPTH };
    // Shuffle around the anchor: side flips every SHUFFLE_STEP of pressTime, first side moves him toward the track point.
    if (run.shuffleSide0 === undefined) run.shuffleSide0 = rb.x <= run.press.x ? 1 : -1;
    const flips = Math.floor((run.pressTime - dt) / SHUFFLE_STEP + 1e-9);
    const side = flips % 2 === 0 ? run.shuffleSide0 : -run.shuffleSide0;
    goal = {
      x: clamp(run.press.x, rb.x - SHUFFLE_LEAD, rb.x + SHUFFLE_LEAD) + side * SHUFFLE_WIDTH,
      y: Math.min(run.press.y, rb.y + SHUFFLE_CREEP),
      key: 'press:' + side,
      pace: PHASE_PACE.press,
      ignore: null,
    };
  } else {
    if (rb.y >= los) run.pastLos = true;
    if (!justCommitted && rb.y < los + LANE_AHEAD) {
      const w = laneWindows(players, run.line, run.side).find((e) => e.side === run.lane.side && e.name === run.lane.name);
      const free = w && freeLane(players, w, rb.id, los, proj);
      if (free && free.open) run.cut = clamp(free.x - run.x, -CUT_ALLOW, CUT_ALLOW);
      else if (!run.pastLos && (run.bends ?? 0) < BEND_MAX) {
        // Committed lane closed before the line: bend once into the best open lane.
        run.lanes = scoreLanes(players, run, rb, los, proj, proj.flow);
        const pick = run.lanes.length ? chooseLane(run.lanes, null) : null;
        if (pick && pick.open && (pick.side !== run.lane.side || pick.name !== run.lane.name)) {
          run.lane = { side: pick.side, name: pick.name };
          run.gap = pick.name;
          run.x = pick.x;
          run.cut = 0;
          run.bends = (run.bends ?? 0) + 1;
        }
      }
    }
    // Behind the line, run to the hole in his lane; turn vertical once at the line.
    // The turn is latched (pastLos): contact pushing him back behind the line must not flip the aim back.
    run.aim = { x: run.x + run.cut, y: !run.pastLos ? los + GAP_DEPTH : GOAL_LINE_Y };
    goal = { ...run.aim, key, pace: PHASE_PACE.commit, ignore: null };
  }
  steerStep(rb, goal, players, rb.speed * dt, dt, BODY_RADIUS);
  return handoff;
}
