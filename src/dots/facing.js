// Player facing: one pure per-tick pass that turns each player's `p.facing` at a bounded
// rate toward his engaged man, else toward his travel direction. A player carrying a face
// target (`p.faceAt = {x, y, w}`, written by steering) turns toward a w-weighted blend of his
// travel bearing and the bearing to that spot, so a shuffle or backpedal can keep the spot in
// front of him (w = 1 faces the spot; w = 0 is pure travel); standing still he turns to the spot.
//
// Angle convention: `p.facing` is radians in (-PI, PI]; the unit direction is
// {x: Math.sin(a), y: Math.cos(a)}; 0 faces +y, PI faces -y; the bearing from point A to B
// is Math.atan2(B.x - A.x, B.y - A.y). Field: x lateral, y = yard line, offense attacks +y.
import { engagedOn } from './blocking.js';

// rad/s max turn. The defender must re-face a split double team within one tick:
// FACE_RATE * FIXED_DT >= split jump - FACE_TOL. A combo partner leaving moves the
// mean-facing goal by up to ~0.52 rad in one tick, so the rate covers it with margin.
export const FACE_RATE = 14;
export const FACE_MIN_SPEED = 0.5; // yd/s; slower than this is not "travel"
export const FACE_SETTLE = 0.4; // s a block must be held before facing is bounded (test bound)
export const FACE_TOL = 0.35; // rad (test bound)

export function wrapAngle(a) {
  const t = 2 * Math.PI;
  let r = a - t * Math.floor(a / t); // [0, 2PI)
  if (r > Math.PI) r -= t;
  return r; // (-PI, PI]
}

export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

export const facingDir = (a) => ({ x: Math.sin(a), y: Math.cos(a) });

export const bearing = (from, to) => Math.atan2(to.x - from.x, to.y - from.y);

export function initFacing(players) {
  for (const p of players) p.facing = p.team === 'offense' ? 0 : Math.PI;
}

// Desired facing, first match wins; null keeps the current facing.
export function faceGoal(p, players, prev, dt) {
  if (p.block?.engaged) {
    const t = players.find((q) => q.id === p.block.target);
    if (t) return bearing(p, t);
  }
  const on = engagedOn(players, p.id);
  if (on.length) {
    const m = {
      x: on.reduce((s, q) => s + q.x, 0) / on.length,
      y: on.reduce((s, q) => s + q.y, 0) / on.length,
    };
    return bearing(p, m);
  }
  const was = prev?.[p.id];
  const moving = was && Math.hypot(p.x - was.x, p.y - was.y) / dt >= FACE_MIN_SPEED;
  const at = p.faceAt;
  if (at) {
    if (moving) {
      const travel = bearing(was, p);
      return wrapAngle(travel + at.w * angleDiff(travel, bearing(p, at)));
    }
    const cur = Number.isFinite(p.facing) ? p.facing : (p.team === 'offense' ? 0 : Math.PI);
    return wrapAngle(cur + at.w * angleDiff(cur, bearing(p, at)));
  }
  if (moving) return bearing(was, p);
  return null;
}

export function stepFacing(players, prev, dt) {
  const goals = players.map((p) => faceGoal(p, players, prev, dt));
  players.forEach((p, i) => {
    if (!Number.isFinite(p.facing)) p.facing = p.team === 'offense' ? 0 : Math.PI;
    if (goals[i] === null) return;
    const max = FACE_RATE * dt;
    const d = Math.max(-max, Math.min(max, angleDiff(p.facing, goals[i])));
    p.facing = wrapAngle(p.facing + d);
  });
}
