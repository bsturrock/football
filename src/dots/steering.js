// Local steering for one player: move toward a goal around other bodies.
// Pure module (no imports, no THREE, no DOM).
//
// ROUTE COMMITMENT RULE (tunables below)
//  - Commit: the first time an obstacle sits in the corridor ahead (width R),
//    the mover picks a pass side (left/right) and records it in p.steer.
//  - Hold: he keeps that side every call, even if the obstacle jitters across
//    his centre line, so he never flip-flops.
//  - Release: A) the obstacle leaves the wider corridor (R + RELEASE_MARGIN);
//    B) the goal key changes; C) he makes < STUCK_PROGRESS of maxStep along
//    the goal direction for STUCK_TIME seconds: flip once (up to MAX_FLIPS),
//    then hold and lean on collision.
export const AVOID_CLEARANCE = 0.3;
export const LOOKAHEAD = 4.0;
export const RELEASE_MARGIN = 0.3;
export const STUCK_TIME = 0.3;
export const STUCK_PROGRESS = 0.25;
export const MAX_FLIPS = 1;

export function steerStep(p, goal, players, maxStep, dt, radius) {
  if (p.steer && p.steer.key !== goal.key) p.steer = null;

  const gx = goal.x - p.x, gy = goal.y - p.y;
  const D = Math.hypot(gx, gy);
  if (D < 1e-12 || maxStep < 1e-6) {
    if (p.steer) p.steer.stuck = 0;
    return;
  }

  const sx = p.x, sy = p.y;
  const ux = gx / D, uy = gy / D;
  const R = 2 * radius + AVOID_CLEARANCE;

  const firstObstacle = (width) => {
    let best = null, bestT = Infinity, bestLat = 0;
    const lim = Math.min(LOOKAHEAD, D);
    for (const o of players) {
      if (o === p || o.id === p.id || (goal.ignore != null && o.id === goal.ignore)) continue;
      const rx = o.x - p.x, ry = o.y - p.y;
      const t = rx * ux + ry * uy;
      const lat = ux * ry - uy * rx;
      if (t > 0 && t <= lim && Math.abs(lat) < width) {
        if (best === null || t < bestT - 1e-9) { best = o; bestT = t; bestLat = lat; }
      }
    }
    return best ? { o: best, t: bestT, lat: bestLat } : null;
  };

  const hit = firstObstacle(R);
  if (p.steer && p.steer.side !== 0 && firstObstacle(R + RELEASE_MARGIN) === null) {
    p.steer.side = 0; p.steer.stuck = 0; p.steer.flips = 0;
  }

  let dx = ux, dy = uy;
  if (hit) {
    if (!p.steer) p.steer = { key: goal.key, side: 0, stuck: 0, flips: 0 };
    const s = p.steer;
    if (s.side === 0) s.side = hit.lat > 1e-9 ? -1 : hit.lat < -1e-9 ? 1 : 1;
    const rx = hit.o.x - p.x, ry = hit.o.y - p.y;
    const d = Math.hypot(rx, ry);
    const a = d > R ? Math.asin(R / d) : Math.PI / 2;
    const ang = s.side * a, c = Math.cos(ang), sn = Math.sin(ang);
    const nx = rx / d, ny = ry / d;
    dx = nx * c - ny * sn;
    dy = nx * sn + ny * c;
  }

  let vx = dx * Math.min(maxStep, D), vy = dy * Math.min(maxStep, D);
  for (let pass = 0; pass < 2; pass++) {
    for (const o of players) {
      if (o === p) continue;
      const rx = o.x - p.x, ry = o.y - p.y;
      const d = Math.hypot(rx, ry);
      if (d > 0 && d <= 2 * radius + 1e-6) {
        const nx = rx / d, ny = ry / d;
        const dot = vx * nx + vy * ny;
        if (dot > 0) { vx -= dot * nx; vy -= dot * ny; }
      }
    }
  }
  const vl = Math.hypot(vx, vy);
  if (vl >= 1e-12) {
    const mx = vx / vl, my = vy / vl;
    let step = vl;
    const dd = 4 * radius * radius;
    for (const o of players) {
      if (o === p) continue;
      const rx = o.x - p.x, ry = o.y - p.y;
      const b = rx * mx + ry * my;
      if (b <= 0) continue;
      const c = rx * rx + ry * ry - dd;
      if (c <= 1e-6) continue;
      const disc = b * b - c;
      if (disc > 0) step = Math.min(step, Math.max(0, b - Math.sqrt(disc)));
    }
    p.x += mx * step;
    p.y += my * step;
  }

  const s = p.steer;
  if (s && s.side !== 0) {
    const prog = s.lx === undefined ? Infinity : (sx - s.lx) * ux + (sy - s.ly) * uy;
    if (prog < STUCK_PROGRESS * maxStep) s.stuck += dt; else s.stuck = 0;
    if (s.stuck >= STUCK_TIME - 1e-9) {
      s.stuck = 0;
      if (s.flips < MAX_FLIPS) { s.side = -s.side; s.flips++; }
    }
  }
  if (p.steer) { p.steer.lx = sx; p.steer.ly = sy; }
}
