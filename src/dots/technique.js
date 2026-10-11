// Blocking technique table, footwork phase machine and drive/ride push math.
// Pure: no imports, no mutation of arguments.
//
// Push (footPush): drive = vertical or combo watch lean. On a blindside hit the base
// bends from the drive toward the contact line (BLIND_START..BLIND_FULL degrees). The
// target's lateral velocity (relative to the base) rotates the base by up to RIDE_MAX,
// smoothed by RIDE_TAU, and the push turns toward that at most PUSH_TURN rad/s.
//
// Row fields:
//   step     first-step angle in degrees from the line of scrimmage toward playside
//            (0 = flat, 90 = upfield), keyed by shade (head/playside/backside/none)
//   stepLen  optional first-step length in yards (default FIRST_STEP_LEN)
//   aim      fraction of the radius the aim point sits playside of the target spot
//   drive    push mode once engaged: 'vertical', 'watch' (lean toward watched player) or
//            'playside' (lean back and toward the play (side) by COMBO_LEAN; every blocker on the
//            man shares the base (no blindside bend))
//   next     technique entered after coming off onto a new target
//   phases   pre-contact phases, in order
//   retarget phase entered after coming off onto a new target
//
// Extending: add reach/down/kick/pull as new rows; a new drive mode is a new branch
// in driveDir; a new phase is a PHASES entry plus its name in a row's phases; an
// optional row field `squeeze` is copied onto footGoal's goal for steerStep
// (goal.squeeze ?? SQUEEZE, not read by steerStep yet).

export const FIRST_STEP_LEN = 0.5; // yards, length of the first step (tunable)
export const RIDE_MIN = 0.3; // yd/s, target lateral speed needed to set ride side (tunable)
export const RIDE_MAX = 70; // degrees, max ride rotation off the base (tunable)
export const RIDE_FULL = 3; // yd/s, lateral speed giving the full RIDE_MAX (tunable)
export const RIDE_TAU = 0.1; // s, ride angle smoothing time constant (tunable)
export const PUSH_TURN = Math.PI; // rad/s, max push turn rate (tunable)
export const BLIND_START = 30; // degrees, contact-vs-drive angle where the base starts bending (tunable)
export const BLIND_FULL = 75; // degrees, contact-vs-drive angle where the base is the contact line (tunable)
export const COMBO_MAX_LEAN = 30; // degrees from vertical, max combo drive lean (tunable)
export const COMBO_LEAN = 30; // degrees from vertical, lean of a 'playside' drive toward the play (tunable)

const freezeRow = (r) => Object.freeze({ ...r, step: Object.freeze(r.step), phases: Object.freeze(r.phases) });

export const TECHNIQUES = Object.freeze({
  zone: freezeRow({ stepLen: 0.25, step: { head: 60, playside: 45, backside: 60, none: 60 }, aim: 0.5, drive: 'vertical', next: 'zone', phases: ['step', 'aim'], retarget: 'aim' }),
  combo: freezeRow({ stepLen: 0.25, step: { head: 60, playside: 45, backside: 60, none: 60 }, aim: 0.5, drive: 'playside', next: 'climb', phases: ['step', 'aim'], retarget: 'aim' }),
  climb: freezeRow({ step: { head: 60, playside: 60, backside: 60, none: 60 }, aim: 0.5, drive: 'vertical', next: 'climb', phases: ['step', 'aim'], retarget: 'aim' }),
  cutoff: freezeRow({ step: { head: 10, playside: 10, backside: 10, none: 10 }, aim: 1.0, drive: 'vertical', next: 'cutoff', phases: ['step', 'aim'], retarget: 'aim' }),
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const rad = (deg) => (deg * Math.PI) / 180;

export function stepDir(tech, shade, side) {
  if (!has(TECHNIQUES, tech)) return null;
  const steps = TECHNIQUES[tech].step;
  if (!has(steps, shade)) return null;
  const a = rad(steps[shade]);
  return { x: side * Math.cos(a), y: Math.sin(a) };
}

export function aimPoint(spot, tech, side, radius) {
  return { x: spot.x + side * TECHNIQUES[tech].aim * radius, y: spot.y };
}

export const PHASES = Object.freeze({
  step: Object.freeze({
    goal(foot, spot, side, radius) {
      const d = stepDir(foot.tech, foot.shade, side) ?? { x: 0, y: 1 };
      const len = TECHNIQUES[foot.tech].stepLen ?? FIRST_STEP_LEN;
      return { x: foot.ox + d.x * len, y: foot.oy + d.y * len };
    },
    done(foot, blocker) {
      const len = TECHNIQUES[foot.tech].stepLen ?? FIRST_STEP_LEN;
      return Math.hypot(blocker.x - foot.ox, blocker.y - foot.oy) >= len - 1e-9;
    },
  }),
  aim: Object.freeze({
    goal(foot, spot, side, radius) {
      return aimPoint(spot, foot.tech, side, radius);
    },
    done() {
      return false;
    },
  }),
});

// Drive direction for a push mode. 'watch': lean toward the watched player. 'playside': lean back
// and toward the play (side = +1 or -1) by COMBO_LEAN; the watch is ignored. Other modes: straight back.
export function leanDir(mode, target, watch, side) {
  if (mode === 'watch') {
    if (watch == null) return { x: 0, y: 1 };
    const vx = watch.x - target.x;
    const vy = watch.y - target.y;
    const max = rad(COMBO_MAX_LEAN);
    let lean;
    if (vy <= 0) lean = Math.sign(vx) * max;
    else lean = Math.max(-max, Math.min(max, Math.atan2(vx, vy)));
    return { x: Math.sin(lean), y: Math.cos(lean) };
  }
  if (mode === 'playside') {
    const lean = (side === 1 || side === -1 ? side * rad(COMBO_LEAN) : 0);
    return { x: Math.sin(lean), y: Math.cos(lean) };
  }
  return { x: 0, y: 1 };
}

export function driveDir(tech, target, watch, side) {
  const row = TECHNIQUES[tech];
  if (row && (row.drive === 'watch' || row.drive === 'playside')) return leanDir(row.drive, target, watch, side);
  return { x: 0, y: 1 };
}

export function rotate(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// Signed angle from a to b in radians, positive counter-clockwise.
export function signedAngle(a, b) {
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

// Rotate unit vector `from` toward `to` by at most maxAngle; never overshoots.
export function rotateToward(from, to, maxAngle) {
  const ang = signedAngle(from, to);
  const len = Math.hypot(to.x, to.y);
  if (Math.abs(ang) <= maxAngle) return len > 0 ? { x: to.x / len, y: to.y / len } : from;
  const r = rotate(from, Math.sign(ang) * maxAngle);
  const rl = Math.hypot(r.x, r.y);
  return { x: r.x / rl, y: r.y / rl };
}

export function nextTech(tech) {
  return (has(TECHNIQUES, tech) ? TECHNIQUES[tech].next : null) ?? null;
}

export function startFoot(tech, shade, watch, blocker, target) {
  if (!has(TECHNIQUES, tech)) return null;
  const row = TECHNIQUES[tech];
  return {
    tech,
    shade: shade ?? 'none',
    watch: watch ?? null,
    phase: row.phases[0],
    ox: blocker.x,
    oy: blocker.y,
    ride: 0,
    push: null,
  };
}

export function retargetFoot(foot, blocker, target) {
  const tech = nextTech(foot.tech);
  if (tech == null) return null;
  return {
    tech,
    shade: 'none',
    watch: null,
    phase: TECHNIQUES[tech].retarget,
    ox: blocker.x,
    oy: blocker.y,
    ride: 0,
    push: null,
  };
}

export function footGoal(foot, blocker, spot, side, radius) {
  const row = TECHNIQUES[foot.tech];
  const names = row.phases;
  let phase = foot.phase;
  const get = (p) => {
    if (!has(PHASES, p)) throw new Error(`unknown phase: ${p}`);
    return PHASES[p];
  };
  let def = get(phase);
  while (def.done(foot, blocker)) {
    const i = names.indexOf(phase);
    if (i < 0 || i >= names.length - 1) break;
    phase = names[i + 1];
    def = get(phase);
  }
  const goal = def.goal(foot, spot, side, radius);
  if (row.squeeze != null) goal.squeeze = row.squeeze;
  return { phase, goal };
}

export function footPush(foot, target, watch, vel, contact, dt, side) {
  const drive = driveDir(foot.tech, target, watch, side);
  const c = contact ?? drive;
  let base;
  if (TECHNIQUES[foot.tech]?.drive === 'playside') {
    // Shared base: every blocker on the man pushes from the drive, not from his own contact line.
    base = drive;
  } else {
    const theta = Math.abs(signedAngle(drive, c));
    const w = Math.max(0, Math.min(1, (theta - rad(BLIND_START)) / (rad(BLIND_FULL) - rad(BLIND_START))));
    let bx = (1 - w) * drive.x + w * c.x;
    let by = (1 - w) * drive.y + w * c.y;
    let bl = Math.hypot(bx, by);
    if (bl < 1e-9) {
      const cl = Math.hypot(c.x, c.y);
      base = { x: c.x / cl, y: c.y / cl };
    } else base = { x: bx / bl, y: by / bl };
  }

  const v = vel ?? { x: 0, y: 0 };
  const along = v.x * base.x + v.y * base.y;
  const lat = { x: v.x - along * base.x, y: v.y - along * base.y };
  const sp = Math.hypot(lat.x, lat.y);
  const first = foot.push == null;
  let ride = foot.ride;
  if (dt > 0) {
    let target_ride = foot.ride;
    if (sp >= RIDE_MIN) target_ride = Math.sign(signedAngle(base, lat)) * rad(RIDE_MAX) * Math.min(1, sp / RIDE_FULL);
    ride = first ? target_ride : foot.ride + (target_ride - foot.ride) * (1 - Math.exp(-dt / RIDE_TAU));
  }
  const desired = rotate(base, ride);
  // A 'playside' push starts on the shared base (not the contact line), so partners agree from the first tick.
  const from = foot.push ?? (TECHNIQUES[foot.tech]?.drive === 'playside' ? base : c);
  const fl = Math.hypot(from.x, from.y);
  const start = fl > 0 ? { x: from.x / fl, y: from.y / fl } : drive;
  const push = rotateToward(start, desired, dt > 0 ? PUSH_TURN * dt : 0);
  return { ride, push };
}
