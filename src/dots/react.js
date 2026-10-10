// Engaged-defender reaction: balance state and force direction.
// Pure: no imports, no mutation of arguments; every function returns new objects.
// Covers engaged defenders only. `goal` is the point he steers to (his gap point
// or the ball), {x, y}.
//
// Extending (not implemented here):
//   - later ratings come from a per-row `defender.def?.react` object read here
//   - a gap fit goes in anchorSide (replaces goal.x)
//   - strength factors stay in blocking.js driveForce/blockForce
export const REACT_STATES = Object.freeze(['neutral', 'driven', 'anchored', 'winning']);
export const DRIVEN_SPEED = 0.3; // yd/s along the push to count as driven
export const WIN_SPEED = 0.3; // yd/s against the push to count as winning
export const BALANCE_YDS = 0.5; // yards driven off stance for full lean
export const ANCHOR_RATE = 2.0; // /s, max lean rise per second
export const RECOVER_RATE = 0.5; // /s, lean fall and stance catch-up per second
export const ANCHOR_MIN = 0.25; // lean at which he counts as anchored
export const ANCHOR_LATERAL = 0.7; // sideways part of the anchor per unit of backward lean
export const SIDE_DEADZONE = 0.1; // yd
export const HOLD_GIVE = 0.5; // yd he can be moved off the engage spot before the anchor stiffens
export const HOLD_STIFF = 1.2; // force units per yd beyond the give
export const SHED_REACH = 8 * 0.28; // yd: 8 body radii (BODY_RADIUS lives in blocking.js; react.js imports nothing)
export const LEVER_COS = 0.5; // goal must be at least 60 degrees off the line through his blocker

export function startReact(d) {
  return {
    state: 'neutral', sx: d.x, sy: d.y, px: d.x, py: d.y, lean: 0, side: 0, dir: null,
    ex: d.x, ey: d.y, hold: { x: 0, y: 0 },
  };
}

// Anchor hold: pulls back toward the engage spot once he is moved past HOLD_GIVE
// in the push's direction. Capped at the push it absorbs.
export function anchorHold(ex, ey, d, push) {
  const dx = d.x - ex;
  const dy = d.y - ey;
  const m = Math.hypot(dx, dy);
  const P = Math.hypot(push.x, push.y);
  if (P < 1e-9 || m < 1e-9 || dx * push.x + dy * push.y <= 0) return { x: 0, y: 0 };
  const h = Math.min(P, HOLD_STIFF * Math.max(0, m - HOLD_GIVE));
  return { x: -h * dx / m, y: -h * dy / m };
}

export function anchorSide(prevSide, d, goal) {
  // Single hook where a later gap fit replaces ball.x.
  const dx = goal.x - d.x;
  return Math.abs(dx) > SIDE_DEADZONE ? Math.sign(dx) : prevSide;
}

export function anchorDir(side, pu) {
  // Hook where leverage later scales or flips the lateral term.
  const u = pu ?? { x: 0, y: 1 };
  const n = u.y >= 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  const x = -u.x + ANCHOR_LATERAL * side * n.x;
  const y = -u.y + ANCHOR_LATERAL * side * n.y;
  const m = Math.hypot(x, y);
  return m < 1e-9 ? { x: 0, y: 0 } : { x: x / m, y: y / m };
}

export function stepReact(react, d, push, goal, dt) {
  const r = react ?? startReact(d);
  const ex = r.ex;
  const ey = r.ey;
  const P = Math.hypot(push.x, push.y);
  const pu = P < 1e-9 ? null : { x: push.x / P, y: push.y / P };
  const vx = dt > 0 ? (d.x - r.px) / dt : 0;
  const vy = dt > 0 ? (d.y - r.py) / dt : 0;
  const along = pu ? vx * pu.x + vy * pu.y : 0;
  let sx = r.sx;
  let sy = r.sy;
  if (along < DRIVEN_SPEED) {
    const k = Math.min(1, RECOVER_RATE * dt);
    sx += (d.x - sx) * k;
    sy += (d.y - sy) * k;
  }
  const off = pu ? Math.max(0, (d.x - sx) * pu.x + (d.y - sy) * pu.y) : 0;
  const target = Math.min(1, off / BALANCE_YDS);
  const lean = target > r.lean
    ? Math.min(target, r.lean + ANCHOR_RATE * dt)
    : Math.max(target, r.lean - RECOVER_RATE * dt);
  const side = anchorSide(r.side, d, goal);
  const bx = goal.x - d.x;
  const by = goal.y - d.y;
  const bm = Math.hypot(bx, by);
  const g = bm < 1e-9 ? { x: 0, y: 0 } : { x: bx / bm, y: by / bm };
  const a = anchorDir(side, pu);
  const x = (1 - lean) * g.x + lean * a.x;
  const y = (1 - lean) * g.y + lean * a.y;
  const m = Math.hypot(x, y);
  const dir = m < 1e-9 ? null : { x: x / m, y: y / m };
  // Leverage is the single place a defender earns a shed: his goal is close and
  // off his blocker's line (including goals behind the push). Ratings (hand use,
  // strength) multiply in here later.
  const leverage = !!pu && bm <= SHED_REACH && g.x * -pu.x + g.y * -pu.y <= LEVER_COS;
  let state = 'neutral';
  if (pu) {
    if (along <= -WIN_SPEED || leverage) state = 'winning';
    else if (lean >= ANCHOR_MIN) state = 'anchored';
    else if (along >= DRIVEN_SPEED) state = 'driven';
  }
  const hold = anchorHold(ex, ey, d, push);
  return { state, sx, sy, px: d.x, py: d.y, lean, side, dir, ex, ey, hold };
}
