// Ball carrier movement: live lane read on both sides of the center (laneWindows, freeLane,
// scoreLanes, chooseLane), the QB/RB mesh handoff check (the QB must hold
// the snap SECURE_TIME before handing off), and carrier steering. Pure: no THREE, DOM, timers.
// F-57: after the handoff he presses the playside guard's outside leg at a steady pace, declares bang, bend or bounce
// from the READS table over his perception cues (ctx.cues.run), commits on that read, picks his crease only among the
// call's lanes, and makes at most one cut, only before he reaches the hole.
import { steerStep, hardCore, PACES } from './steering.js';
import { BODY_RADIUS, engagedOn } from './blocking.js';
import { PLAYSIDE_SIGN } from './numbering.js';
import { liveGaps } from './front.js';
import { HW } from '../util.js';
import { project } from './geometry.js';

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
export const SWITCH_MARGIN =BODY_RADIUS / 2; // score a rival lane must beat the current one by

// Vision (F-48): the RB looks past the line band to the second level when scoring a hole.
export const DEFAULT_VISION = 0.5; // a back with no vision rating
export const SECOND_LEVEL_DEPTH = 18 * BODY_RADIUS; // yd: depth of the second level beyond los + LANE_AHEAD
export const LEVEL2_CAP = 8 * BODY_RADIUS; // yd: lateral clearance beyond which a second-level defender no longer matters
export const LEVEL2_COST = 0.25; // score per yard of missing clearance, times vision
export const FLOW_HORIZON = 0.6; // s: longest look-ahead when projecting a second-level defender sideways

// Open-field avoidance (F-48): past the los the RB bends away from free defenders he can see.
export const AVOID_SIGHT_MIN = 3; // yd: sight range at vision 0
export const AVOID_SIGHT_MAX = 9; // yd: sight range at vision 1
export const AVOID_FAN = Math.PI / 3; // rad: widest heading off vertical, so he never runs backward or flat
export const NEAR_FIELD = 4; // yd past the los where the narrower fan applies
export const AVOID_FAN_NEAR = Math.PI / 9; // rad: widest heading off vertical within NEAR_FIELD of the los (one cut, then vertical)
export const AVOID_STEP = Math.PI / 36; // rad: candidate heading spacing (5 deg)
export const AVOID_CONTACT = 2 * BODY_RADIUS + 0.3; // yd: distance at which a defender has him
export const AVOID_SIDELINE = 1; // yd: the ray stops this far inside the sideline
export const AVOID_TURN_COST = 0.25; // yd of safe run per radian of turn away from the no-threat heading
export const AVOID_SWITCH = 1.5; // yd: score a rival heading must beat the held one by
export const AVOID_HOLD = 0.3; // s: a new heading is held at least this long
export const AVOID_LINGER = 0.5; // s: a cut line is kept this long after the last man leaves his sight
export const AVOID_AIM_DIST = 4; // yd: how far ahead along a candidate heading the sideline filter looks
export const AVOID_CLOSE = AVOID_CONTACT + 2 * BODY_RADIUS; // yd: inside this a free defender is on him, so he squeezes and takes the hit instead of cutting
const AVOID_RAY_STEP = 0.25; // yd

// Patience tunables (F-35): the RB presses toward the track point behind the line while he re-reads lanes, then commits.
export const PATIENCE_MAX = 0.8; // s: longest patience window
export const PRESS_DEPTH = 3 * BODY_RADIUS; // press point depth behind the los; must exceed LOCK_DEPTH so pressing never line-locks
export const AIM_LEG = BODY_RADIUS; // yd from the playside guard's centre to his outside leg: the press aiming point
export const PRESSURE_DIST = 8 * BODY_RADIUS; // an unblocked defender this close ends the patience
export const BEND_MAX = 1; // times a committed RB may cut to another lane before he reaches the hole (at most 2)
export const CUT_ALLOW = BODY_RADIUS / 2; // after the commit, how far the aim x may move from run.x
// The RB's pace per phase, as data.
export const PHASE_PACE = Object.freeze({ press: PACES.press, commit: PACES.burst });

// The read (inside-zone spec, "RB"): "bang (key driven or widens: hit it playside A or B), bend (playside clogged: key
// squeezes or Mike fills fast: cut back into backside A or B behind the C/LG double), bounce (rarely: playside end reached
// and edge open: take it outside)". Rows are checked in order, first match wins; a row's conditions all hold.
// key/end: allowed moves of the key defender / allowed felt cues of the end defender; noPlayFlow: no playside LB flowing
// playside; lbFill: some playside LB is filling. late: checked only once his patience window is up.
// The RB keys the first down lineman playside of the center; the linebacker row is his tiebreak when the key has not
// declared by the end of his patience (spec: "Mike fills fast"), because linebackers read 'filling' soon after nearly
// every handoff.
export const READS = Object.freeze([
  Object.freeze({ call: 'bang', why: 'key driven', key: Object.freeze(['driven']) }),
  Object.freeze({ call: 'bang', why: 'key widen', key: Object.freeze(['widen']) }),
  Object.freeze({ call: 'bounce', why: 'edge reached', key: Object.freeze(['squeeze', 'upfield']), end: Object.freeze(['reach']), noPlayFlow: true }),
  Object.freeze({ call: 'bend', why: 'key squeeze', key: Object.freeze(['squeeze']) }),
  Object.freeze({ call: 'bend', why: 'key upfield', key: Object.freeze(['upfield']) }),
  Object.freeze({ call: 'bend', why: 'playside LB fills', lbFill: true, late: true }),
]);

// The call's lanes, in preference order, and the call he falls back to when none of them is open.
const lane = (side, name) => Object.freeze({ side, name });
export const CALL_LANES = Object.freeze({
  bang: Object.freeze([lane('play', 'A'), lane('play', 'B')]),
  bend: Object.freeze([lane('back', 'A'), lane('back', 'B')]),
  bounce: Object.freeze([lane('play', 'C')]),
});
export const CALL_FALLBACK = Object.freeze({ bang: 'bend', bend: 'bang', bounce: 'bang' });

const playLbs = (cue) => Object.values(cue.lbs ?? {}).filter((l) => l.side === 'play' || l.side === 'head');
const readMatches = (row, cue) => {
  const k = cue.key != null ? cue.dl?.[cue.key] : null;
  if (row.key && !(k && row.key.includes(k.move))) return false;
  if (row.end) {
    const e = cue.end != null && cue.end !== cue.key ? cue.dl?.[cue.end] : null;
    if (!e || !row.end.includes(e.felt)) return false;
  }
  if (row.noPlayFlow && playLbs(cue).some((l) => l.state === 'flowing' && l.dir === 1)) return false;
  if (row.lbFill && !playLbs(cue).some((l) => l.state === 'filling')) return false;
  return true;
};

// The call his cues declare: { call, why } of the first matching row, or null (keep pressing).
export function readCall(cue, late = false) {
  if (!cue) return null;
  const row = READS.find((r) => (late || !r.late) && readMatches(r, cue));
  return row ? { call: row.call, why: row.why } : null;
}

// The crease: the best open lane among the call's lanes, else among the fallback call's, else the call's widest lane.
export function pickCrease(lanes, call) {
  if (!lanes.length) return null;
  const of = (c) => CALL_LANES[c].map((cl) => lanes.find((l) => l.side === cl.side && l.name === cl.name)).filter(Boolean);
  const bestOpen = (ls) => ls.reduce((b, l) => (l.open && (!b || l.score > b.score) ? l : b), null);
  const mine = of(call);
  const pick = bestOpen(mine) ?? bestOpen(of(CALL_FALLBACK[call]));
  if (pick) return pick;
  return mine.reduce((b, l) => (!b || l.width > b.width + 1e-12 ? l : b), null) ?? lanes[0];
}

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
      const q = { id: p.id, team: p.team, projected: true, ...project(p, { x: v.vx, y: v.vy }, proj.horizon) };
      // Any defender who is going somewhere else adds a body where he is going (downhill closing and lateral flow alike); one
      // who stays put adds none, his current-spot body (with THREAT_MARGIN) already stands in the band.
      const moves = Math.hypot(q.x - p.x, q.y - p.y) > 1e-9;
      if (q.y >= los - GAP_BACK && q.y <= los + LANE_AHEAD && moves) bodies.push(q);
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
  // seg: where a closed window is least blocked: the widest remaining slot, else the point farthest from every defender body.
  let seg = best ? best.x : mid;
  if (!best) {
    const xs = bodies.filter((p) => p.team === 'defense').map((p) => p.x).filter((v) => v > win.lo && v < win.hi).sort((a, b) => a - b);
    const cands = [win.lo, ...xs.slice(1).map((v, i) => (v + xs[i]) / 2), win.hi];
    if (!xs.length) cands.push(mid);
    else cands.push((win.lo + xs[0]) / 2, (xs[xs.length - 1] + win.hi) / 2);
    const clear = (c) => Math.min(Infinity, ...bodies.filter((p) => p.team === 'defense').map((p) => Math.abs(p.x - c)));
    let bd = -1;
    for (const c of cands) if (clear(c) > bd + 1e-12) { bd = clear(c); seg = c; }
  }
  const rb = players.find((p) => p.id === carrierId);
  const yLo = rb ? rb.y : -Infinity;
  let room = Infinity;
  for (const d of [...players.filter((q) => q.id !== carrierId && q.y <= los + LANE_AHEAD), ...bodies.filter((q) => q.projected)]) {
    if (!free(d) || d.y < yLo) continue;
    room = Math.min(room, Math.abs(d.x - x) - H);
  }
  return { x, seg, width, open, room };
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
    .map((d) => project(d, { x: flow?.[d.id] ?? 0, y: 0 }, t).x);
  return laneWindows(players, run.line, run.side).map((w) => {
    const f = freeLane(players, w, rb.id, los, proj);
    let room2 = Infinity;
    for (const px of second) room2 = Math.min(room2, Math.abs(px - f.x) - H);
    const level2 = vision * LEVEL2_COST * Math.max(0, LEVEL2_CAP - room2);
    const score = Math.min(f.room, ROOM_CAP) - TRACK_COST * Math.abs(f.x - trackX) - CUT_COST * Math.abs(f.x - rb.x) - level2;
    return { side: w.side, name: w.name, lo: w.lo, hi: w.hi, x: f.x, seg: f.seg, width: f.width, room: f.room, open: f.open, score, level2 };
  });
}

// R-45: seeded randomness chooses among open lanes within SWITCH_MARGIN of the best here; nothing else picks a lane.
// chooseLane is pure (kept for callers; stepCarrier now picks through pickCrease).
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
    bends: 0,
    pastLos: false,
    avoid: null,
    avoidAt: 0,
    avoidClock: 0,
    avoidLine: null,
    avoidSeen: 0,
    avoidForced: false, // the last switch left a line that ran into a man
    cut: 0,
    press: null,
    commitBy: null,
    call: null,
    why: null,
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
      vel[d.id] = vy < 0 && sp > top * CLOSING_FRACTION && top > 0 ? { vx: (vx / sp) * top, vy: (vy / sp) * top } : { vx, vy };
    }
    run.seen[d.id] = { x: d.x, y: d.y };
  }
  return { vel, flow, horizon: Math.max(0, los - rb.y) / (rb.speed || 1) };
}

// Safe run of heading th from the RB: how far along the ray he gets before a seen defender can reach the spot first.
function safeRun(rb, th, threats, sight) {
  const sx = Math.sin(th);
  const sy = Math.cos(th);
  const rbSpeed = rb.speed || 1;
  for (let s = AVOID_RAY_STEP; s <= sight + 1e-9; s += AVOID_RAY_STEP) {
    const px = rb.x + s * sx;
    if (Math.abs(px) > HW - AVOID_SIDELINE) return s - AVOID_RAY_STEP;
    const py = rb.y + s * sy;
    for (const d of threats) {
      const gap = Math.hypot(px - d.x, py - d.y) - AVOID_CONTACT;
      if (gap <= 0 || (d.speed > 0 && gap / d.speed <= s / rbSpeed)) return s - AVOID_RAY_STEP;
    }
  }
  return sight;
}

// A cut line from (x, y) at heading th, with its far point: where it first reaches the sideline inset or the goal line.
function cutLine(x, y, th) {
  const sn = Math.sin(th), cs = Math.cos(th);
  let s = cs > 1e-9 ? Math.max(0, (GOAL_LINE_Y - y) / cs) : 0;
  if (Math.abs(sn) > 1e-9) {
    const sx = (Math.sign(sn) * (HW - AVOID_SIDELINE) - x) / sn;
    if (sx >= 0 && sx < s) s = sx;
  }
  return { x, y, th, far: { x: x + s * sn, y: y + s * cs } };
}

// The committed aim past the los: vertical when nobody is seen, else the best held heading away from free defenders.
function openFieldAim(players, run, rb, dt, los, proj) {
  const fan = rb.y - los < NEAR_FIELD ? AVOID_FAN_NEAR : AVOID_FAN;
  const vertical = { x: run.x + run.cut, y: GOAL_LINE_Y };
  const sight = AVOID_SIGHT_MIN + visionOf(rb) * (AVOID_SIGHT_MAX - AVOID_SIGHT_MIN);
  const threats = players.filter(
    (d) =>
      d.team === 'defense' &&
      d.y >= rb.y - 2 * BODY_RADIUS &&
      Math.hypot(d.x - rb.x, d.y - rb.y) <= sight &&
      engagedOn(players, d.id).length === 0,
  );
  run.avoidClock += dt;
  // A cut is committed: if the man drops out of sight, finish the line for AVOID_LINGER before running vertical again.
  if (threats.length) run.avoidSeen = run.avoidClock;
  // Inside arm's reach he cannot cut cleanly: no new heading, keep the current aim (held cut line, else vertical).
  const heldAim = () => {
    if (run.avoid === null || run.avoid === 0 || !run.avoidLine) return vertical;
    const far = run.avoidLine.far;
    // Pushed off the line he cut, the fixed far point can sit wider than the fan allows from where he now stands:
    // move the landmark (kept, so it stays fixed again) to the fan edge at the same depth.
    if (Math.abs(Math.atan2(far.x - rb.x, far.y - rb.y)) <= fan + 1e-9) return far;
    const edge = Math.sign(far.x - rb.x) * fan;
    run.avoidLine.far = { x: rb.x + (far.y - rb.y) * Math.tan(edge), y: far.y };
    return run.avoidLine.far;
  };
  if (threats.some((d) => Math.hypot(d.x - rb.x, d.y - rb.y) < AVOID_CLOSE)) return heldAim();
  const holding = run.avoid !== null && run.avoid !== 0 && run.avoidClock - run.avoidSeen < AVOID_LINGER - 1e-9;
  if (!threats.length && !holding) {
    run.avoid = null;
    return vertical;
  }
  // Headings are stored as an offset from the no-threat heading thV (offset 0 is the vertical aim itself), so a heading
  // that ignores the threat is the exact vertical aim and a held heading does not drift as he moves.
  const thV = Math.atan2(vertical.x - rb.x, vertical.y - rb.y);
  const absOf = (off) => clamp(thV + off, -fan, fan);
  const score = (off) => {
    const th = absOf(off);
    const S = safeRun(rb, th, threats, sight);
    // miss: the smallest lateral distance by which the heading line passes a threat ahead of him (Infinity: none ahead).
    // A heading is "at" a threat when it passes closer than AVOID_CONTACT, however short every safe run is.
    let miss = Infinity;
    for (const d of threats) {
      const along = (d.x - rb.x) * Math.sin(th) + (d.y - rb.y) * Math.cos(th);
      if (along <= 0) continue;
      // Judge him where he will be when the RB gets to him (lateral flow included), not where he stands now.
      const v = proj?.vel[d.id];
      const q = project(d, v ? { x: v.vx, y: v.vy } : undefined, Math.min(FLOW_HORIZON, along / (rb.speed || 1)));
      const dx = q.x - rb.x, dy = q.y - rb.y;
      miss = Math.min(miss, Math.abs(dx * Math.cos(th) - dy * Math.sin(th)));
    }
    return { off, S, miss, at: miss < AVOID_CONTACT, score: S * Math.cos(th) - AVOID_TURN_COST * Math.abs(th - thV) };
  };
  const n = Math.round(2 * AVOID_FAN / AVOID_STEP);
  const better = (c, b) => !b || c.score > b.score + 1e-9 || (Math.abs(c.score - b.score) <= 1e-9 && Math.abs(c.off) < Math.abs(b.off));
  let best = null; // best heading that is not at a man
  let widest = null; // fallback when every heading is at one: the largest miss
  for (let k = -n; k <= n; k++) {
    const off = k * AVOID_STEP;
    if (k !== 0 && Math.abs(thV + off) > fan + 1e-9) continue;
    const ax = rb.x + AVOID_AIM_DIST * Math.sin(absOf(off));
    if (Math.abs(ax) > HW - AVOID_SIDELINE && Math.abs(ax) > Math.abs(rb.x)) continue; // never aim toward the sideline
    const c = score(off);
    if (!c.at && better(c, best)) best = c;
    if (!widest || c.miss > widest.miss + 1e-9 || (Math.abs(c.miss - widest.miss) <= 1e-9 && Math.abs(c.off) < Math.abs(widest.off))) widest = c;
  }
  if (!best) best = widest;
  let off = best.off;
  if (run.avoid !== null) {
    const held = score(run.avoid);
    const free = run.avoidClock - run.avoidAt >= AVOID_HOLD - 1e-9 || held.S < AVOID_CONTACT;
    if (held.at && !best.at) {
      // The held line now runs at a free defender (none inside AVOID_CLOSE): release it at once.
      run.avoidForced = true;
    } else if (!(free && best.score > held.score + AVOID_SWITCH)) off = run.avoid;
    else run.avoidForced = held.S < AVOID_CONTACT;
  }
  if (off !== run.avoid) {
    run.avoid = off;
    run.avoidAt = run.avoidClock;
    run.avoidLine = cutLine(rb.x, rb.y, absOf(off)); // the line he cuts onto: a plant, then this line
  }
  // Aim at the fixed far point of the cut line (a landmark, like the vertical aim), so the aim does not slide with him.
  return heldAim();
}

export function stepCarrier(players, run, { los, ballHeld, holdId, cues }, dt) {
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
    run.press = { x: trackPointX(players, run, rb) + run.side * AIM_LEG, y: los - PRESS_DEPTH };
    run.aim = { ...run.press };
    run.lanes = scoreLanes(players, run, rb, los, undefined, proj.flow);
    run.pressTime += dt;
    const read = readCall(cues?.run, run.pressTime >= run.patience - 1e-9);
    let by = null;
    if (read) by = 'read';
    else if (run.pressTime >= run.patience - 1e-9) by = 'window';
    else if (rb.y >= los - LOCK_DEPTH) by = 'line';
    else if (
      players.some(
        (d) => d.team === 'defense' && Math.hypot(d.x - rb.x, d.y - rb.y) <= PRESSURE_DIST && engagedOn(players, d.id).length === 0,
      )
    ) by = 'pressure';
    if (by) {
      run.commitBy = by;
      run.call = read ? read.call : 'bang';
      run.why = read ? read.why : by;
      run.lanes = scoreLanes(players, run, rb, los, proj, proj.flow);
      const pick = pickCrease(run.lanes, run.call);
      if (pick) {
        run.lane = { side: pick.side, name: pick.name };
        run.gap = pick.name;
        run.x = pick.open ? pick.x : pick.seg;
      } else {
        run.x = rb.x;
      }
      run.locked = true;
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
    goal = { x: run.press.x, y: run.press.y, key: 'press', pace: PHASE_PACE.press, ignore: null };
  } else {
    if (rb.y >= los) run.pastLos = true;
    if (!justCommitted && !run.pastLos && rb.y < los + LANE_AHEAD) {
      const w = laneWindows(players, run.line, run.side).find((e) => e.side === run.lane.side && e.name === run.lane.name);
      const free = w && freeLane(players, w, rb.id, los, proj);
      const open = !!(free && free.open);
      let cut = false;
      // One cut, only before he reaches the hole: the lane reads closed, or the read now declares another call.
      if (rb.y < los - GAP_BACK && run.bends < BEND_MAX) {
        const now = readCall(cues?.run, true);
        if (!open || (now && now.call !== run.call)) {
          const call = now?.call ?? run.call;
          const lanes = scoreLanes(players, run, rb, los, proj, proj.flow);
          run.lanes = lanes;
          const pick = pickCrease(lanes, call);
          if (pick && pick.open && (pick.side !== run.lane.side || pick.name !== run.lane.name)) {
            run.lane = { side: pick.side, name: pick.name };
            run.gap = pick.name;
            run.x = pick.x;
            run.cut = 0;
            run.bends++;
            run.call = call;
            run.why = 'cut: ' + (now?.why ?? run.why);
            cut = true;
          }
        }
      }
      if (!cut && free) run.cut = clamp((open ? free.x : free.seg) - run.x, -CUT_ALLOW, CUT_ALLOW);
    }
    // Behind the line, run to the hole in his lane; turn vertical once at the line.
    // The turn is latched (pastLos): contact pushing him back behind the line must not flip the aim back.
    run.aim = !run.pastLos ? { x: run.x + run.cut, y: los + GAP_DEPTH } : openFieldAim(players, run, rb, dt, los, proj);
    goal = { ...run.aim, key, pace: PHASE_PACE.commit, ignore: null, forward: true };
  }
  steerStep(rb, goal, players, rb.speed * dt, dt, BODY_RADIUS);
  return handoff;
}
