// Local steering for one player: move toward a goal around other bodies.
// Pure module (no imports, no THREE, no DOM).
//
// ROUTE COMMITMENT RULE (tunables below)
//  - Commit: the first time an obstacle sits in the corridor ahead (touch width
//    2 * radius; the preferred passing distance is R),
//    the mover picks a pass side (left/right) and records it in p.steer.
//  - Hold: he keeps that side every call, even if the obstacle jitters across
//    his centre line, so he never flip-flops. The detour also holds while the
//    first obstacle sits anywhere in the wider corridor (2 * radius + RELEASE_MARGIN),
//    not only the touch-width one: a goal swinging across a body's line moves the
//    body's lateral offset over the touch-width edge, and re-deciding the detour at that
//    edge each tick swung the step between straight ahead and the tangent past the body.
//  - Release: A) the obstacle leaves the wider corridor (2 * radius + RELEASE_MARGIN);
//    B) the goal key changes; C) he makes < STUCK_PROGRESS of maxStep along
//    the goal direction for STUCK_TIME seconds, judged as the lesser of the last
//    step's advance and half the last two steps' advance: drop any lane (and set
//    laneOff, which bars lanes until release A), flip once (up to MAX_FLIPS),
//    then hold and lean on collision. Going round the body in his way is progress
//    too (T-59): while his own displacement relative to the body he detoured round
//    last (same lesser-of-one-and-two-steps rule) reaches STUCK_PROGRESS of maxStep,
//    he is not stuck, so a goal swinging behind that body (an LB coming downhill)
//    does not flip him back out the way he came; a body sliding along with him still
//    leaves him stuck. A planted-cut mover (goal.accel) keeps the goal-line rule alone.
//  - Accel: see ACCEL_TAU below; players with a numeric p.v ramp up from rest.
//  - Lane: if the obstacle and its neighbour on the pass side are spaced >= 2 * H apart
//    (and sit across the goal direction: lateral separation >= LANE_ACROSS * 2 * H, so bodies
//    stacked along the path form no lane),
//    aim at their midpoint and hold that lane while both are ahead,
//    except a blocker and his block target (they close by design), which are
//    re-judged by the opening test every tick. Lane exit (T-59): when the lane drops
//    (a body no longer ahead: he is level with the gap and his goal swung toward one
//    side), the held side was judged against the lane's first body; if, held against
//    the body now in his way, its detour points back against the goal (round the far
//    side of a body he is level with), he flips it (counted, up to MAX_FLIPS) and goes
//    on through the gap. A forward goal keeps its side (its backward part is dropped anyway).
//    A planted-cut mover (goal.accel) keeps his side too, as he keeps the goal-line stuck rule:
//    his turn is bounded by his own accel cap and the contact rules (inelastic, no rebound), and
//    measured on the T-56 build an exit flip on a pursuing LB changed the bodies a free DL met
//    and pushed that DL's contact rebound over its bound.
//  - Goal fields: accel, pace, ignore, and forward (boolean, opt-in):
//    the plain-hit detour never points against the goal; its backward part is
//    dropped, leaving a sideways slide (side, flips and release rules unchanged).
//    p.avoid === false (test switch, F-63): no detours, lanes or flips; contact still resolved.
export const AVOID_CLEARANCE = 0.3;
export const LOOKAHEAD = 4.0;
export const RELEASE_MARGIN = 0.3;
export const STUCK_TIME = 0.3;
export const STUCK_PROGRESS = 0.25;
export const MAX_FLIPS = 1;
// A new lane needs an opening across the goal direction: the lateral (relative to the goal line)
// separation of the two bodies must be at least LANE_ACROSS * 2 * H, so two bodies stacked along the path form none (tunable).
export const LANE_ACROSS = 0.3;
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
// Bodies never snap a mover (PRINCIPLES #11). When a step is steered by bodies (a detour around a
// body in the corridor or in the committed pass, a lane aim, or a contact slide) and the goal has no accel cap of its own, it
// changes his velocity by at most this much (yd/s) in one tick. Measured (T-44): a free mover between
// two engaged bodies took 2-4 yd/s jumps in one tick with no push-out at all: the plain-hit detour
// around a touching body switches on and off as that body's lateral offset crosses the corridor edge
// (|lat| < 2 * radius), and each switch swings the step from straight ahead to the tangent past it.
// The limit spreads that swing over a few ticks. A step with no body in play is the caller's own
// choice and is untouched (a goal.accel cap, or none), with one carry (T-59): when bodies steered (or
// this limit shaped) his last step and his measured velocity (p.selfVel ?? p.vel) is that step (within
// MAX_AVOID_DV), the limit also holds on this step, whatever his speed and whether or not a body is still
// in play, and it survives a key change. Measured on main: the limit braked a climber to under 1 yd/s,
// then the low-speed exemption let the next steered step snap 3 yd/s; and a release (the lane and side
// drop) swung a mover 4 yd/s in one tick. The carry runs until he steps freely at his own choice again;
// a mover at rest, without a measured velocity, or moved by others between calls starts freely as before.
export const MAX_AVOID_DV = 1.0;

// Rotate (vx, vy), a vector to a body at distance d, toward `sign` (+1 / -1) by the angle whose
// tangent line just clears a circle of the given clearance round the body: asin(clearance / d), a
// quarter turn when he is already inside the clearance. The result keeps the length of (vx, vy), so
// a unit vector gives a unit tangent and a raw offset gives d times that.
function tangent(vx, vy, d, clearance, sign) {
  const ang = sign * (d > clearance ? Math.asin(clearance / d) : Math.PI / 2), c = Math.cos(ang), sn = Math.sin(ang);
  return { x: vx * c - vy * sn, y: vx * sn + vy * c };
}

// The one pass-side flip, shared by two triggers, each with its own gate and resets (the caller's):
//  - lane exit: the side was judged against a lane body he has left, and the detour round the body now in
//    his way points back against his goal; flipping goes on through the gap. A flip clears the stuck
//    clock (the new side starts fresh) and the caller takes that body as the one he detours round.
//  - stuck: STUCK_TIME without progress; the caller has already dropped the lane and barred new ones
//    (laneOff) and clears the clock whether or not a flip is left, so the next judgement starts anew.
// Counted against MAX_FLIPS; returns whether it flipped.
function flipSide(s) {
  if (s.flips >= MAX_FLIPS) return false;
  s.side = -s.side; s.flips++;
  return true;
}

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
  // The MAX_AVOID_DV carry belongs to his motion, not to the goal: it survives a key change (release B).
  const carried = p.steer && p.steer.steered ? { x: p.steer.vx, y: p.steer.vy } : null;
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

  // p.avoid === false (F-63 test switch): no body is ever in his way, so no detour, lane or flip; clampStep still applies.
  const noAvoid = p.avoid === false;
  const firstObstacle = (width) => {
    if (noAvoid) return null;
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

  let hit = firstObstacle(2 * radius);
  if (p.steer && p.steer.side !== 0) {
    // Hold: a committed mover keeps detouring around the first obstacle in the wider corridor, so a goal
    // sliding across the body's line does not switch the detour on and off at the touch-width edge.
    const wide = firstObstacle(2 * radius + RELEASE_MARGIN);
    if (wide === null) {
      p.steer.side = 0; p.steer.stuck = 0; p.steer.flips = 0;
      p.steer.lane = null; p.steer.laneOff = false;
    } else if (hit === null) hit = wide;
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
  if (noAvoid && p.steer) p.steer.lane = null;
  if (p.steer && p.steer.lane) {
    const a = byId(p.steer.lane[0]), b = byId(p.steer.lane[1]);
    const blockPair = a && b && (a.block?.target === b.id || b.block?.target === a.id);
    if (a && b && !blockPair && ahead(a) && ahead(b)) { laneMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; laneBodies = [a, b]; }
    else {
      p.steer.lane = null;
      // Lane exit: the pass side was judged against the lane's first body. If, held against the body now
      // in his way, its detour would point back against his goal (round the far side of a body he is
      // level with, out through the gap he came in by), he flips it (counted, up to MAX_FLIPS): the other
      // tangent always points forward. A forward goal already drops that backward part, so it keeps its side;
      // a planted-cut mover (goal.accel) keeps his side as well (his cap and the contact rules shape his turn).
      const h2 = firstObstacle(2 * radius);
      const s = p.steer;
      if (accel === null && !goal.forward && h2 && s.side !== 0 && s.flips < MAX_FLIPS) {
        const rx = h2.o.x - p.x, ry = h2.o.y - p.y, d = Math.hypot(rx, ry);
        const tg = tangent(rx, ry, d, R, s.side);
        if ((tg.x * ux + tg.y * uy) / d < 0 && flipSide(s)) {
          s.stuck = 0;
          hit = h2;
        }
      }
    }
  }

  let dx = ux, dy = uy;
  if (laneMid) {
    const lx = laneMid.x - p.x, ly = laneMid.y - p.y, ll = Math.hypot(lx, ly);
    if (ll > 1e-12) { dx = lx / ll; dy = ly / ll; }
  } else if (hit) {
    if (!p.steer) p.steer = { key: goal.key, side: 0, stuck: 0, flips: 0 };
    const s = p.steer;
    if (s.lane === undefined) s.lane = null;
    if (s.side === 0) s.side = hit.lat > 1e-9 ? -1 : 1;
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
        if (sp >= 2 * R || sp >= nd) continue;
        // The opening must lie across his goal direction, not along it.
        if (Math.abs(qlat - hit.lat) < LANE_ACROSS * 2 * H) continue;
        n = q; nd = sp;
      }
      if (n && nd >= 2 * H) {
        s.lane = [hit.o.id, n.id];
        const lx = (hit.o.x + n.x) / 2 - p.x, ly = (hit.o.y + n.y) / 2 - p.y, ll = Math.hypot(lx, ly);
        if (ll > 1e-12) { threading = true; laneBodies = [hit.o, n]; dx = lx / ll; dy = ly / ll; }
      }
    }
  }
  // Lane aim: bend around a lane body the straight line to the midpoint would graze.
  if (laneBodies) {
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
      const tang = (sg) => tangent(nx, ny, pd, rc, sg);
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
    const tg = tangent(rx / d, ry / d, d, R, s.side);
    dx = tg.x;
    dy = tg.y;
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
  const steered = laneMid || threading || hit || (p.steer && p.steer.side !== 0) || mv.x !== dx * Math.min(maxStep, D) || mv.y !== dy * Math.min(maxStep, D);
  // Carry: bodies steered (or the cap shaped) his last step and his measured velocity is that step.
  const vm = p.selfVel ?? p.vel;
  const wasSteered = !!carried && vm != null && Math.hypot(vm.x - carried.x, vm.y - carried.y) <= MAX_AVOID_DV;
  let capped = false;
  if (accel === null && dt > 0 && (steered || wasSteered)) {
    const v0 = vm ?? { x: 0, y: 0 };
    const ex = mv.x / dt - v0.x, ey = mv.y / dt - v0.y, el = Math.hypot(ex, ey);
    // a mover without momentum to keep (at rest, or no measured velocity) starts freely, unless the carry holds
    if (el > MAX_AVOID_DV && (wasSteered || Math.hypot(v0.x, v0.y) > MAX_AVOID_DV)) {
      // The contact clamps can slide the capped step off a touched body and so move it further from v0 than
      // MAX_AVOID_DV (T-72, F-55 #9: ~0.9 yd/s extra beside a free LB, on top of the cap). The cap is judged
      // on the step he will actually take: shrink the change until the clamped step is within MAX_AVOID_DV.
      const fit = (k) => {
        let ax = (v0.x + ex * MAX_AVOID_DV * k / el) * dt, ay = (v0.y + ey * MAX_AVOID_DV * k / el) * dt;
        const al = Math.hypot(ax, ay);
        if (al > maxStep) { ax *= maxStep / al; ay *= maxStep / al; }
        return clampStep(ax, ay);
      };
      mv = fit(1);
      if (Math.hypot(mv.x / dt - v0.x, mv.y / dt - v0.y) > MAX_AVOID_DV + 1e-9) {
        let lo = 0, hi = 1;
        for (let it = 0; it < 12; it++) {
          const mid = (lo + hi) / 2, f = fit(mid);
          if (Math.hypot(f.x / dt - v0.x, f.y / dt - v0.y) > MAX_AVOID_DV + 1e-9) hi = mid; else lo = mid;
        }
        mv = fit(lo);
      }
      capped = true;
    }
  }
  p.x += mv.x;
  p.y += mv.y;

  // keep the carry across a release that dropped p.steer (key change): a bare record, no pass side
  if (!p.steer && accel === null && (steered || capped) && (p.selfVel != null || p.vel != null)) {
    p.steer = { key: goal.key, side: 0, stuck: 0, flips: 0, lane: null };
  }
  const s = p.steer;
  if (s && s.side !== 0) {
    let prog = s.lx === undefined ? Infinity : (sx - s.lx) * ux + (sy - s.ly) * uy;
    // Also judge the net advance over two steps, so a forward step that
    // separation undoes the next step (a 2-cycle) still counts as stuck.
    if (s.lx2 !== undefined) prog = Math.min(prog, ((sx - s.lx2) * ux + (sy - s.ly2) * uy) / 2);
    // Going round the body in his way is progress too: he is not stuck while he moves relative to it
    // (a body that moves with him, mirroring his slide, still leaves him stuck). A planted-cut mover
    // (goal.accel: free defenders) keeps the goal-line judgement alone.
    const ho = s.hid != null && s.lx !== undefined ? byId(s.hid) : null;
    if (ho && accel === null) {
      let rel = Math.hypot(sx - s.lx - (ho.x - s.hx), sy - s.ly - (ho.y - s.hy));
      if (s.lx2 !== undefined) {
        // two steps net (a 2-cycle between two bodies is no progress round either)
        const bx = s.hid2 === s.hid ? ho.x - s.hx2 : 0, by = s.hid2 === s.hid ? ho.y - s.hy2 : 0;
        rel = Math.min(rel, Math.hypot(sx - s.lx2 - bx, sy - s.ly2 - by) / 2);
      }
      prog = Math.max(prog, rel);
    }
    // A planted cut (goal.accel, last step still carrying speed away from the goal) is neither
    // stuck nor free: the turn is not read as a stall, so it does not flip his side.
    if (s.plant) { /* planting: hold */ } else if (prog < STUCK_PROGRESS * fullStep) s.stuck += dt; else s.stuck = 0;
    if (s.stuck >= STUCK_TIME - 1e-9) {
      s.stuck = 0;
      if (s.lane) { s.lane = null; s.laneOff = true; }
      flipSide(s);
    }
  }
  if (p.steer) {
    p.steer.lx2 = p.steer.lx; p.steer.ly2 = p.steer.ly; p.steer.lx = sx; p.steer.ly = sy;
    p.steer.hid2 = p.steer.hid; p.steer.hx2 = p.steer.hx; p.steer.hy2 = p.steer.hy;
    if (hit) { p.steer.hid = hit.o.id; p.steer.hx = hit.o.x; p.steer.hy = hit.o.y; } else p.steer.hid = null;
    if (plant) p.steer.plant = true; else delete p.steer.plant;
    if (dt > 0 && (steered || capped)) { p.steer.steered = true; p.steer.vx = mv.x / dt; p.steer.vy = mv.y / dt; }
    else { delete p.steer.steered; delete p.steer.vx; delete p.steer.vy; }
  }
}
