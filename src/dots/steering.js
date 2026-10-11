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
//  - Accel: see ACCEL_TAU below; players with a numeric p.v ramp up from rest.
//  - Lane: if the obstacle and its neighbour on the pass side are spaced >= 2 * H
//    apart, aim at their midpoint and hold that lane while both are ahead,
//    except a blocker and his block target (they close by design), which are
//    re-judged by the opening test every tick.
//  - Goal fields: accel, pace, ignore, squeeze, and forward (boolean, opt-in):
//    the plain-hit detour never points against the goal; its backward part is
//    dropped, leaving a sideways slide (side, flips and release rules unchanged).
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

// Opt-in acceleration: a mover carrying a numeric p.v (current speed, yd/s) has
// maxStep capped by a ramp from v toward his top speed (p.speed, else maxStep/dt)
// with time constant ACCEL_TAU. The caller owns p.v; steerStep never writes it.
export const ACCEL_TAU = 0.7; // seconds; exponential time constant to top speed (tunable)
// Faster time constant for a committed burst (seconds; tunable, faster than ACCEL_TAU).
export const BURST_TAU = 0.25;

// Per-phase pace table (tunables): a phase picks a target speed as a fraction of
// top speed and how fast to reach it. press = controlled wait speed, burst =
// commit. Any mover may pass one as goal.pace.
export const PACES = Object.freeze({
  cruise: Object.freeze({ frac: 1, tau: ACCEL_TAU }),
  press: Object.freeze({ frac: 0.5, tau: ACCEL_TAU }),
  burst: Object.freeze({ frac: 1, tau: BURST_TAU }),
});

// Opt-in planted cut: a goal carrying goal.accel (yd/s^2) limits how fast the mover's velocity may
// change. His last velocity v0 is p.selfVel when the caller keeps one (his own step, contact
// push-outs taken out), else p.vel (measured by the caller; {0, 0} when missing); if the chosen
// step / dt differs from v0 by more than accel * dt, he takes v0 moved accel * dt toward it, so a
// reversal slows through zero (the plant) and re-accelerates. The step is still never longer than
// maxStep and still meets the contact clamps. A step still carrying speed away from the goal is a
// plant: it is not judged stuck (no side flip). CUT_ACCEL: an NFL linebacker's planted cut is roughly
// 10-25 yd/s^2 (tunable).
export const CUT_ACCEL = 20;

export function steerStep(p, goal, players, maxStep, dt, radius) {
  const fullStep = maxStep;
  const pace = goal.pace || null;
  const accel = typeof goal.accel === 'number' && dt > 0 ? goal.accel : null;
  if (typeof p.v === 'number' && dt > 0) {
    let top = typeof p.speed === 'number' ? p.speed : maxStep / dt;
    let tau = ACCEL_TAU;
    if (pace) { top *= pace.frac; tau = pace.tau; }
    const ramp = p.v + (top - p.v) * (1 - Math.exp(-dt / tau));
    maxStep = Math.min(maxStep, ramp * dt);
  } else if (pace && dt > 0) {
    const top = (typeof p.speed === 'number' ? p.speed : maxStep / dt) * pace.frac;
    maxStep = Math.min(maxStep, top * dt);
  }
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
  let laneMid = null, threading = false, laneBodies = null;
  if (p.steer && p.steer.lane) {
    const a = byId(p.steer.lane[0]), b = byId(p.steer.lane[1]);
    const blockPair = a && b && (a.block?.target === b.id || b.block?.target === a.id);
    if (a && b && !blockPair && ahead(a) && ahead(b)) { laneMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; laneBodies = [a, b]; }
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
        if (ll > 1e-12) { threading = true; laneBodies = [hit.o, n]; dx = lx / ll; dy = ly / ll; }
      }
    }
  }
  // Lane aim: bend around a lane body the straight line to the midpoint would graze.
  if (laneBodies && (laneMid || threading)) {
    const [la, lb] = laneBodies;
    const mx = (la.x + lb.x) / 2, my = (la.y + lb.y) / 2;
    const w = Math.hypot(la.x - lb.x, la.y - lb.y);
    const rc = Math.min(2 * radius, w / 2);
    const tmid = (mx - p.x) * dx + (my - p.y) * dy;
    let pick = null, pd = Infinity, plat = 0;
    for (const o of laneBodies) {
      const rx = o.x - p.x, ry = o.y - p.y;
      const t = rx * dx + ry * dy;
      const lat = dx * ry - dy * rx;
      const d = Math.hypot(rx, ry);
      if (t > 0 && t < tmid && Math.abs(lat) < rc && d > rc && d < pd) { pick = o; pd = d; plat = lat; }
    }
    if (pick) {
      const rx = pick.x - p.x, ry = pick.y - p.y;
      // lane side: the side of the line to the body on which the midpoint lies
      const cr = rx * (my - p.y) - ry * (mx - p.x);
      const nx = rx / pd, ny = ry / pd;
      const tang = (sg) => {
        const ang = sg * Math.asin(rc / pd), c = Math.cos(ang), sn = Math.sin(ang);
        return { x: nx * c - ny * sn, y: nx * sn + ny * c };
      };
      // a side is plugged when a body within 2 * H of the picked edge body lies within H of that side's tangent before the lane midpoint (no room to squeeze between them)
      const plugged = (v) => {
        const tl = Math.hypot(mx - p.x, my - p.y);
        for (const q of players) {
          if (q === p || q === la || q === lb || q.id === p.id || (goal.ignore != null && q.id === goal.ignore)) continue;
          if (Math.hypot(q.x - pick.x, q.y - pick.y) >= 2 * H) continue;
          const qx = q.x - p.x, qy = q.y - p.y;
          const t = qx * v.x + qy * v.y;
          if (t > 0 && t < tl && Math.abs(v.x * qy - v.y * qx) < H) return true;
        }
        return false;
      };
      const sgn = cr >= 0 ? 1 : -1;
      let v = tang(sgn);
      if (plugged(v)) { const alt = tang(-sgn); if (!plugged(alt)) v = alt; }
      dx = v.x; dy = v.y;
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
    if (goal.forward) {
      const al = dx * ux + dy * uy;
      if (al < 0) {
        const lx = dx - al * ux, ly = dy - al * uy, ll = Math.hypot(lx, ly);
        if (ll > 1e-9) { dx = lx / ll; dy = ly / ll; }
      }
    }
  }

  // a tangent slide step of length s ends about s^2/(2c) outside the circle, so this keeps the mover touching on the next call
  const sl = Math.min(maxStep, D), tol = Math.max(1e-6, sl * sl / (2 * radius));
  // Contact clamps on a step: slide off bodies he touches, then stop the ray at hard contact.
  const clampStep = (vx, vy) => {
    for (let pass = 0; pass < 2; pass++) {
      for (const o of players) {
        if (o === p) continue;
        const rx = o.x - p.x, ry = o.y - p.y;
        const d = Math.hypot(rx, ry);
        if (d > 0 && d <= contact(o) + tol) {
          const nx = rx / d, ny = ry / d;
          const dot = vx * nx + vy * ny;
          if (dot > 0) { vx -= dot * nx; vy -= dot * ny; }
        }
      }
    }
    const vl = Math.hypot(vx, vy);
    if (vl < 1e-12) return { x: 0, y: 0 };
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
    return { x: mx * step, y: my * step };
  };
  let mv = clampStep(dx * Math.min(maxStep, D), dy * Math.min(maxStep, D));
  // Planted cut (goal.accel): the chosen step's velocity moves from v0 by at most accel * dt;
  // the capped step is never longer than maxStep and meets the contact clamps again.
  let plant = false;
  if (accel !== null) {
    const v0 = p.selfVel ?? p.vel ?? { x: 0, y: 0 };
    const ex = mv.x / dt - v0.x, ey = mv.y / dt - v0.y, el = Math.hypot(ex, ey), lim = accel * dt;
    if (el > lim) {
      let cx = (v0.x + ex * lim / el) * dt, cy = (v0.y + ey * lim / el) * dt;
      const cl = Math.hypot(cx, cy);
      if (cl > maxStep) { cx *= maxStep / cl; cy *= maxStep / cl; }
      mv = clampStep(cx, cy);
      // Still carrying speed away from the goal: a plant, not a stall.
      plant = v0.x * ux + v0.y * uy < 0;
    }
  }
  p.x += mv.x;
  p.y += mv.y;

  const s = p.steer;
  if (s && s.side !== 0) {
    let prog = s.lx === undefined ? Infinity : (sx - s.lx) * ux + (sy - s.ly) * uy;
    // Also judge the net advance over two steps, so a forward step that
    // separation undoes the next step (a 2-cycle) still counts as stuck.
    if (s.lx2 !== undefined) prog = Math.min(prog, ((sx - s.lx2) * ux + (sy - s.ly2) * uy) / 2);
    // A planted cut (goal.accel, last step still carrying speed away from the goal) is neither
    // stuck nor free: the turn is not read as a stall, so it does not flip his side.
    if (s.plant) { /* planting: hold */ } else if (prog < STUCK_PROGRESS * fullStep) s.stuck += dt; else s.stuck = 0;
    if (s.stuck >= STUCK_TIME - 1e-9) {
      s.stuck = 0;
      if (s.lane) { s.lane = null; s.laneOff = true; }
      if (s.flips < MAX_FLIPS) { s.side = -s.side; s.flips++; }
    }
  }
  if (p.steer) {
    p.steer.lx2 = p.steer.lx; p.steer.ly2 = p.steer.ly; p.steer.lx = sx; p.steer.ly = sy;
    if (plant) p.steer.plant = true; else delete p.steer.plant;
  }
}
