// Blocking technique table, footwork phase machine and drive/ride push math.
// Pure: imports only the pure geometry helpers, no mutation of arguments.
//
// Push (footPush): drive = vertical, double or wall. On a blindside hit the base
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
//   drive    push mode once engaged: 'vertical' (straight upfield), 'double' (straight upfield, hips
//            together: every blocker on the man shares the base, no blindside bend) or 'wall' (lean toward
//            the backside by WALL_LEAN from straight upfield, to wall the man away from the play)
//   intercept optional; true on the climb row: the 'aim' goal leads the target's velocity to the point
//            where the blocker would meet him (near number on the run's side), aims at the spot with no
//            shift when no meeting point exists, and keeps the aim within CLIMB_LANE_REACH of the ball
//   seal     optional; true on the climb row: once engaged on the target's flow side the blocker holds his seal (footPush
//            never leans the push past the seal side while the target travels toward him; the seal side is latched with
//            the seal, so a target sliding to head-up in front of him does not release the clamp)
//   next     technique entered after coming off onto a new target
//   phases   pre-contact phases, in order ('step', 'aim', or 'hinge' for the cutoff wall spot)
//   retarget phase entered after coming off onto a new target
//   pace     optional pace name (a key of steering.js PACES) for the blocker's approach while he is
//            not engaged (a committed sprint); rows without it keep the default cruise ramp
//
// Extending: add reach/down/kick/pull as new rows; a new drive mode is a new branch
// in driveDir; a new phase is a PHASES entry plus its name in a row's phases.

import { leadPoint } from './geometry.js';

export const FIRST_STEP_LEN = 0.5; // yards, length of the first step (tunable)
export const RIDE_MIN = 0.3; // yd/s, target lateral speed needed to set ride side (tunable)
export const RIDE_MAX = 70; // degrees, max ride rotation off the base (tunable)
export const RIDE_FULL = 3; // yd/s, lateral speed giving the full RIDE_MAX (tunable)
export const SEAL_MIN = 0.05; // lateral share of the contact line below which a blocker is head-up, not sealed (tunable)
export const RIDE_TAU = 0.1; // s, ride angle smoothing time constant (tunable)
export const PUSH_TURN = Math.PI; // rad/s, max push turn rate (tunable)
export const BLIND_START = 30; // degrees, contact-vs-drive angle where the base starts bending (tunable)
export const BLIND_FULL = 75; // degrees, contact-vs-drive angle where the base is the contact line (tunable)

export const HINGE_GIVE = 0.05; // yd, how far back toward the offense the hinge wall spot sits (tunable)
export const BLOCK_LEAD_MAX = 0.3; // s, the longest a blocker leads his man's motion when closing on him (tunable)
export const INTERCEPT_MIN_SPEED = 1; // yd/s, floor on the blocker speed used to solve the climb intercept (tunable)
export const CLIMB_LANE_REACH = 5; // yd, generous bound on how far from the ball a climb aim may sit ("within reason": stops only wild intercepts, not a leash) (tunable)
export const WALL_LEAN = 30; // degrees from straight upfield toward the backside, lean of a 'wall' drive (tunable)
export const PULL_DROP = 1.0; // yd, how far behind his start depth a puller crosses (behind the OL backs) (tunable)
export const PULL_TOL = 0.5; // yd, how close to his man's x a puller must be to count as level with him (tunable)
export const PULL_TURN = 1.5; // yd, how far short of his man's x a puller starts rising from the crossing depth toward the man's depth (tunable)
export const KICK_LEAN = 30; // degrees from straight upfield toward the pull side, lean of a 'kick' drive (tunable)

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
  // F-76. Pull: cross behind the line to the man's inside, then kick him out away from the ball.
  pull: freezeRow({ step: { head: 0, playside: 0, backside: 0, none: 0 }, aim: 0.5, inside: true, drive: 'kick', pace: 'burst', next: 'zone', phases: ['pull', 'aim'], retarget: 'aim' }),
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
export function techniqueLabel(tech, shade, phase) {
  if (tech === 'pull') return phase === 'pull' ? 'pull' : 'kick out';
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

// The blocker-side use of the shared anticipation helper: the contact spot led by the man's velocity, up to
// BLOCK_LEAD_MAX. blocking.js uses it for blocks without a technique row (T-88).
export function leadSpot(blocker, spot, target) {
  const v = target ? (target.selfVel ?? target.vel) : null;
  if (!blocker || !v || Math.hypot(v.x, v.y) <= 1e-6) return spot;
  const L = leadPoint(blocker, Math.max(blocker.speed ?? 1, INTERCEPT_MIN_SPEED), spot, v, { maxLead: BLOCK_LEAD_MAX });
  return L.met ? { x: L.x, y: L.y } : { x: spot.x, y: spot.y };
}

function pullX(foot, spot, radius, env) {
  const mx = env?.target?.x ?? spot?.x ?? foot.ox;
  const inward = env?.ballPos && env.ballPos.x !== mx ? Math.sign(env.ballPos.x - mx) : -foot.pull;
  return mx + inward * radius;
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
  // Pull: a point behind the line (PULL_DROP behind his start) level with his man's x, shifted a body radius toward
  // the ball so he arrives on the man's inside. Done once level with that x or past it, toward the pull side.
  pull: Object.freeze({
    goal(foot, spot, side, radius, env) {
      const x = pullX(foot, spot, radius, env);
      const base = foot.oy - PULL_DROP;
      const b = env?.blocker;
      const m = env?.target ?? spot;
      if (!b || !m) return { x, y: base };
      // Last PULL_TURN yd of the crossing: the path rises toward the man's depth, so he turns upfield on an arc.
      const t = Math.max(0, Math.min(1, 1 - ((x - b.x) * foot.pull) / PULL_TURN));
      return { x, y: base + t * Math.max(0, m.y - base) };
    },
    done(foot, blocker, env) {
      return (blocker.x - pullX(foot, env?.spot, env?.radius ?? 0, env)) * foot.pull >= -PULL_TOL;
    },
  }),
  // Wall spot: the contact spot shifted aim radii playside and HINGE_GIVE back toward the offense.
  hinge: Object.freeze({
    goal(foot, spot, side, radius, env) {
      const p = aimPoint(leadSpot(env?.blocker, spot, env?.target), foot.tech, side, radius);
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
      if (row.inside === true && foot.pull) side = -foot.pull; // inside half of the man: toward the ball
      if (!row.intercept) {
        const a = aimPoint(leadSpot(env?.blocker, spot, env?.target), foot.tech, side, radius);
        const blocker = env?.blocker;
        return blocker && a.y < blocker.y ? { x: a.x, y: blocker.y } : a;
      }
      const blocker = env?.blocker;
      const target = env?.target;
      const v = target ? (target.selfVel ?? target.vel) : null;
      let aim;
      if (blocker && v && Math.hypot(v.x, v.y) > 1e-6) {
        const lead = leadPoint(blocker, Math.max(blocker.speed ?? 1, INTERCEPT_MIN_SPEED), spot, v);
        // No meeting point: aim at the spot itself, no playside shift (climb-spec: contact at an achievable angle).
        aim = !lead.met ? { x: spot.x, y: spot.y } : aimPoint({ x: lead.x, y: lead.y }, foot.tech, side, radius);
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

// Drive direction for a push mode: 'double' is straight upfield (F-55 #4, vertical double-team drive), 'wall'
// leans toward the backside by WALL_LEAN. Other modes: straight upfield.
const SHARED_BASE = new Set(['double']); // a shared-base ('double') push: every blocker on the man pushes from the same base

export function leanDir(mode, side, pull) {
  if (mode === 'kick') {
    const lean = pull === 1 || pull === -1 ? pull * rad(KICK_LEAN) : 0;
    return { x: Math.sin(lean), y: Math.cos(lean) };
  }
  if (mode === 'double') return { x: 0, y: 1 };
  if (mode === 'wall') {
    const lean = (side === 1 || side === -1 ? -side * rad(WALL_LEAN) : 0);
    return { x: Math.sin(lean), y: Math.cos(lean) };
  }
  return { x: 0, y: 1 };
}

export function driveDir(tech, side, pull) {
  const row = TECHNIQUES[tech];
  if (row && row.drive === 'kick') return leanDir('kick', side, pull);
  if (row && (row.drive === 'double' || row.drive === 'wall')) return leanDir(row.drive, side);
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

export function startFoot(tech, shade, watch, blocker, pull) {
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
    ...(pull === 1 || pull === -1 ? { pull } : {}),
  };
}

export function retargetFoot(foot, blocker) {
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
  while (def.done(foot, blocker, { spot, side, radius, ...env })) {
    const i = names.indexOf(phase);
    if (i < 0 || i >= names.length - 1) break;
    phase = names[i + 1];
    def = get(phase);
  }
  const goal = def.goal(foot, spot, side, radius, { blocker, ...env });
  return { phase, goal };
}

export function footPush(foot, vel, contact, dt, side) {
  const drive = driveDir(foot.tech, side, foot.pull);
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
  // The seal side (sealSide, the sign of the contact line's x when the seal was judged) is latched with the seal, so the
  // clamp does not release when the target slides to head-up (|contact.x| under SEAL_MIN) while the seal holds (F-57 #11a).
  let sealed = foot.sealed === true;
  let sealSide = foot.sealSide ?? 0;
  if (TECHNIQUES[foot.tech]?.seal === true && contact != null && Math.abs(contact.x) >= SEAL_MIN && Math.abs(v.x) >= RIDE_MIN) {
    sealed = v.x * contact.x < 0;
    sealSide = sealed ? Math.sign(contact.x) : 0;
  } else if (sealed && foot.sealSide == null && contact != null && Math.abs(contact.x) >= SEAL_MIN) {
    sealSide = Math.sign(contact.x);
  }
  if (sealed && TECHNIQUES[foot.tech]?.seal === true && sealSide !== 0 && desired.x * sealSide < 0) {
    desired = { x: 0, y: Math.sign(desired.y || base.y || 1) };
  }

  // A shared-base ('double') push starts on the shared base (not the contact line), so partners agree from the first tick.
  const from = foot.push ?? (SHARED_BASE.has(TECHNIQUES[foot.tech]?.drive) ? base : c);
  const fl = Math.hypot(from.x, from.y);
  const start = fl > 0 ? { x: from.x / fl, y: from.y / fl } : drive;
  const push = rotateToward(start, desired, dt > 0 ? PUSH_TURN * dt : 0);
  return { ride, push, sealed, sealSide };
}
