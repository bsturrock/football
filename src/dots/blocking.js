// Pure blocking logic for the dots layer: no THREE, no DOM, no timers, no randomness.
import { HW } from '../util.js';
import { steerStep, hardCore } from './steering.js';
import { stepReact } from './react.js';
import { startFoot, retargetFoot, footGoal, footPush } from './technique.js';

export const BLOCKER_ROLES = ['OL'];
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

function moveToward(p, tx, ty, maxStep) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-12 || maxStep <= 0) return;
  const s = Math.min(maxStep, d);
  p.x += (dx / d) * s;
  p.y += (dy / d) * s;
}

// The ball is well upfield of the target: the blocker may let go of him, and may not re-engage him.
const ballPast = (T, ballPos) => ballPos.y >= T.y + RELEASE_PAST;

// Single release predicate for an engaged block. First match wins: 'shed' (the target has won
// for SHED_TIME), 'past' (the ball is well upfield of the target), 'lost' (contact broken), or null.
// Later shed decisions (R-42 DL AI) go here.
export function canRelease(b, T, ballPos) {
  if ((b.block.winT ?? 0) >= SHED_TIME) return 'shed';
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
  const d = BLOCK_ANGLES[b.block.angle];
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
// split it. Moves the pair by (minDist - d) * frac. Returns true if it moved them.
function pushApart(a, b, rank, minDist, frac) {
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
  const ra = rank.get(a.id);
  const rb = rank.get(b.id);
  const wa = ra === rb ? 0.5 : ra < rb ? 0 : 1;
  const wb = 1 - wa;
  a.x -= dx * o * wa;
  a.y -= dy * o * wa;
  b.x += dx * o * wb;
  b.y += dy * o * wb;
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
export function separateBodies(players, dt = Infinity, extraAnchors) {
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
        if (d >= H && d < 2 * BODY_RADIUS) pushApart(players[i], players[j], rank, 2 * BODY_RADIUS, k);
      }
    }
  }
  for (let it = 0; it < SEPARATION_ITERS; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (pushApart(players[i], players[j], rank, hard, 1)) moved = true;
      }
    }
    for (const p of players) clampBody(p);
    if (!moved) return moveTotal();
  }
  return moveTotal();
}

// Blockers who left an engaged block by retarget keep their anchor rank while they close on
// the new target, so their neighbours keep splitting overlaps with them as before.
const closingLeavers = new WeakSet();

export function stepBlocking(players, ballPos, dt, ctx) {
  const engagedAtStart = players.filter((p) => p.block?.engaged).map((p) => p.id);
  if (ctx && ctx.rule) {
    for (const e of ctx.rule(players, ballPos, ctx)) {
      setBlock(players, e.blocker, e.target, e.angle ?? 'straight');
    }
  }

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
    if (foot && (ctx?.side === 1 || ctx?.side === -1)) {
      const { phase, goal } = footGoal(foot, b, spot, ctx.side, BODY_RADIUS);
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
    const T = byId(players, b.block.target);
    const hit = canEngage(b, T, spot, ballPos);
    if (hit) {
      b.block.engaged = true;
      b.block.held = 0;
      b.block.winT = 0;
      if ('released' in b.block) b.block.released = null;
      justEngaged.add(b.id);
      if (foot) foot.tx = T.x;
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
    const { ride, push } = footPush(foot, byId(players, b.block.target), watch, dt);
    foot.ride = ride;
    foot.push = push;
  }

  for (const b of players) {
    if (b.block?.foot && b.block.engaged) b.block.foot.tx = byId(players, b.block.target).x;
  }

  for (const d of players) {
    if (!isDefense(d)) continue;
    if ((d.shedFree ?? 0) > 0) d.shedFree = Math.max(0, d.shedFree - dt);
    const eng = engagedOn(players, d.id);
    if (eng.length) {
      d.steer = null;
      d.react = stepReact(d.react ?? null, d, blockPush(eng), ctx?.defGoals?.[d.id] ?? ballPos, dt);
      const v = resolveBlock(d, eng, ballPos);
      d.x = Math.min(HW, Math.max(-HW, d.x + v.vx * dt));
      d.y = Math.min(Y_MAX, Math.max(Y_MIN, d.y + v.vy * dt));
    } else {
      d.react = null;
      const g = ctx?.defGoals?.[d.id];
      if (g) {
        const gd = Math.hypot(g.x - d.x, g.y - d.y);
        if (gd > 1e-9) {
          steerStep(
            d,
            { x: g.x, y: g.y, key: g.key, ignore: holderId },
            players,
            Math.min(g.rate * dt, gd),
            dt,
            BODY_RADIUS,
          );
        }
        continue;
      }
      const dist = Math.hypot(ballPos.x - d.x, ballPos.y - d.y);
      if (dist > CONTACT_DIST) {
        steerStep(
          d,
          { x: ballPos.x, y: ballPos.y, key: 'ball', ignore: holderId },
          players,
          Math.min(d.speed * dt, dist - CONTACT_DIST),
          dt,
          BODY_RADIUS,
        );
      }
    }
  }

  for (const b of players) {
    if (!b.block || !before.has(b.id)) continue;
    const T = byId(players, b.block.target);
    b.block.held += dt;
    b.block.winT = T.react?.state === 'winning' ? b.block.winT + dt : 0;
  }

  for (const b of players) {
    if (!b.block || !b.block.engaged || justEngaged.has(b.id)) continue;
    const reason = canRelease(b, byId(players, b.block.target), ballPos);
    if (!reason) continue;
    b.block.engaged = false;
    b.block.seq = null;
    b.block.released = reason;
    if (b.block.foot) b.block.foot.push = null;
    if (reason !== 'past') b.block.cool = REENGAGE_DELAY;
    if (reason === 'shed') byId(players, b.block.target).shedFree = REENGAGE_DELAY;
  }

  for (const b of players) {
    if (!b.block || !b.block.engaged) continue;
    b.steer = null;
    if (justEngaged.has(b.id)) continue;
    const spot = contactSpot(players, b);
    moveToward(b, spot.x, spot.y, b.speed * dt);
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
  return separateBodies(players, dt, leaving);
}
