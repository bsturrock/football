// Pure blocking logic for the dots layer: no THREE, no DOM, no timers, no randomness.
import { HW } from '../util.js';

export const BLOCKER_ROLES = ['OL'];
export const CONTACT_DIST = 1.2;
export const ENGAGE_TOL = 0.25;
export const SPREAD = 1.0;
export const DRIVE_RATE = 1.5;
export const ENGAGED_MAX_SPEED = 2.5;
export const PEEL_DIST = 2.0;
export const Y_MIN = -10;
export const Y_MAX = 110;

export const BLOCK_ANGLES = Object.freeze({
  straight: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -Math.SQRT1_2, y: Math.SQRT1_2 }),
  right: Object.freeze({ x: Math.SQRT1_2, y: Math.SQRT1_2 }),
});

export const isBlocker = (p) => BLOCKER_ROLES.includes(p.role);

const byId = (players, id) => players.find((p) => p.id === id);
const isDefense = (p) => p && p.team === 'defense';

export function assignBlocks(players) {
  for (const p of players) p.block = null;
  for (const b of players) {
    if (!isBlocker(b)) continue;
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
  else b.block = { target: targetId, angle, engaged: false, seq: null };
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

export function contactSpot(players, blocker) {
  const T = byId(players, blocker.block.target);
  const angle = blocker.block.angle;
  const d = BLOCK_ANGLES[angle];
  const co = players.filter(
    (p) => isBlocker(p) && p.block && p.block.target === blocker.block.target && p.block.angle === angle,
  );
  const k = co.length;
  const i = co.indexOf(blocker);
  const offset = (i - (k - 1) / 2) * SPREAD;
  return {
    x: T.x - d.x * CONTACT_DIST + d.y * offset,
    y: T.y - d.y * CONTACT_DIST - d.x * offset,
  };
}

// Single place where future factors (skills, leverage, fatigue) multiply in.
export const driveForce = (p) => p.strength;
// Single place where future factors (skills, leverage, fatigue) multiply in.
export const blockForce = (p) => p.strength;

// The one function that decides who wins an engaged block. Pure.
export function resolveBlock(defender, blockers, goal) {
  const gx = goal.x - defender.x;
  const gy = goal.y - defender.y;
  const len = Math.hypot(gx, gy);
  const f = driveForce(defender);
  let fx = len < 1e-9 ? 0 : (f * gx) / len;
  let fy = len < 1e-9 ? 0 : (f * gy) / len;
  for (const b of blockers) {
    const d = BLOCK_ANGLES[b.block.angle];
    const bf = blockForce(b);
    fx += bf * d.x;
    fy += bf * d.y;
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

// Rule signature shared by scheme rules: (players, ballPos) => [{ blocker, target, angle? }]
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

export function stepBlocking(players, ballPos, dt, ctx) {
  if (ctx && ctx.rule) {
    for (const e of ctx.rule(players, ballPos)) {
      setBlock(players, e.blocker, e.target, e.angle ?? 'straight');
    }
  }

  for (const b of players) {
    if (!b.block || b.block.engaged) continue;
    const spot = contactSpot(players, b);
    moveToward(b, spot.x, spot.y, b.speed * dt);
    if (Math.hypot(spot.x - b.x, spot.y - b.y) <= ENGAGE_TOL) {
      b.x = spot.x;
      b.y = spot.y;
      b.block.engaged = true;
      b.block.seq = ++ctx.seq;
    }
  }

  for (const d of players) {
    if (!isDefense(d)) continue;
    const eng = engagedOn(players, d.id);
    if (eng.length) {
      const v = resolveBlock(d, eng, ballPos);
      d.x = Math.min(HW, Math.max(-HW, d.x + v.vx * dt));
      d.y = Math.min(Y_MAX, Math.max(Y_MIN, d.y + v.vy * dt));
    } else {
      const dist = Math.hypot(ballPos.x - d.x, ballPos.y - d.y);
      if (dist > CONTACT_DIST) moveToward(d, ballPos.x, ballPos.y, Math.min(d.speed * dt, dist - CONTACT_DIST));
    }
  }

  for (const b of players) {
    if (!b.block || !b.block.engaged) continue;
    const spot = contactSpot(players, b);
    moveToward(b, spot.x, spot.y, b.speed * dt);
  }
}
