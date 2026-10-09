// Engaged-defender reaction: balance state and force direction.
// Pure: no imports, no mutation of arguments; every function returns new objects.
// Covers engaged defenders only.
//
// Extending (not implemented here):
//   - later ratings come from a per-row `defender.def?.react` object read here
//   - a gap fit goes in anchorSide (replaces ball.x)
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

export function startReact(d) {
  return { state: 'neutral', sx: d.x, sy: d.y, px: d.x, py: d.y, lean: 0, side: 0, dir: null };
}

export function anchorSide(prevSide, d, ball) {
  // Single hook where a later gap fit replaces ball.x.
  const dx = ball.x - d.x;
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

export function stepReact(react, d, push, ball, dt) {
  const r = react ?? startReact(d);
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
  const side = anchorSide(r.side, d, ball);
  const bx = ball.x - d.x;
  const by = ball.y - d.y;
  const bm = Math.hypot(bx, by);
  const g = bm < 1e-9 ? { x: 0, y: 0 } : { x: bx / bm, y: by / bm };
  const a = anchorDir(side, pu);
  const x = (1 - lean) * g.x + lean * a.x;
  const y = (1 - lean) * g.y + lean * a.y;
  const m = Math.hypot(x, y);
  const dir = m < 1e-9 ? null : { x: x / m, y: y / m };
  let state = 'neutral';
  if (pu) {
    if (along <= -WIN_SPEED) state = 'winning';
    else if (lean >= ANCHOR_MIN) state = 'anchored';
    else if (along >= DRIVEN_SPEED) state = 'driven';
  }
  return { state, sx, sy, px: d.x, py: d.y, lean, side, dir };
}
