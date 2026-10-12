// Blocking technique table, footwork phase machine and drive/ride push math.
// Pure: no imports, no mutation of arguments.
//
// Push (footPush): drive = vertical or combo watch lean. On a blindside hit the base
// bends from the drive toward the contact line (BLIND_START..BLIND_FULL degrees). The
// target's lateral velocity (relative to the base) rotates the base by up to RIDE_MAX,
// smoothed by RIDE_TAU, and the push turns toward that at most PUSH_TURN rad/s. Under RIDE_MIN of lateral
// speed the ride holds, unless the target is coming into the drive (along < -RIDE_MIN): then the ride decays
// to 0 and the blocker squares up (.work/maps/climb-spec.md case 3: no lateral push on a downhill LB).
//
// Row fields:
//   step     first-step angle in degrees from the line of scrimmage toward playside
//            (0 = flat, 90 = upfield), keyed by shade (head/playside/backside/none)
//   stepLen  optional first-step length in yards (default FIRST_STEP_LEN): a number, or an
//            object keyed by shade (read through stepLenOf)
//   aim      fraction of the radius the aim point sits playside of the target spot
//   drive    push mode once engaged: 'vertical', 'watch' (lean toward watched player) or
//            'playside' (lean back and toward the play (side) by COMBO_LEAN; every blocker on the
//            man shares the base (no blindside bend); no row uses it since F-55 #4) or 'double'
//            (straight upfield, hips together, with the same shared base as 'playside') or 'wall' (lean toward the backside by
//            WALL_LEAN from straight upfield, to wall the man away from the play)
//   intercept optional; true on the climb row: the 'aim' goal leads the target's velocity to the point
//            where the blocker would meet him (near number on the run's side), aims at the spot with no
//            shift when no meeting point exists, and keeps the aim within CLIMB_LANE_REACH of the ball
//   seal     optional; true on the climb row: once engaged on the target's flow side the blocker holds his seal (footPush
//            never leans the push past the contact line's side while the target travels toward him)
//   next     technique entered after coming off onto a new target
//   phases   pre-contact phases, in order ('step', 'aim', or 'hinge' for the cutoff wall spot)
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
export const SEAL_MIN = 0.05; // lateral share of the contact line below which a blocker is head-up, not sealed (tunable)
export const RIDE_TAU = 0.1; // s, ride angle smoothing time constant (tunable)
export const PUSH_TURN = Math.PI; // rad/s, max push turn rate (tunable)
export const BLIND_START = 30; // degrees, contact-vs-drive angle where the base starts bending (tunable)
export const BLIND_FULL = 75; // degrees, contact-vs-drive angle where the base is the contact line (tunable)
export const COMBO_MAX_LEAN = 30; // degrees from vertical, max combo drive lean (tunable)
export const COMBO_LEAN = 40; // degrees from vertical toward the play, lean of a 'playside' drive; 40 so a held double moves even a DL with no playside goal 1 yd sideways before the anchor spring levels him off (F-3 #3) (tunable)

export const HINGE_GIVE = 0.05; // yd, how far back toward the offense the hinge wall spot sits (tunable)
export const INTERCEPT_MIN_SPEED = 1; // yd/s, floor on the blocker speed used to solve the climb intercept (tunable)
export const CLIMB_LANE_REACH = 5; // yd, generous bound on how far from the ball a climb aim may sit ("within reason": stops only wild intercepts, not a leash) (tunable)
export const WALL_LEAN = 30; // degrees from straight upfield toward the backside, lean of a 'wall' drive (tunable)

const freezeRow = (r) => Object.freeze({
  ...r,
  step: Object.freeze(r.step),
  phases: Object.freeze(r.phases),
  ...(r.stepLen !== null && typeof r.stepLen === 'object' ? { stepLen: Object.freeze(r.stepLen) } : {}),
});

export const TECHNIQUES = Object.freeze({
  // F-55 #4. playside = reach step (bigger, flatter, helmet across to the playside); head = normal short
  // zone step (about 6 in) playside that gains a little ground; backside = nearly a straight drive step;
  // none = short zone step.
  zone: freezeRow({ stepLen: { head: 0.17, playside: 0.4, backside: 0.17, none: 0.17 }, step: { head: 55, playside: 25, backside: 80, none: 55 }, aim: 0.5, drive: 'vertical', next: 'zone', phases: ['step', 'aim'], retarget: 'aim' }),
  // Same as zone for the covered member; none = the uncovered helper's short step playside, shoulders square.
  combo: freezeRow({ stepLen: { head: 0.17, playside: 0.4, backside: 0.17, none: 0.17 }, step: { head: 55, playside: 25, backside: 80, none: 45 }, aim: 0.5, drive: 'double', next: 'climb', phases: ['step', 'aim'], retarget: 'aim' }),
  climb: freezeRow({ step: { head: 60, playside: 60, backside: 60, none: 60 }, aim: 0.5, intercept: true, seal: true, drive: 'vertical', next: 'climb', phases: ['step', 'aim'], retarget: 'aim' }),
  // F-55 #5. Step inside and flat to protect the inside gap, then hinge out to wall the end man off.
  cutoff: freezeRow({ step: { head: 10, playside: 10, backside: 10, none: 10 }, aim: 1.0, drive: 'wall', next: 'cutoff', phases: ['step', 'hinge'], retarget: 'hinge' }),
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const rad = (deg) => (deg * Math.PI) / 180;

export function stepLenOf(tech, shade) {
  if (!has(TECHNIQUES, tech)) return FIRST_STEP_LEN;
  const len = TECHNIQUES[tech].stepLen;
  if (typeof len === 'number') return len;
  if (len != null && typeof len === 'object' && has(len, shade)) return len[shade];
  return FIRST_STEP_LEN;
}

// Name of the technique a blocker uses for a tech/shade pair, or null when unknown.
export function techniqueLabel(tech, shade) {
  if (tech === 'zone' || tech === 'combo') {
    if (shade === 'playside') return 'reach';
    if (shade === 'head') return 'zone step';
    if (shade === 'backside') return 'drive';
    if (shade === 'none') return tech === 'zone' ? 'zone step' : 'square step';
    return null;
  }
  if (tech === 'climb') return 'climb';
  if (tech === 'cutoff') return 'hinge';
  return null;
}

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
      const len = stepLenOf(foot.tech, foot.shade);
      return { x: foot.ox + d.x * len, y: foot.oy + d.y * len };
    },
    done(foot, blocker) {
      const len = stepLenOf(foot.tech, foot.shade);
      return Math.hypot(blocker.x - foot.ox, blocker.y - foot.oy) >= len - 1e-9;
    },
  }),
  // Wall spot: the contact spot shifted aim radii playside and HINGE_GIVE back toward the offense.
  hinge: Object.freeze({
    goal(foot, spot, side, radius) {
      const p = aimPoint(spot, foot.tech, side, radius);
      return { x: p.x, y: p.y - HINGE_GIVE };
    },
    done() {
      return false;
    },
  }),
  // Aim: the contact spot shifted aim radii playside. The aim never sits behind the blocker's own depth
  // (T-61: he does not give ground to close on his man). A non-intercept aim below the blocker's y is
  // clamped to his y, so a blocker re-closing on a man who shed him (or picking up a slanter behind the
  // line) pursues at his own depth. The intercept branch (climb row) is not clamped.
  aim: Object.freeze({
    goal(foot, spot, side, radius, env) {
      const row = TECHNIQUES[foot.tech];
      if (!row.intercept) {
        const a = aimPoint(spot, foot.tech, side, radius);
        const blocker = env?.blocker;
        return blocker && a.y < blocker.y ? { x: a.x, y: blocker.y } : a;
      }
      const blocker = env?.blocker;
      const target = env?.target;
      const v = target ? (target.selfVel ?? target.vel) : null;
      let aim;
      if (blocker && v && Math.hypot(v.x, v.y) > 1e-6) {
        const t = interceptTime(spot, v, blocker, Math.max(blocker.speed ?? 1, INTERCEPT_MIN_SPEED));
        // No meeting point: aim at the spot itself, no playside shift (climb-spec: contact at an achievable angle).
        aim = t == null ? { x: spot.x, y: spot.y } : aimPoint({ x: spot.x + v.x * t, y: spot.y + v.y * t }, foot.tech, side, radius);
      } else {
        aim = aimPoint(spot, foot.tech, side, radius);
      }
      const ball = env?.ballPos;
      if (ball && Math.abs(aim.x - ball.x) > CLIMB_LANE_REACH) {
        aim = { x: ball.x + Math.sign(aim.x - ball.x) * CLIMB_LANE_REACH, y: aim.y };
      }
      return aim;
    },
    done() {
      return false;
    },
  }),
});

// Smallest t > 0 with |spot + v t - blocker| = s t, or null when there is none.
function interceptTime(spot, v, blocker, s) {
  const dx = spot.x - blocker.x;
  const dy = spot.y - blocker.y;
  const a = v.x * v.x + v.y * v.y - s * s;
  const b = 2 * (dx * v.x + dy * v.y);
  const c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-12) return b < 0 ? -c / b : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const q = Math.sqrt(disc);
  const roots = [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter((r) => r > 1e-9).sort((p, r) => p - r);
  return roots.length ? roots[0] : null;
}

// Drive direction for a push mode. 'watch': lean toward the watched player. 'playside': lean back
// and toward the play (side = +1 or -1) by COMBO_LEAN; the watch is ignored. Other modes: straight back.
const SHARED_BASE = new Set(['playside', 'double']); // drive modes whose blockers all push from the same base

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
  if (mode === 'double') return { x: 0, y: 1 }; // F-55 #4: vertical double-team drive, no playside lean
  if (mode === 'wall') {
    const lean = (side === 1 || side === -1 ? -side * rad(WALL_LEAN) : 0);
    return { x: Math.sin(lean), y: Math.cos(lean) };
  }
  return { x: 0, y: 1 };
}

export function driveDir(tech, target, watch, side) {
  const row = TECHNIQUES[tech];
  if (row && (row.drive === 'watch' || row.drive === 'playside' || row.drive === 'double' || row.drive === 'wall')) return leanDir(row.drive, target, watch, side);
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

export function footGoal(foot, blocker, spot, side, radius, env) {
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
  const goal = def.goal(foot, spot, side, radius, { blocker, ...env });
  if (row.squeeze != null) goal.squeeze = row.squeeze;
  return { phase, goal };
}

export function footPush(foot, target, watch, vel, contact, dt, side) {
  const drive = driveDir(foot.tech, target, watch, side);
  const c = contact ?? drive;
  let base;
  if (SHARED_BASE.has(TECHNIQUES[foot.tech]?.drive)) {
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
    else if (along < -RIDE_MIN) target_ride = 0; // target stopped scraping and comes into the drive: square up
    ride = first ? target_ride : foot.ride + (target_ride - foot.ride) * (1 - Math.exp(-dt / RIDE_TAU));
  }
  let desired = rotate(base, ride);
  // A sealed blocker (the target travels toward his side, so the push would lean away from the contact line's side)
  // holds his seal (F-55 #7, the human's "gets his body between the defender and the lane"): the push never
  // leans past the contact line's side, because the follow spot would then carry him round the target's face onto
  // his trail side while the target still moves. He squares up (no lateral push) instead of riding into the target.
  // Sealed is latched (foot.sealed) from the tick the target's lateral travel is toward the blocker's side, until that
  // travel really reverses, so the clamp does not flicker as the target slows under RIDE_MIN (wobble, #11).
  let sealed = foot.sealed === true;
  if (TECHNIQUES[foot.tech]?.seal === true && contact != null && Math.abs(contact.x) >= SEAL_MIN && Math.abs(v.x) >= RIDE_MIN) sealed = v.x * contact.x < 0;
  if (sealed && TECHNIQUES[foot.tech]?.seal === true && contact != null && Math.abs(contact.x) >= SEAL_MIN && desired.x * contact.x < 0) {
    desired = { x: 0, y: Math.sign(desired.y || base.y || 1) };
  }

  // A 'playside' push starts on the shared base (not the contact line), so partners agree from the first tick.
  const from = foot.push ?? (SHARED_BASE.has(TECHNIQUES[foot.tech]?.drive) ? base : c);
  const fl = Math.hypot(from.x, from.y);
  const start = fl > 0 ? { x: from.x / fl, y: from.y / fl } : drive;
  const push = rotateToward(start, desired, dt > 0 ? PUSH_TURN * dt : 0);
  return { ride, push, sealed };
}
