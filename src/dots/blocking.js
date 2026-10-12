// Pure blocking logic for the dots layer: no THREE, no DOM, no timers, no randomness.
import { HW } from '../util.js';
import { steerStep, hardCore, CUT_ACCEL } from './steering.js';
import { stepReact } from './react.js';
import { startFoot, retargetFoot, footGoal, footPush, RIDE_MIN } from './technique.js';

export const BLOCKER_ROLES = ['OL', 'TE'];
// 0.56 yd = 20 in wide, the top of the 16-20 in shoulder range; area about 2.2 sq ft, between
// the 1.5 sq ft crush minimum and the 2.5-3 sq ft comfortable footprint.
export const BODY_RADIUS = 0.28;
const H = hardCore(BODY_RADIUS); // hard contact distance; the soft zone is [H, 2 * BODY_RADIUS)
// Fraction of soft-zone penetration relaxed per second of sim time.
export const SOFT_RATE = 8;
export const CONTACT_DIST = 2 * BODY_RADIUS;
export const ENGAGE_TOL = 0.25;
export const SPREAD = 2 * BODY_RADIUS;
export const DRIVE_RATE = 1.5;
export const ENGAGED_MAX_SPEED = 2.5;
export const PEEL_DIST = 2.0;
export const Y_MIN = -10;
export const Y_MAX = 110;
export const SEPARATION_ITERS = 30;
// Per-tick allowance over speed * dt for an engaging blocker (separation push).
// Engage only this close to the target (inside canRelease's 'lost' range of ENGAGE_TOL), so a
// fresh block is not dropped on the next tick when the target steps away.
const ENGAGE_NEAR = 0.75 * ENGAGE_TOL;
export const ENGAGE_SLACK = BODY_RADIUS / 10;
// Tunable: seconds the target must be 'winning' before the block is shed.
export const SHED_TIME = 0.3;
// Tunable: yards the ball must be upfield of the target for the blocker to let go.
export const RELEASE_PAST = 4 * BODY_RADIUS;
// Tunable: seconds after a shed or lost block before the blocker may engage again.
export const REENGAGE_DELAY = 0.5;

export const BLOCK_ANGLES = Object.freeze({
  straight: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -Math.SQRT1_2, y: Math.SQRT1_2 }),
  right: Object.freeze({ x: Math.SQRT1_2, y: Math.SQRT1_2 }),
});

export const isBlocker = (p) => BLOCKER_ROLES.includes(p.role);

const byId = (players, id) => players.find((p) => p.id === id);
const isDefense = (p) => p && p.team === 'defense';

export function assignBlocks(players, plan, techs) {
  for (const p of players) p.block = null;
  for (const b of players) {
    if (!isBlocker(b)) continue;
    if (plan && Object.hasOwn(plan, b.id) && isDefense(byId(players, plan[b.id]))) {
      b.block = { target: plan[b.id], angle: 'straight', engaged: false, seq: null };
      const t = techs?.[b.id];
      if (t) {
        const foot = startFoot(t.tech, t.shade, t.watch, b, byId(players, plan[b.id]));
        if (foot) b.block.foot = foot;
      }
      continue;
    }
    let best = null;
    let bestD = Infinity;
    for (const d of players) {
      if (!isDefense(d)) continue;
      const dist = Math.hypot(d.x - b.x, d.y - b.y);
      if (best === null || dist < bestD - 1e-9) {
        best = d;
        bestD = dist;
      }
    }
    if (best) b.block = { target: best.id, angle: 'straight', engaged: false, seq: null };
  }
}

export function setBlock(players, blockerId, targetId, angle = 'straight') {
  const b = byId(players, blockerId);
  if (!b || !isBlocker(b)) return false;
  if (!isDefense(byId(players, targetId))) return false;
  if (!Object.hasOwn(BLOCK_ANGLES, angle)) return false;
  if (b.block && b.block.target === targetId) b.block.angle = angle;
  else {
    const old = b.block;
    b.block = { target: targetId, angle, engaged: false, seq: null };
    if (old?.foot) {
      const f = retargetFoot(old.foot, b, byId(players, targetId));
      if (f) b.block.foot = f;
    }
  }
  return true;
}

export function clearBlock(players, blockerId) {
  const b = byId(players, blockerId);
  if (!b || !isBlocker(b) || !b.block) return false;
  b.block = null;
  return true;
}

export function engagedOn(players, defenderId) {
  return players.filter((p) => p.block && p.block.engaged && p.block.target === defenderId);
}

// Spot of the i-th of k blockers in one angle group, with the push direction
// rotated `extra` radians outward (0 = the plain BLOCK_ANGLES direction).
function groupSpot(T, angle, i, k, extra) {
  const base = BLOCK_ANGLES[angle];
  const side = Math.sign(base.x);
  const a = Math.atan2(Math.abs(base.x), base.y) + extra;
  const d = { x: side * Math.sin(a), y: Math.cos(a) };
  const offset = (i - (k - 1) / 2) * SPREAD;
  return {
    x: T.x - d.x * CONTACT_DIST + d.y * offset,
    y: T.y - d.y * CONTACT_DIST - d.x * offset,
  };
}

const GROUP_ORDER = ['straight', 'left', 'right'];
const ROTATE_STEP = Math.PI / 720; // 0.25 degree
const ROTATE_MAX = Math.PI * 85 / 180;

// One angle on the target: exactly the plain spots. Several angles: diagonal spots on the
// CONTACT_DIST circle sit only ~0.77 CONTACT_DIST from their neighbours, so overlapping
// bodies were shoved off them every frame. Place the straight group first, then rotate each
// diagonal group outward from its nominal angle in fixed steps until every spot is at least
// 2 * BODY_RADIUS from all spots already placed (the 60 degree chord for a lone pair, further
// when the straight group is spread). Rotating keeps the radius, so no spot nears the target.
export function contactSpot(players, blocker) {
  const T = byId(players, blocker.block.target);
  const onTarget = players.filter((p) => isBlocker(p) && p.block && p.block.target === blocker.block.target);
  const angles = GROUP_ORDER.filter((g) => onTarget.some((p) => p.block.angle === g));
  const own = blocker.block.angle;
  const group = (g) => onTarget.filter((p) => p.block.angle === g);
  if (angles.length <= 1) {
    const co = group(own);
    return groupSpot(T, own, co.indexOf(blocker), co.length, 0);
  }
  const min = 2 * BODY_RADIUS - 1e-9;
  const placed = [];
  let mine = null;
  for (const g of angles) {
    const co = group(g);
    const k = co.length;
    const spots = (extra) => co.map((_, i) => groupSpot(T, g, i, k, extra));
    let extra = 0;
    let s = spots(extra);
    if (g !== 'straight') {
      const ok = (ss) => ss.every((q) => placed.every((r) => Math.hypot(q.x - r.x, q.y - r.y) >= min));
      while (!ok(s) && extra < ROTATE_MAX) {
        extra += ROTATE_STEP;
        s = spots(extra);
      }
    }
    placed.push(...s);
    if (g === own) mine = s[co.indexOf(blocker)];
  }
  return mine;
}

// Tunable: rad/s a lone engaged blocker's contact line turns toward his push direction.
export const CONTACT_TURN = Math.PI / 2;

// Spot an engaged blocker follows. A lone blocker's spot sits on CONTACT_DIST around the target at
// his own bearing state b.block.fa (atan2 of the unit vector blocker -> target). It starts on the
// actual contact line (on engage, or when he becomes lone) and turns gradually toward his push
// direction; it is not re-derived from his position each tick, so a smooth follow does not slow
// the turn, and he never snaps to the fixed BLOCK_ANGLES spot. When another blocker has the same
// target (engaged or still closing, e.g. a combo partner) the contactSpot group placement applies
// unchanged and fa resets, so the pair keeps its geometry and the climb timing.
function followSpot(players, b, dt, dT = { x: 0, y: 0 }) {
  const T = byId(players, b.block.target);
  if (players.some((p) => p !== b && isBlocker(p) && p.block && p.block.target === b.block.target)) {
    b.block.fa = null;
    b.block.fw = null;
    return contactSpot(players, b);
  }
  const base = BLOCK_ANGLES[b.block.angle];
  if (b.block.fa == null) {
    const dx = T.x - dT.x - b.x;
    const dy = T.y - dT.y - b.y;
    const dist = Math.hypot(dx, dy);
    const a = dist < 1e-9 ? base : { x: dx / dist, y: dy / dist };
    b.block.fa = Math.atan2(a.x, a.y);
    b.block.fw = null;
    b.block.fd = 0;
    b.block.fx = 0;
  }
  // Aim between his push and his block angle: he follows the defender's travel without
  // trailing upfield of him (a pure push-following blocker lets a rusher run the arc and win).
  const push = b.block.foot?.push ?? base;
  const wm = Math.hypot(push.x + base.x, push.y + base.y) || 1;
  const want = { x: (push.x + base.x) / wm, y: (push.y + base.y) / wm };
  const cur = b.block.fa;
  const wa = Math.atan2(want.x, want.y);
  let diff = wa - cur;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  // While the aim is already sweeping toward his bearing (block.fw = last tick's aim), the two close
  // at most at CONTACT_TURN together: he turns only by what the sweep leaves, and holds when the aim
  // comes at that rate by itself. Turning to meet it would overshoot and turn back (wobble, #11).
  const prevAim = b.block.fw;
  b.block.fw = wa;
  const sweep = prevAim == null ? 0 : Math.atan2(Math.sin(wa - prevAim), Math.cos(wa - prevAim));
  const closing = sweep * diff < 0;
  const room = Math.max(0, CONTACT_TURN * dt - (closing ? Math.abs(sweep) : 0));
  let turn = Math.sign(diff) * Math.min(Math.abs(diff), room);
  // Once his bearing has turned one way (block.fd) it holds that direction: the aim easing back as
  // the ride angle relaxes with a slowing LB is no reason to turn back (wobble, #11). Released only
  // when his man's lateral travel really reverses (beyond RIDE_MIN against block.fx, the sign of the
  // last such travel); a new target or a partner joining or leaving resets fa and with it fd and fx.
  const tvx = T.vel?.x ?? 0;
  if (Math.abs(tvx) > RIDE_MIN) {
    if (b.block.fx && Math.sign(tvx) !== b.block.fx) b.block.fd = 0;
    b.block.fx = Math.sign(tvx);
  }
  if (b.block.fd && Math.sign(turn) === -b.block.fd) turn = 0;
  if (Math.abs(turn) > 1e-12) b.block.fd = Math.sign(turn);
  let n = Math.atan2(Math.sin(cur + turn), Math.cos(cur + turn));
  // His own momentum carrying him further round in the held direction is kept, not pulled back
  // (#12): the bearing moves up to his actual contact line (blocker and target at the same instant).
  const cx = T.x - dT.x - b.x;
  const cy = T.y - dT.y - b.y;
  if (b.block.fd && Math.hypot(cx, cy) > 1e-9) {
    const ca = Math.atan2(cx, cy);
    if (Math.sign(Math.atan2(Math.sin(ca - n), Math.cos(ca - n))) === b.block.fd) n = ca;
  }
  b.block.fa = n;
  return { x: T.x - Math.sin(n) * CONTACT_DIST, y: T.y - Math.cos(n) * CONTACT_DIST };
}

// Single place where future factors (skills, leverage, fatigue) multiply in.
export const driveForce = (p) => p.strength;
// Single place where future factors (skills, leverage, fatigue) multiply in.
export const blockForce = (p) => p.strength;

// Summed blocker push vector and the number of blockers summed (n). Single source of the push sum; stepReact reads n to tell a double team.
export function blockPush(blockers) {
  let x = 0;
  let y = 0;
  for (const b of blockers) {
    const d = b.block.foot?.push ?? BLOCK_ANGLES[b.block.angle];
    const bf = blockForce(b);
    x += bf * d.x;
    y += bf * d.y;
  }
  return { x, y, n: blockers.length };
}

// Single place a future weight rating goes.
export const massOf = (p) => p.strength;

// Tunables: share of the defender's sliding speed the hands take away at contact; seconds the hit's
// impulse is spread over; seconds the defender's velocity takes to ease to the block-resolved one;
// 1 / w of the engaged blocker's critically damped correction toward his follow spot.
export const CONTACT_GRIP = 0.25;
export const IMPACT_TIME = 0.1;
export const ENGAGE_TAU = 0.2;
export const FOLLOW_TAU = 0.13;

// Velocity change of each body from the hit (mass-weighted along the contact line, plus a grip on
// the defender's sliding). Pure.
export function contactImpulse(d, b) {
  const zero = { d: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  const dx = d.x - b.x;
  const dy = d.y - b.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return zero;
  const nx = dx / len;
  const ny = dy / len;
  const vd = d.vel ?? { x: 0, y: 0 };
  const vb = b.vel ?? { x: 0, y: 0 };
  const ud = vd.x * nx + vd.y * ny;
  const ub = vb.x * nx + vb.y * ny;
  const out = { d: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  if (ub > ud) {
    const md = massOf(d);
    const mb = massOf(b);
    const u = (md * ud + mb * ub) / (md + mb);
    out.d.x += (u - ud) * nx;
    out.d.y += (u - ud) * ny;
    out.b.x += (u - ub) * nx;
    out.b.y += (u - ub) * ny;
  }
  out.d.x -= CONTACT_GRIP * (vd.x - ud * nx);
  out.d.y -= CONTACT_GRIP * (vd.y - ud * ny);
  return out;
}

// Velocity easing toward goal with time constant tau, acting on the post-hit velocity (prev plus the
// impulse still to deliver), never on the approach speed the impulse removes (R-71: no double count).
// m = prev + R0, m' = m + (goal - m) * k, velocity = m' - (R0 - kick); kick = what the hit delivers
// this tick (impact.t counts down). With no impact this is the plain easing; when the window ends
// the velocity is the eased post-hit one, so it moves monotonically from the common velocity toward
// the goal at any dt. bump (optional, same shape as impact) is a body collision's stop, spread and
// eased the same way but not part of kick. Pure apart from impact.t and bump.t.
export function carryVelocity(prev, goal, impact, dt, tau, bump) {
  const k = 1 - Math.exp(-dt / tau);
  const ri = impactLeft(impact);
  const rb = impactLeft(bump);
  const kick = impactStep(impact, dt);
  const bk = impactStep(bump, dt);
  const rx = ri.x + rb.x;
  const ry = ri.y + rb.y;
  const mx = prev.x + rx;
  const my = prev.y + ry;
  const vx = mx + (goal.x - mx) * k - (rx - kick.x - bk.x);
  const vy = my + (goal.y - my) * k - (ry - kick.y - bk.y);
  return { vx, vy, kick };
}

// Impulse the hit still has to deliver (zero when none).
function impactLeft(impact) {
  return impact && impact.t > 0 ? { x: impact.ax * impact.t, y: impact.ay * impact.t } : { x: 0, y: 0 };
}

// Velocity the hit adds this tick (its acceleration over the part of dt it still lasts), counting
// impact.t down. The full impulse ax * IMPACT_TIME is delivered exactly, whatever dt.
function impactStep(impact, dt) {
  if (!impact || impact.t <= 0) return { x: 0, y: 0 };
  const s = Math.min(dt, impact.t);
  impact.t -= dt;
  if (impact.t <= 1e-9) impact.t = 0;
  return { x: impact.ax * s, y: impact.ay * s };
}

// One exact tick of the critically damped follower e'' + 2w e' + w^2 e = 0 (w = 1 / tau), with e
// the error and u its rate. Stable for any dt and never rings. Pure, one axis.
export function dampedFollow(e, u, dt, tau) {
  const w = 1 / tau;
  const k = Math.exp(-w * dt);
  const c = u + w * e;
  return { e: (e + c * dt) * k, u: (u - w * c * dt) * k };
}

// The one function that decides who wins an engaged block. Pure.
export function resolveBlock(defender, blockers, goal) {
  const f = driveForce(defender);
  let fx;
  let fy;
  if (defender.react?.dir) {
    fx = f * defender.react.dir.x;
    fy = f * defender.react.dir.y;
  } else {
    const gx = goal.x - defender.x;
    const gy = goal.y - defender.y;
    const len = Math.hypot(gx, gy);
    fx = len < 1e-9 ? 0 : (f * gx) / len;
    fy = len < 1e-9 ? 0 : (f * gy) / len;
  }
  const bp = blockPush(blockers);
  fx += bp.x;
  fy += bp.y;
  if (defender.react?.hold) {
    fx += defender.react.hold.x;
    fy += defender.react.hold.y;
  }
  let vx = fx * DRIVE_RATE;
  let vy = fy * DRIVE_RATE;
  const m = Math.hypot(vx, vy);
  if (m > ENGAGED_MAX_SPEED) {
    vx = (vx / m) * ENGAGED_MAX_SPEED;
    vy = (vy / m) * ENGAGED_MAX_SPEED;
  }
  return { vx, vy };
}

// Rule signature shared by scheme rules: (players, ballPos, ctx) => [{ blocker, target, angle? }]
export function doubleTeamPeel(players, ballPos) { // eslint-disable-line no-unused-vars
  const targeted = new Set();
  for (const p of players) if (p.block) targeted.add(p.block.target);
  const teamers = [];
  const seen = new Set();
  for (const p of players) {
    if (!p.block || !p.block.engaged || seen.has(p.block.target)) continue;
    seen.add(p.block.target);
    const eng = engagedOn(players, p.block.target);
    if (eng.length < 2) continue;
    let lead = eng[0];
    for (const e of eng) if (e.block.seq < lead.block.seq) lead = e;
    for (const e of eng) if (e !== lead) teamers.push(e);
  }
  teamers.sort((a, b) => players.indexOf(a) - players.indexOf(b));
  const picked = new Set();
  const out = [];
  for (const t of teamers) {
    let best = null;
    let bestD = Infinity;
    for (const d of players) {
      if (!isDefense(d) || targeted.has(d.id) || picked.has(d.id)) continue;
      const dist = Math.hypot(d.x - t.x, d.y - t.y);
      if (dist > PEEL_DIST) continue;
      if (best === null || dist < bestD - 1e-9) {
        best = d;
        bestD = dist;
      }
    }
    if (best) {
      picked.add(best.id);
      out.push({ blocker: t.id, target: best.id });
    }
  }
  return out;
}

// The ball is well upfield of the target: the blocker may let go of him, and may not re-engage him.
const ballPast = (T, ballPos) => ballPos.y >= T.y + RELEASE_PAST;

// Single release predicate for an engaged block. First match wins: 'shed' (the target has won
// for SHED_TIME, only when fight is true), 'past' (the ball is well upfield of the target), 'lost'
// (contact broken), or null. fight = false (play option fightBlocks off) means no shed.
// Later shed decisions (R-42 DL AI) go here.
export function canRelease(b, T, ballPos, fight = true) {
  if (fight && (b.block.winT ?? 0) >= SHED_TIME) return 'shed';
  if (ballPast(T, ballPos)) return 'past';
  if (Math.hypot(T.x - b.x, T.y - b.y) > CONTACT_DIST + ENGAGE_TOL) return 'lost';
  return null;
}

// Single engage predicate: 'spot' (within ENGAGE_TOL of the spot), 'contact' (touching the target
// in front), or null. Null also when: the re-engage cooldown runs (b.block.cool); the ball is past
// the target (ballPos given and ballPast); the target shed a blocker within REENGAGE_DELAY
// (T.shedFree > 0, he is free of every blocker). ballPos is optional so 3-arg callers skip the past check.
export function canEngage(b, T, spot, ballPos) {
  if ((b.block.cool ?? 0) > 0) return null;
  if (ballPos && ballPast(T, ballPos)) return null;
  if ((T.shedFree ?? 0) > 0) return null;
  // Engage only well inside canRelease's 'lost' range, or the block would drop on the next tick.
  const near = Math.hypot(T.x - b.x, T.y - b.y) <= CONTACT_DIST + ENGAGE_NEAR;
  if (near && Math.hypot(spot.x - b.x, spot.y - b.y) <= ENGAGE_TOL) return 'spot';
  // "In front" is where the blocker actually faces (missing facing = upfield, offense).
  const d = Number.isFinite(b.facing) ? { x: Math.sin(b.facing), y: Math.cos(b.facing) } : { x: 0, y: 1 };
  const touching =
    near &&
    (T.x - b.x) * d.x + (T.y - b.y) * d.y >= 0;
  return touching ? 'contact' : null;
}

const clampBody = (p) => {
  p.x = Math.min(HW, Math.max(-HW, p.x));
  p.y = Math.min(Y_MAX, Math.max(Y_MIN, p.y));
};

// Push one overlapping pair apart along the center line. The body with the lower rank
// (closer to an anchor) holds; the higher-ranked one takes the whole overlap. Equal ranks
// split it, except that an engaged blocker (a rider: his follow is his hands on his own man) yields
// the whole overlap to a body that is neither his target nor another engaged blocker, so he never
// carries a third body (in the soft relax as well as at the hard core: a 50/50 soft relax alone
// drags the third body along at the rider's pace). Moves the pair by (minDist - d) * frac.
// Returns true if it moved them.
// rec (optional): Map id -> Map otherId -> {x, y}, the push-out each body took from each other body.
const isRider = (p, other) => !!(p.block && p.block.engaged && p.block.target !== other.id && !(other.block && other.block.engaged));

function shareOf(a, b, rank) {
  const ra = rank.get(a.id);
  const rb = rank.get(b.id);
  if (ra !== rb) return ra < rb ? 0 : 1;
  const ya = isRider(a, b);
  const yb = isRider(b, a);
  if (ya !== yb) return ya ? 1 : 0;
  return 0.5;
}

function record(rec, p, other, x, y) {
  if (!rec || (x === 0 && y === 0)) return;
  let m = rec.get(p.id);
  if (!m) rec.set(p.id, (m = new Map()));
  const s = m.get(other.id) ?? { x: 0, y: 0 };
  m.set(other.id, { x: s.x + x, y: s.y + y });
}

function pushApart(a, b, rank, minDist, frac, rec) {
  const min = minDist;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  if (d >= min - 1e-9) return false;
  if (d < 1e-9) {
    dx = 1;
    dy = 0;
    d = 0;
  } else {
    dx /= d;
    dy /= d;
  }
  const o = (min - d) * frac;
  const wa = shareOf(a, b, rank);
  const wb = 1 - wa;
  a.x -= dx * o * wa;
  a.y -= dy * o * wa;
  b.x += dx * o * wb;
  b.y += dy * o * wb;
  record(rec, a, b, -dx * o * wa, -dy * o * wa);
  record(rec, b, a, dx * o * wb, dy * o * wb);
  return true;
}

// Rank 0 = anchored (engaged blockers and their targets). A free body touching a body of
// rank r has rank r + 1; bodies not connected to an anchor stay at Infinity.
function rankBodies(players, anchored) {
  const rank = new Map(players.map((p) => [p.id, anchored.has(p.id) ? 0 : Infinity]));
  const touch = 2 * BODY_RADIUS + 1e-6;
  let frontier = players.filter((p) => anchored.has(p.id));
  for (let r = 1; frontier.length; r++) {
    const next = [];
    for (const q of players) {
      if (rank.get(q.id) !== Infinity) continue;
      if (frontier.some((f) => Math.hypot(f.x - q.x, f.y - q.y) <= touch)) {
        rank.set(q.id, r);
        next.push(q);
      }
    }
    frontier = next;
  }
  return rank;
}

// Bodies may overlap in a soft zone [H, 2 * BODY_RADIUS) down to the hard core H. With a
// finite dt each call relaxes that overlap by a fraction SOFT_RATE * dt, so squeezing players
// ease apart instead of snapping to a full body width; the iterated sweeps then enforce only
// H. Without dt (omitted) contact is rigid at 2 * BODY_RADIUS. Anchored bodies (engaged
// blockers and their targets) hold their ground; a free body yields to anything nearer an
// anchor than itself, so a body wedged against an anchor is not pushed back in by a free
// body behind him. Sweeps are bounded and deterministic.
// extraAnchors: optional ids held at rank 0 for this call (blockers who left an engaged
// block this tick keep splitting overlaps with their anchored neighbours).
// rec: optional push-out record (see pushApart), read by stepBlocking for inelastic contact.
export function separateBodies(players, dt = Infinity, extraAnchors, rec) {
  const anchored = new Set(extraAnchors || []);
  for (const p of players) {
    if (p.block && p.block.engaged) {
      anchored.add(p.id);
      anchored.add(p.block.target);
    }
  }
  const n = players.length;
  const x0 = players.map((p) => p.x);
  const y0 = players.map((p) => p.y);
  const moveTotal = () => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.hypot(players[i].x - x0[i], players[i].y - y0[i]);
    return sum;
  };
  const rank = rankBodies(players, anchored);
  const soft = Number.isFinite(dt);
  const hard = soft ? H : 2 * BODY_RADIUS;
  if (soft) {
    const k = Math.min(1, SOFT_RATE * dt);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(players[j].x - players[i].x, players[j].y - players[i].y);
        if (d >= H && d < 2 * BODY_RADIUS) pushApart(players[i], players[j], rank, 2 * BODY_RADIUS, k, rec);
      }
    }
  }
  for (let it = 0; it < SEPARATION_ITERS; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (pushApart(players[i], players[j], rank, hard, 1, rec)) moved = true;
      }
    }
    for (const p of players) clampBody(p);
    if (!moved) return moveTotal();
  }
  return moveTotal();
}

// Fastest speed (yd/s) from which a mover braking by accel * dt per tick still stops within rem
// yards, counting this tick's step: v * dt + dt * sum_k max(0, v - k * accel * dt) <= rem, solved
// exactly (piecewise linear in v), so the next tick's limit is never more than accel * dt lower. Pure.
export function stopSpeed(rem, accel, dt) {
  if (!(rem > 0)) return 0;
  const h = accel * dt;
  if (!(h > 0)) return Infinity;
  const at = (n) => (rem + h * dt * n * (n + 1) / 2) / (dt * (n + 1));
  let n = Math.max(0, Math.floor((-h / 2 + Math.sqrt(h * h / 4 + 2 * accel * rem)) / h));
  for (let i = 0; i < 4; i++) {
    const v = at(n);
    if (v > (n + 1) * h) n++;
    else if (v < n * h && n > 0) n--;
    else return v;
  }
  return at(n);
}

// A free defender's step: his goal under the planted-cut limit (goal.accel = CUT_ACCEL), never inside
// CONTACT_DIST of the ball (the guard wins), slowing so he can stop at the nearer of goal and guard
// within the cap. With nowhere to step (goal reached, at the guard) he brakes along his travel by
// CUT_ACCEL * dt instead of freezing, unless that would carry him closer to the ball inside the guard.
function freeStep(d, goal, ballPos, rate, players, dt) {
  const gd = Math.hypot(goal.x - d.x, goal.y - d.y);
  const bd = Math.hypot(ballPos.x - d.x, ballPos.y - d.y);
  if (gd > 1e-9 && bd > CONTACT_DIST) {
    const room = Math.min(gd, bd - CONTACT_DIST);
    const limit = Math.min(rate * dt, room, stopSpeed(room, CUT_ACCEL, dt) * dt);
    steerStep(d, { ...goal, accel: CUT_ACCEL }, players, limit, dt, BODY_RADIUS);
    return;
  }
  const v0 = d.selfVel ?? d.vel;
  const sp = v0 ? Math.hypot(v0.x, v0.y) : 0;
  if (!(dt > 0) || sp < 1e-9) return;
  const s = Math.max(0, sp - CUT_ACCEL * dt) * dt;
  if (s < 1e-9) return;
  const ux = v0.x / sp;
  const uy = v0.y / sp;
  const nb = Math.hypot(ballPos.x - d.x - ux * s, ballPos.y - d.y - uy * s);
  if (nb < CONTACT_DIST && nb < bd) return;
  const ahead = { x: d.x + ux * (s + 1), y: d.y + uy * (s + 1), key: goal.key, ignore: goal.ignore, accel: CUT_ACCEL };
  steerStep(d, ahead, players, s, dt, BODY_RADIUS);
}

// Blockers who left an engaged block by retarget keep their anchor rank while they close on
// the new target, so their neighbours keep splitting overlaps with them as before.
const closingLeavers = new WeakSet();

export function stepBlocking(players, ballPos, dt, ctx) {
  const start = players.map((p) => ({ x: p.x, y: p.y }));
  const engagedAtStart = players.filter((p) => p.block?.engaged).map((p) => p.id);
  if (ctx && ctx.rule) {
    for (const e of ctx.rule(players, ballPos, ctx)) {
      setBlock(players, e.blocker, e.target, e.angle ?? 'straight');
    }
  }

  const fight = ctx?.fightBlocks !== false;
  let holderId = null;
  for (const p of players) {
    if (Math.hypot(p.x - ballPos.x, p.y - ballPos.y) < 1e-9) {
      holderId = p.id;
      break;
    }
  }

  const before = new Set(players.filter((p) => p.block?.engaged).map((p) => p.id));
  const justEngaged = new Set();

  for (const b of players) {
    if (!b.block || b.block.engaged || b.block.released === 'past') continue;
    const spot = contactSpot(players, b);
    const foot = b.block.foot;
    const T = byId(players, b.block.target);
    if (foot && (ctx?.side === 1 || ctx?.side === -1)) {
      const { phase, goal } = footGoal(foot, b, spot, ctx.side, BODY_RADIUS, { target: T, ballPos });
      foot.phase = phase;
      steerStep(
        b,
        { ...goal, key: phase + ':' + b.block.target, ignore: b.block.target },
        players,
        b.speed * dt,
        dt,
        BODY_RADIUS,
      );
    } else {
      steerStep(
        b,
        { x: spot.x, y: spot.y, key: 'block:' + b.block.target, ignore: b.block.target },
        players,
        b.speed * dt,
        dt,
        BODY_RADIUS,
      );
    }
    const hit = canEngage(b, T, spot, ballPos);
    if (hit) {
      b.block.engaged = true;
      b.block.held = 0;
      b.block.winT = 0;
      if ('released' in b.block) b.block.released = null;
      b.block.fa = null;
      b.block.fu = null;
      justEngaged.add(b.id);
      b.steer = null;
      b.block.seq = ++ctx.seq;
    } else if (b.block.cool > 0) {
      b.block.cool = Math.max(0, b.block.cool - dt);
    }
  }

  for (const b of players) {
    const foot = b.block?.foot;
    if (!foot || !b.block.engaged) continue;
    const watch = foot.watch ? byId(players, foot.watch) ?? null : null;
    const T = byId(players, b.block.target);
    const dx = T.x - b.x;
    const dy = T.y - b.y;
    const dist = Math.hypot(dx, dy);
    const contact = dist < 1e-9 ? null : { x: dx / dist, y: dy / dist };
    const { ride, push } = footPush(foot, T, watch, T.vel ?? { x: 0, y: 0 }, contact, dt, ctx?.side);
    foot.ride = ride;
    foot.push = push;
  }

  for (const b of players) {
    if (!justEngaged.has(b.id)) continue;
    const d = byId(players, b.block.target);
    const imp = contactImpulse(d, b);
    for (const [p, dv] of [[d, imp.d], [b, imp.b]]) {
      const old = p.impact && p.impact.t > 0 ? p.impact : { ax: 0, ay: 0 };
      p.impact = { ax: old.ax + dv.x / IMPACT_TIME, ay: old.ay + dv.y / IMPACT_TIME, t: IMPACT_TIME };
    }
  }

  const stepped = new Map(); // free defender id -> velocity of his own step this pass
  const kicked = new Map(); // defender id -> velocity his hit added this pass
  const holders = new Map(); // engaged defender id -> ids of the blockers engaged on him this pass
  for (const d of players) {
    if (!isDefense(d)) continue;
    if ((d.shedFree ?? 0) > 0) d.shedFree = Math.max(0, d.shedFree - dt);
    const eng = engagedOn(players, d.id);
    if (eng.length) {
      d.steer = null;
      const mx = eng.reduce((s, p) => s + p.x, 0) / eng.length;
      const my = eng.reduce((s, p) => s + p.y, 0) / eng.length;
      const ld = Math.hypot(d.x - mx, d.y - my);
      const line = ld < 1e-9 ? null : { x: (d.x - mx) / ld, y: (d.y - my) / ld };
      d.react = stepReact(d.react ?? null, d, blockPush(eng), ctx?.defGoals?.[d.id] ?? ballPos, dt, { leverage: fight, line });
      const g = resolveBlock(d, eng, ballPos);
      // He carries his own block-resolved momentum (d.carry), not the measured p.vel, which also
      // holds body push-outs; on his first engaged tick it starts from his measured velocity.
      const v = carryVelocity(d.carry ?? d.vel ?? { x: 0, y: 0 }, { x: g.vx, y: g.vy }, d.impact, dt, ENGAGE_TAU, d.bump);
      kicked.set(d.id, v.kick);
      d.carry = { x: v.vx, y: v.vy };
      holders.set(d.id, new Set(eng.map((p) => p.id)));
      if (d.impact && d.impact.t <= 0) d.impact = null;
      if (d.bump && d.bump.t <= 0) d.bump = null;
      d.x = Math.min(HW, Math.max(-HW, d.x + v.vx * dt));
      d.y = Math.min(Y_MAX, Math.max(Y_MIN, d.y + v.vy * dt));
    } else {
      d.react = null;
      d.impact = null;
      d.carry = null;
      d.bump = null;
      const g = ctx?.defGoals?.[d.id];
      const x0 = d.x;
      const y0 = d.y;
      // A free defender never steps inside contact of the ball; the tackle rule takes over at TACKLE_DIST.
      if (g) freeStep(d, { x: g.x, y: g.y, key: g.key, ignore: holderId }, ballPos, g.rate, players, dt);
      else {
        // Chasing the ball he runs to the guard point (CONTACT_DIST short of it on his line): a body
        // beyond the point he stops at is not in his way.
        const bd = Math.hypot(ballPos.x - d.x, ballPos.y - d.y);
        const k = bd > CONTACT_DIST ? (bd - CONTACT_DIST) / bd : 0;
        const at = { x: d.x + (ballPos.x - d.x) * k, y: d.y + (ballPos.y - d.y) * k };
        freeStep(d, { ...at, key: 'ball', ignore: holderId }, ballPos, d.speed, players, dt);
      }
      if (dt > 0) stepped.set(d.id, { x: (d.x - x0) / dt, y: (d.y - y0) / dt });
    }
  }

  for (const b of players) {
    if (!b.block || !before.has(b.id)) continue;
    const T = byId(players, b.block.target);
    b.block.held += dt;
    b.block.winT = T.react?.state === 'winning' ? b.block.winT + dt : 0;
  }

  // Engaged blockers ride their target (his displacement this pass) plus a critically damped
  // correction toward the follow spot. Only blockers' impacts are cleared here; a defender's is
  // cleared in the defender loop.
  for (const b of players) {
    if (!b.block || !b.block.engaged) {
      if (isBlocker(b) && b.impact) b.impact = null;
      continue;
    }
    b.steer = null;
    const T = byId(players, b.block.target);
    if (justEngaged.has(b.id)) {
      // His correction rate starts from the same pre-hit velocities the impulse was computed from
      // (p.vel is still last tick's here), less the part of his man's hit already delivered this
      // tick. Seeding it next tick from the measured velocities would also count this tick's
      // steering and push-out, so the impulse would take the closing speed off twice.
      const vb = b.vel ?? { x: 0, y: 0 };
      const vt = T.vel ?? { x: 0, y: 0 };
      const theirs = kicked.get(T.id) ?? { x: 0, y: 0 };
      b.block.fu = { x: vb.x - vt.x - theirs.x, y: vb.y - vt.y - theirs.y };
      continue;
    }
    const t0 = start[players.indexOf(T)];
    const dTx = T.x - t0.x;
    const dTy = T.y - t0.y;
    const spot = followSpot(players, b, dt, { x: dTx, y: dTy });
    const ex = b.x + dTx - spot.x;
    const ey = b.y + dTy - spot.y;
    let u = b.block.fu;
    if (!u) {
      const vb = b.vel ?? { x: 0, y: 0 };
      const vt = T.vel ?? { x: 0, y: 0 };
      u = { x: vb.x - vt.x, y: vb.y - vt.y };
    }
    // As for the defender (carryVelocity), the damped correction acts on the post-hit relative
    // velocity (u plus both hits' impulse still to deliver), so the damping and the impulse do not
    // both take the closing speed off; the part still undelivered after this tick is taken back out.
    const ownR0 = impactLeft(b.impact);
    const own = impactStep(b.impact, dt);
    if (b.impact && b.impact.t <= 0) b.impact = null;
    const theirs = kicked.get(T.id) ?? { x: 0, y: 0 };
    const theirR1 = impactLeft(T.impact);
    const r0 = { x: ownR0.x - theirR1.x - theirs.x, y: ownR0.y - theirR1.y - theirs.y };
    const r1 = { x: r0.x - own.x + theirs.x, y: r0.y - own.y + theirs.y };
    const sx = dampedFollow(ex, u.x + r0.x, dt, FOLLOW_TAU);
    const sy = dampedFollow(ey, u.y + r0.y, dt, FOLLOW_TAU);
    let mx = spot.x + sx.e - r1.x * dt - b.x;
    let my = spot.y + sy.e - r1.y * dt - b.y;
    let fu = { x: sx.u - r1.x, y: sy.u - r1.y };
    const mm = Math.hypot(mx, my);
    const cap = b.speed * dt;
    if (mm > cap) {
      mx = (mx / mm) * cap;
      my = (my / mm) * cap;
      fu = { x: (mx - dTx) / dt, y: (my - dTy) / dt };
    }
    b.block.fu = fu;
    b.x += mx;
    b.y += my;
    clampBody(b);
  }

  for (const b of players) {
    if (!b.block || !b.block.engaged || justEngaged.has(b.id)) continue;
    const reason = canRelease(b, byId(players, b.block.target), ballPos, fight);
    if (!reason) continue;
    b.block.engaged = false;
    b.block.seq = null;
    b.block.released = reason;
    b.block.fa = null;
    b.block.fu = null;
    if (b.block.foot) b.block.foot.push = null;
    if (reason !== 'past') b.block.cool = REENGAGE_DELAY;
    if (reason === 'shed') byId(players, b.block.target).shedFree = REENGAGE_DELAY;
  }

  const leaving = engagedAtStart.filter((id) => !byId(players, id).block?.engaged);
  for (const id of leaving) {
    const p = byId(players, id);
    if (p.block && !p.block.released) closingLeavers.add(p);
  }
  for (const p of players) {
    if (!closingLeavers.has(p)) continue;
    if (!p.block || p.block.engaged || p.block.released) closingLeavers.delete(p);
    else if (!leaving.includes(p.id)) leaving.push(p.id);
  }
  const pushes = new Map();
  const out = separateBodies(players, dt, leaving, pushes);
  // Contact with any body but his own blockers is inelastic: a push-out stops the engaged
  // defender at that body (his velocity loses only the part pointing into it) and never becomes his
  // own momentum. The push-out itself is not in d.carry (p.vel measures it, d.carry does not); the
  // stop is a bump spread over IMPACT_TIME like a hit (no snap, PRINCIPLES #11), judged on his
  // post-hit velocity (carry plus what the hit and earlier bumps still deliver), so a body he keeps
  // pressing into is not counted twice. Contact with his own blockers is the block itself.
  for (const d of players) {
    const own = holders.get(d.id);
    const got = pushes.get(d.id);
    if (!own || !got || !d.carry) continue;
    const ri = impactLeft(d.impact);
    let rb = impactLeft(d.bump);
    for (const [oid, s] of got) {
      if (own.has(oid)) continue;
      const len = Math.hypot(s.x, s.y);
      if (len < 1e-12) continue;
      const nx = s.x / len;
      const ny = s.y / len;
      const into = (d.carry.x + ri.x + rb.x) * nx + (d.carry.y + ri.y + rb.y) * ny;
      if (into < 0) rb = { x: rb.x - into * nx, y: rb.y - into * ny };
    }
    const left = impactLeft(d.bump);
    if (rb.x !== left.x || rb.y !== left.y) d.bump = { ax: rb.x / IMPACT_TIME, ay: rb.y / IMPACT_TIME, t: IMPACT_TIME };
  }
  // A free defender's own velocity (p.selfVel, his planted-cut reference in steerStep) is his own
  // step, and body contact is inelastic for him too: a push-out takes off at most the velocity it
  // applied (len / dt) from the part of his step pointing into that body, and never becomes his
  // momentum (p.vel, the measurement, still holds the push-out). A graze keeps his speed; against a
  // stationary body the steering clamp already stops his step, so he still loses the into component.
  for (const p of players) {
    const own = stepped.get(p.id);
    if (!own) {
      if (p.selfVel) p.selfVel = null;
      continue;
    }
    const got = pushes.get(p.id);
    if (got) {
      for (const s of got.values()) {
        const len = Math.hypot(s.x, s.y);
        if (len < 1e-12) continue;
        const into = (own.x * s.x + own.y * s.y) / len;
        if (into < 0) {
          const cut = Math.max(into, -len / dt);
          own.x -= (cut * s.x) / len;
          own.y -= (cut * s.y) / len;
        }
      }
    }
    p.selfVel = own;
  }
  if (dt > 0) {
    players.forEach((p, i) => {
      p.vel = { x: (p.x - start[i].x) / dt, y: (p.y - start[i].y) / dt };
    });
  }
  return out;
}
