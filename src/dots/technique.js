// Blocking technique table, footwork phase machine and drive/ride push math.
// Pure: no imports, no mutation of arguments.
//
// Row fields:
//   step     first-step angle in degrees from the line of scrimmage toward playside
//            (0 = flat, 90 = upfield), keyed by shade (head/playside/backside/none)
//   stepLen  optional first-step length in yards (default FIRST_STEP_LEN)
//   aim      fraction of the radius the aim point sits playside of the target spot
//   drive    push mode once engaged: 'vertical' or 'watch' (lean toward watched player)
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
export const RIDE_GAIN = 1.0; // unitless, lateral weight of the ride push (tunable)
export const COMBO_MAX_LEAN = 30; // degrees from vertical, max combo drive lean (tunable)

const freezeRow = (r) => Object.freeze({ ...r, step: Object.freeze(r.step), phases: Object.freeze(r.phases) });

export const TECHNIQUES = Object.freeze({
  zone: freezeRow({ stepLen: 0.25, step: { head: 60, playside: 45, backside: 60, none: 60 }, aim: 0.5, drive: 'vertical', next: 'zone', phases: ['step', 'aim'], retarget: 'aim' }),
  combo: freezeRow({ stepLen: 0.25, step: { head: 60, playside: 45, backside: 60, none: 60 }, aim: 0.5, drive: 'watch', next: 'climb', phases: ['step', 'aim'], retarget: 'aim' }),
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

export function driveDir(tech, target, watch) {
  const row = TECHNIQUES[tech];
  if (row && row.drive === 'watch') {
    if (watch == null) return { x: 0, y: 1 };
    const vx = watch.x - target.x;
    const vy = watch.y - target.y;
    const max = rad(COMBO_MAX_LEAN);
    let lean;
    if (vy <= 0) lean = Math.sign(vx) * max;
    else lean = Math.max(-max, Math.min(max, Math.atan2(vx, vy)));
    return { x: Math.sin(lean), y: Math.cos(lean) };
  }
  return { x: 0, y: 1 };
}

export function rideSign(prev, vx) {
  return Math.abs(vx) >= RIDE_MIN ? Math.sign(vx) : prev;
}

export function rideDir(drive, sign) {
  if (sign === 0) return drive;
  const x = drive.x + RIDE_GAIN * sign;
  const y = drive.y;
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
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
    tx: target.x,
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
    tx: target.x,
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

export function footPush(foot, target, watch, dt) {
  const vx = dt > 0 ? (target.x - foot.tx) / dt : 0;
  const ride = rideSign(foot.ride, vx);
  const push = rideDir(driveDir(foot.tech, target, watch), ride);
  return { ride, push };
}
