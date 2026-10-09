// Local steering for one player: move toward a goal around other bodies.
// Pure module (no imports, no THREE, no DOM).
//
// ROUTE COMMITMENT RULE (tunables below)
//  - Commit: the first time an obstacle sits in the corridor ahead (touch width
//    2 * radius; the preferred passing distance is R),
//    the mover picks a pass side (left/right) and records it in p.steer.
//  - Hold: he keeps that side every call, even if the obstacle jitters across
//    his centre line, so he never flip-flops.
//  - Release: A) the obstacle leaves the wider corridor (2 * radius + RELEASE_MARGIN);
//    B) the goal key changes; C) he makes < STUCK_PROGRESS of maxStep along
//    the goal direction for STUCK_TIME seconds, judged as the lesser of the last
//    step's advance and half the last two steps' advance: drop any lane (and set
//    laneOff, which bars lanes until release A), flip once (up to MAX_FLIPS),
//    then hold and lean on collision.
//  - Lane: if the obstacle and its neighbour on the pass side are spaced >= 2 * H
//    apart, aim at their midpoint and hold that lane while both are ahead.
export const AVOID_CLEARANCE = 0.3;
export const LOOKAHEAD = 4.0;
export const RELEASE_MARGIN = 0.3;
export const STUCK_TIME = 0.3;
export const STUCK_PROGRESS = 0.25;
export const MAX_FLIPS = 1;
// Fraction of the body diameter two bodies may overlap while squeezing past
// each other. Stands in for a player turning his shoulders.
export const SQUEEZE = 0.25;
// Hard contact distance H: the one source of truth for how close two bodies
// may get.
export function hardCore(radius) { return 2 * radius * (1 - SQUEEZE); }

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
  const H = hardCore(radius);
  // A mover meets the body he is going to (block target, ball holder, QB at
  // the mesh) at shoulder width and squeezes only past bodies in his way.
  const contact = (o) => (goal.ignore != null && o.id === goal.ignore ? 2 * radius : H);

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

  const hit = firstObstacle(2 * radius);
  if (p.steer && p.steer.side !== 0 && firstObstacle(2 * radius + RELEASE_MARGIN) === null) {
    p.steer.side = 0; p.steer.stuck = 0; p.steer.flips = 0;
    p.steer.lane = null; p.steer.laneOff = false;
  }

  const byId = (id) => {
    for (const o of players) if (o.id === id && o !== p) return o;
    return null;
  };
  const ahead = (o) => {
    const t = (o.x - p.x) * ux + (o.y - p.y) * uy;
    return t > 0 && t <= LOOKAHEAD;
  };

  // A recorded lane stays valid while both bodies are still ahead.
  let laneMid = null, threading = false;
  if (p.steer && p.steer.lane) {
    const a = byId(p.steer.lane[0]), b = byId(p.steer.lane[1]);
    if (a && b && ahead(a) && ahead(b)) laneMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    else p.steer.lane = null;
  }

  let dx = ux, dy = uy;
  if (laneMid) {
    const lx = laneMid.x - p.x, ly = laneMid.y - p.y, ll = Math.hypot(lx, ly);
    if (ll > 1e-12) { dx = lx / ll; dy = ly / ll; }
  } else if (hit) {
    if (!p.steer) p.steer = { key: goal.key, side: 0, stuck: 0, flips: 0 };
    const s = p.steer;
    if (s.lane === undefined) s.lane = null;
    if (s.side === 0) s.side = hit.lat > 1e-9 ? -1 : hit.lat < -1e-9 ? 1 : 1;
    if (!s.laneOff) {
      // Find the body bounding the lane on the pass side of the obstacle.
      let n = null, nd = Infinity;
      for (const q of players) {
        if (q === p || q === hit.o || q.id === p.id || q.id === hit.o.id) continue;
        if (goal.ignore != null && q.id === goal.ignore) continue;
        if (!ahead(q)) continue;
        const qlat = ux * (q.y - p.y) - uy * (q.x - p.x);
        if (s.side * (qlat - hit.lat) <= 0) continue;
        const sp = Math.hypot(q.x - hit.o.x, q.y - hit.o.y);
        if (sp < 2 * R && sp < nd) { n = q; nd = sp; }
      }
      if (n && nd >= 2 * H) {
        s.lane = [hit.o.id, n.id];
        const lx = (hit.o.x + n.x) / 2 - p.x, ly = (hit.o.y + n.y) / 2 - p.y, ll = Math.hypot(lx, ly);
        if (ll > 1e-12) { threading = true; dx = lx / ll; dy = ly / ll; }
      }
    }
  }
  if (!laneMid && !threading && hit) {
    const s = p.steer;
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
      if (d > 0 && d <= contact(o) + 1e-6) {
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
    for (const o of players) {
      if (o === p) continue;
      const rx = o.x - p.x, ry = o.y - p.y;
      const b = rx * mx + ry * my;
      if (b <= 0) continue;
      const dd = contact(o) * contact(o);
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
    let prog = s.lx === undefined ? Infinity : (sx - s.lx) * ux + (sy - s.ly) * uy;
    // Also judge the net advance over two steps, so a forward step that
    // separation undoes the next step (a 2-cycle) still counts as stuck.
    if (s.lx2 !== undefined) prog = Math.min(prog, ((sx - s.lx2) * ux + (sy - s.ly2) * uy) / 2);
    if (prog < STUCK_PROGRESS * maxStep) s.stuck += dt; else s.stuck = 0;
    if (s.stuck >= STUCK_TIME - 1e-9) {
      s.stuck = 0;
      if (s.lane) { s.lane = null; s.laneOff = true; }
      if (s.flips < MAX_FLIPS) { s.side = -s.side; s.flips++; }
    }
  }
  if (p.steer) { p.steer.lx2 = p.steer.lx; p.steer.ly2 = p.steer.ly; p.steer.lx = sx; p.steer.ly = sy; }
}
