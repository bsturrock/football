// Shared body and ball geometry used by both decision modules (zone, defense) and movement/contact modules (blocking, steering), so decisions never import a movement module (PRINCIPLES #9).
// Pure: imports nothing.

// 0.56 yd = 20 in wide, the top of the 16-20 in shoulder range; area about 2.2 sq ft, between
// the 1.5 sq ft crush minimum and the 2.5-3 sq ft comfortable footprint.
export const BODY_RADIUS = 0.28;
// Tunable: yards the ball must be upfield of the target for the blocker to let go.
export const RELEASE_PAST = 4 * BODY_RADIUS;

// The ball is well upfield of him: a blocker lets go of him and may not engage him, and a climber stops chasing him (zone.js).
export function ballPast(T, ballPos) {
  return ballPos.y >= T.y + RELEASE_PAST;
}

// The single place any module asks "where will he be" (project) or "where can I meet him" (leadPoint).
// Where `spot` ends up after t seconds at velocity `vel` (a missing vel is standing still).
export function project(spot, vel, t) {
  const vx = vel?.x ?? 0;
  const vy = vel?.y ?? 0;
  return { x: spot.x + vx * t, y: spot.y + vy * t };
}

// The single place any module asks "where will he be" / "where can I meet him".
// Earliest point a mover at `from` with `speed` can meet a target seen `age` seconds ago at `spot` moving at `vel`.
// Returns { x, y, t, met }: t is the time to the point (capped at maxLead); met is false when he cannot be caught
// (then the point is where he is at maxLead when finite, else where he is now).
export function leadPoint(from, speed, spot, vel, { age = 0, maxLead = Infinity } = {}) {
  const s0 = project(spot, vel, age);
  const vx = vel?.x ?? 0;
  const vy = vel?.y ?? 0;
  const rx = s0.x - from.x;
  const ry = s0.y - from.y;
  const a = vx * vx + vy * vy - speed * speed;
  const b = 2 * (rx * vx + ry * vy);
  const c = rx * rx + ry * ry;
  let root = null;
  if (Math.abs(a) < 1e-12) {
    if (b === 0) root = c === 0 ? 0 : null;
    else if (-c / b >= 0) root = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const q = Math.sqrt(disc);
      const hit = [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter((r) => r >= 0).sort((p, r) => p - r);
      if (hit.length) root = hit[0];
    }
  }
  const met = root !== null;
  const t = met ? Math.min(root, maxLead) : Number.isFinite(maxLead) ? maxLead : 0;
  return { ...project(s0, vel, t), t, met };
}
