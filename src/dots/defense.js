// Defender decisions as data: a behaviour is a small state machine whose states
// name a GOAL (where to run) and whose exits name TRIGGERS (when to change state).
// Pure: reads players, never moves them; blocking.js steers toward the goals.
// A one-gap defensive lineman reads his blocker through env.cues (see BEHAVIORS.attack and DL_RESPONSES).
// The backside edge keeps contain: he reads run, squeezes to a point outside the backside end
// lineman, and pursues only when the ball gets outside him, crosses the los, or the RB commits away.
// A blitz or drop is a new GOALS entry plus a state row; linebackers do not blitz today.
// A linebacker read-steps (a short step, never deeper than his alignment) and reads his call's key
// through env.cues (keyRead: a guard, or the back's triangle with hat and flow). After def.read he
// plays his flow class: slow run fits his gap downhill, fast flow or a pulling guard scrapes over the
// top of the ball, split flow uses the side rule; only a pass read drops into zone (or picks up his man).
// A one-gap DL gets off into his blocker's gap-side shoulder (not the gap centre), then reads the hat
// through the DL_RESPONSES table (base: hold, reach: outside arm free, double: anchor, down: close,
// pass: rush; nothing felt: squeeze). A two-gap DL plays his blocker head-up (control) until the ball
// commits, then takes the ball's side (twoGapFit). Cues come from env.cues (perceive.js).
import { BODY_RADIUS } from './blocking.js';
import { leadPoint, project } from './geometry.js';
import { GAP_NAMES, HEAD_UP, liveGaps } from './front.js';
import { DL_ROLES, LB_ROLES, MOVE_COUNTER, moveOdds } from './roster.js';

export const LB_READ_TIME = 0.45; // s, fallback when a player has no def.read
export const KEY_MOVE = BODY_RADIUS; // yd a line player must move to count as an OL-movement key
export const READ_STEP = 0.5; // yd: the LB read step, sideways with flow (tunable)
export const READ_STEP_DOWN = 0.25; // yd: the read step is a half step uphill, never back (tunable)
export const READ_SPEED = 0.5; // fraction of speed during the read step (tunable)
export const OVER_TOP = 1.0; // yd: a scraping LB stays this far behind the ball's flow, over the top (tunable)
export const ZONE_DEPTH = 10; // yd past the los: the zone drop landmark depth (tunable)
export const DROP_SPEED = 0.6; // fraction of speed while dropping, a backpedal (tunable)
export const PEDAL_DEPTH = 1.5; // yd: a DB's pedal at the snap, deeper than his alignment (tunable)
export const FILL_DEPTH = 3.5; // yd past the los where he fills: football depth (3-5 yd), not body geometry (tunable)
export const PENETRATE_DEPTH = 4 * BODY_RADIUS; // yd behind the los the DL aims for
export const GETOFF_DEPTH = 1.0; // yd past the los toward the offense: the get-off aim (tunable)
export const GETOFF_TIME = 0.3; // s: the get-off lasts this long before a DL with nothing felt squeezes (tunable)
export const ARM_FREE = 2 * BODY_RADIUS; // yd: the reach/two-gap fit sets his outside arm this far off the blocker's x
export const RUSH_DEPTH = 5; // yd toward the offense: a pass-set rush aims this deep (tunable)
export const PURSUE_REACH = 8 * BODY_RADIUS; // yd: a DL this close to the carried ball pursues

export const CONTAIN_DEPTH = 1.0; // yd behind the los: the backside edge's contain depth, about the tackle's heel line (tunable)
export const CONTAIN_WIDTH = 2 * BODY_RADIUS; // yd outside the backside end lineman: one contact distance (tunable)
export const CONTAIN_SPEED = 0.5; // fraction of speed while reading and squeezing: a controlled squeeze (tunable)

export const LEAD_MAX = 1.5; // s, the longest lead a pursuer takes: chasers lead further so they run to where the carrier is going (tunable)
export const HEADON_COS_HI = Math.cos(Math.PI / 6); // cos of the angle (about 30 deg) at or inside which a pursuer is fully head-on: full cut-off (tunable)
export const HEADON_COS_LO = 0.5; // cos of the angle (60 deg) at or outside which a pursuer is not head-on: pure chase (tunable)
export const CLOSE_STEP = 1.5; // yd: the cut-off point sits up to this much closer to the carrier than the defender is along his path (tunable)
export const CUTOFF_MIN_V = 1.0; // yd/s: below this carrier speed the path direction is straight downfield (tunable)

// soft head-on weight: 0 at or below HEADON_COS_LO, 1 at or above HEADON_COS_HI, smooth between. S is the carrier's projected spot, V his velocity.
export function headOnWeight(d, S, V) {
  const rx = d.x - S.x, ry = d.y - S.y, dist = Math.hypot(rx, ry);
  const sp = Math.hypot(V.x, V.y);
  const ux = sp >= CUTOFF_MIN_V ? V.x / sp : 0, uy = sp >= CUTOFF_MIN_V ? V.y / sp : 1;
  const cosA = dist > 0 ? (rx * ux + ry * uy) / dist : 1;
  const t = Math.min(1, Math.max(0, (cosA - HEADON_COS_LO) / (HEADON_COS_HI - HEADON_COS_LO)));
  return t * t * (3 - 2 * t);
}
export const REACH_LEAD = 2; // x his time to the ball's spot: the lead cap (tunable); it was effectively 1 (T-135), which made a close pursuer aim at the carrier's heels
export const LEVER_V = 1.0; // yd/s: the ball must move sideways at least this fast before pursuers take the inside-out lever (tunable)
export const PURSUE_LEVER = 0.5; // yd: an inside pursuer aims this far inside the intercept point (tunable)

// Pursuit (GOALS.pursue) aims at this point, then the inside-out lever shifts it: a pursuer inside of a
// sideways-moving ball aims up to PURSUE_LEVER inside it (fading to zero as he reaches the ball's x), so he arrives from the inside, never from behind.
// Where a pursuer at d running at `speed` meets a ball at `ball` moving at v: the earliest
// non-negative meeting time of the seen spot projected by `age`, capped at LEAD_MAX (also used when no meeting exists)
// and at reachLead times his time to that spot, so a close pursuer's lead shrinks with his distance.
export function intercept(d, ball, v, speed, age = 0, reachLead = REACH_LEAD) {
  const s0 = project(ball, v, age);
  const reach = speed > 0 ? Math.hypot(s0.x - d.x, s0.y - d.y) / speed : Infinity;
  const p = leadPoint(d, speed, s0, v, { maxLead: Math.min(LEAD_MAX, reachLead * reach) });
  return { x: p.x, y: p.y };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The live span of the fit's gap, or null when there is no center to walk from.
export function gapSpan(players, defense, fit) {
  const i = GAP_NAMES.indexOf(fit.name);
  const g = liveGaps(players, defense.lineIds, defense.side, fit.side === 'play' ? 1 : -1, i + 1)[i];
  return g ? { lo: g.lo, hi: g.hi } : null;
}

// The LB key read: 'run' | 'pull' | 'pass' | null. keyName is the call's key ('guard' default | 'triangle');
// cues is the LB's cue object (key, hat, flow).
export function keyRead(keyName, cues) {
  const action = cues?.key?.action;
  if (action === 'pull') return 'pull';
  if (keyName === 'triangle') {
    if (cues?.hat === 'high' && action !== 'run') return 'pass';
    if ((action === 'run' || cues?.hat === 'low') && cues?.flow && cues.flow.kind !== 'none') return 'run';
    return null;
  }
  return action === 'run' || action === 'pass' ? action : null;
}

const aimX = (env) => (env.run ? env.run.aim.x : env.ballPos.x);

// The run aim x clamped into the fit gap's live span (shrunk by a body each side); null with no span.
function laneX(env, fit) {
  const span = gapSpan(env.players, env.defense, fit);
  if (!span) return null;
  const lo = span.lo + BODY_RADIUS;
  const hi = span.hi - BODY_RADIUS;
  return lo <= hi ? clamp(aimX(env), lo, hi) : (span.lo + span.hi) / 2;
}

// The x of the edge's contain point: just outside the backside end lineman (live, else snap spot, else his own alignment).
function containX(e, env) {
  const last = env.defense.lineIds[env.defense.lineIds.length - 1];
  const p = last && env.players.find((q) => q.id === last.id);
  const endX = p ? p.x : (last && env.defense.line[last.id]?.x) ?? e.x0;
  return endX - env.defense.side * CONTAIN_WIDTH;
}

// The offensive blocker a DL plays (stored on the agent at the first cue), as a live player; null without one.
const blockerOf = (e, env) => (e.blocker != null ? env.players.find((p) => p.id === e.blocker) ?? null : null);

// Which side of his blocker the DL's gap is: -1 | 0 | 1.
function gapSide(d, e, env, b) {
  const span = e.fit ? gapSpan(env.players, env.defense, e.fit) : null;
  if (span) return Math.sign((span.lo + span.hi) / 2 - b.x);
  return Math.sign(e.x0 - b.x);
}

// The offensive player engaged on d (a contact fact, like the `shed` trigger); prefers `prefer` (an id) when he is one.
function engagerOf(d, env, prefer) {
  const all = env.players.filter((p) => p.block?.target === d.id && p.block.engaged);
  return all.find((p) => p.id === prefer) ?? all[0] ?? null;
}

// The move any blocked defender (engaged by exactly one blocker) tries on the man engaged on him: the best-odds one,
// or null (not blocked, a double team, or no odds). Reading the blocker's counter rating is scouting knowledge, not a movement read.
export function moveFor(d, e, env) {
  const engaged = env.players.filter((p) => p.block?.target === d.id && p.block.engaged);
  if (engaged.length !== 1 || env.cues(d.id)?.felt === 'double') return null;
  const b = engaged[0];
  let kind = null;
  let best = 0;
  for (const k of Object.keys(MOVE_COUNTER)) {
    const o = moveOdds(d[k], b[MOVE_COUNTER[k]]);
    if (o > best) { best = o; kind = k; }
  }
  if (!kind) return null;
  return { kind, side: kind === 'swim' ? (gapSide(d, e, env, b) || env.defense.side) : 0 };
}

// A goal built from the blocker, or today's gapFit goal when he has none.
const viaBlocker = (make) => (d, e, env) => {
  const b = blockerOf(e, env);
  return b ? make(d, e, env, b) : GOALS.gapFit(d, e, env);
};

export const KEYS = Object.freeze({
  olMove: (env) => env.defense.lineIds.some(({ id }) => {
    const p = env.players.find((q) => q.id === id);
    const s = env.defense.line[id];
    return !!p && !!s && Math.hypot(p.x - s.x, p.y - s.y) >= KEY_MOVE;
  }),
  mesh: (env) => !!env.run?.carried,
  // A line player moving forward or sideways from his snap spot, or engaged: the OL is run blocking.
  runBlock: (env) => env.defense.lineIds.some(({ id }) => {
    const p = env.players.find((q) => q.id === id);
    const s = env.defense.line[id];
    if (!p) return false;
    if (p.block?.engaged) return true;
    return !!s && p.y - s.y >= 0 && Math.hypot(p.x - s.x, p.y - s.y) >= KEY_MOVE;
  }),
  backfield: (env) => {
    const rb = env.players.find((p) => p.id === env.defense.carrierId);
    const r0 = env.defense.rb0;
    return !!rb && !!r0 && Math.hypot(rb.x - r0.x, rb.y - r0.y) >= KEY_MOVE;
  },
});

export const GOALS = Object.freeze({
  drop: (d, e, env) => ({ x: e.x0, y: env.los + (e.assign?.depth ?? ZONE_DEPTH) }),
  // LB read goals (cues only). The read step: a short step with flow, a half step uphill, never deeper than y0.
  readStep: (d, e, env) => {
    const f = env.cues(d.id)?.flow;
    const x = f && f.kind !== 'none' ? e.x0 + clamp((f.dir ?? 0) * READ_STEP, -READ_STEP, READ_STEP) : e.x0;
    return { x, y: e.y0 - READ_STEP_DOWN };
  },
  // The ball cue x clamped into his gap span (shrunk a body each side), at fill depth.
  fitGap: (d, e, env) => {
    const span = e.fit ? gapSpan(env.players, env.defense, e.fit) : null;
    const y = env.los + FILL_DEPTH;
    if (!span) return { x: e.x0, y };
    const bx = env.cues(d.id)?.ball?.x ?? e.x0;
    const lo = span.lo + BODY_RADIUS;
    const hi = span.hi - BODY_RADIUS;
    return { x: lo <= hi ? clamp(bx, lo, hi) : (span.lo + span.hi) / 2, y };
  },
  // Over the top: one step behind the ball's flow, no deeper than he stands.
  scrapeGoal: (d, e, env) => {
    const c = env.cues(d.id);
    const bx = c?.ball?.x ?? e.x0;
    let s = keyRead(e.assign?.key, c) === 'pull' ? (c.key.dir ?? 0) : (c?.flow?.dir ?? 0);
    if (!s) s = Math.sign(bx - e.x0);
    return { x: bx - s * OVER_TOP, y: Math.max(env.los + FILL_DEPTH, Math.min(d.y, e.y0)) };
  },
  // Split flow: the play-side fit scrapes, the backside fit fits his gap.
  split: (d, e, env) => (e.fit?.side === 'play' ? GOALS.scrapeGoal(d, e, env) : GOALS.fitGap(d, e, env)),
  // Man coverage: the offensive player of role assign.man nearest his alignment at the snap, never shallower than los + 1.
  man: (d, e, env) => {
    if (e.manId == null) {
      const c = env.players.filter((p) => p.team === 'offense' && p.role === e.assign?.man);
      c.sort((a, b) => Math.hypot(a.x - e.x0, a.y - e.y0) - Math.hypot(b.x - e.x0, b.y - e.y0));
      if (c.length) e.manId = c[0].id;
    }
    const m = e.manId != null ? env.players.find((p) => p.id === e.manId) : null;
    return m ? { x: m.x, y: Math.max(m.y, env.los + 1) } : GOALS.drop(d, e, env);
  },
  fill: (d, e, env) => ({ x: laneX(env, e.fit) ?? aimX(env), y: env.los + FILL_DEPTH }),
  penetrate: (d, e, env) => {
    const span = gapSpan(env.players, env.defense, e.fit);
    return { x: span ? (span.lo + span.hi) / 2 : e.x0, y: env.los - PENETRATE_DEPTH };
  },
  gapFit: (d, e, env) => {
    return { x: laneX(env, e.fit) ?? e.x0, y: env.los - PENETRATE_DEPTH };
  },
  hold: (d, e) => ({ x: e.x0, y: e.y0 }),
  // A DB's pedal at the snap: straight back from his alignment.
  pedal: (d, e) => ({ x: e.x0, y: e.y0 + PEDAL_DEPTH }),
  // DL read goals. The gap-side shoulder of his blocker, never the gap centre.
  getoff: viaBlocker((d, e, env, b) => ({ x: b.x + gapSide(d, e, env, b) * BODY_RADIUS, y: env.los - GETOFF_DEPTH })),
  holdGap: viaBlocker((d, e, env, b) => ({ x: b.x + gapSide(d, e, env, b) * BODY_RADIUS, y: env.los - PENETRATE_DEPTH })),
  outsideArm: viaBlocker((d, e, env, b) => ({ x: b.x + env.defense.side * ARM_FREE, y: env.los - PENETRATE_DEPTH })),
  anchor: viaBlocker((d, e, env) => ({ x: d.x, y: env.los - PENETRATE_DEPTH })),
  close: (d, e, env) => {
    const span = e.fit ? gapSpan(env.players, env.defense, e.fit) : null;
    if (!span) return GOALS.gapFit(d, e, env);
    const inner = Math.abs(span.lo - env.defense.centerX) <= Math.abs(span.hi - env.defense.centerX) ? 'lo' : 'hi';
    const x = inner === 'lo' ? span.lo + BODY_RADIUS : span.hi - BODY_RADIUS;
    return { x, y: e.assign?.fit === 'spill' ? env.los - PENETRATE_DEPTH : env.los };
  },
  rush: (d, e, env) => {
    const span = e.fit ? gapSpan(env.players, env.defense, e.fit) : null;
    return { x: span ? (span.lo + span.hi) / 2 : e.x0, y: env.los - RUSH_DEPTH };
  },
  squeeze: (d, e, env) => GOALS.gapFit(d, e, env),
  control: viaBlocker((d, e, env, b) => ({ x: b.x, y: env.los - PENETRATE_DEPTH })),
  twoGapFit: viaBlocker((d, e, env, b) => {
    const bx = env.cues?.(d.id)?.ball?.x;
    const s = bx == null ? 0 : Math.sign(bx - b.x);
    return { x: b.x + (s || gapSide(d, e, env, b)) * ARM_FREE, y: env.los };
  }),
  contain: (d, e, env) => ({ x: containX(e, env), y: env.los - CONTAIN_DEPTH }),
  // Take on a climbing blocker with the gap-side shoulder. Unengaged: step up to the climber's gap side
  // and meet him. Engaged: through his gap-side shoulder (the ball cannot come back through the gap).
  takeOn: (d, e, env) => {
    const cue = env.cues?.(d.id);
    if (e.st === 0) { e.back = e.from; e.climber = cue?.climber?.id ?? e.climber; e.gs = undefined; }
    const b = engagerOf(d, env, e.climber) ?? env.players.find((p) => p.id === e.climber);
    if (!b) return GOALS.fitGap(d, e, env);
    if (b.id !== e.climber || !e.gs) {
      e.climber = b.id;
      e.gs = gapSide(d, e, env, b) || Math.sign((cue?.ball?.x ?? b.x) - b.x) || 1;
    }
    if (engagerOf(d, env, e.climber)) return { x: b.x + e.gs * BODY_RADIUS, y: b.y - PENETRATE_DEPTH };
    // Unengaged: stay in his gap, at or in front of his fit depth.
    const span = e.fit ? gapSpan(env.players, env.defense, e.fit) : null;
    let x = b.x + e.gs * BODY_RADIUS;
    if (span && span.lo + BODY_RADIUS <= span.hi - BODY_RADIUS) x = clamp(x, span.lo + BODY_RADIUS, span.hi - BODY_RADIUS);
    return { x, y: Math.max(b.y + BODY_RADIUS, env.los + FILL_DEPTH) };
  },
  // Pursue the ball from the inside out. The ball cue (the holder's own seen spot and velocity, which do not
  // jump when the ball changes hands) leads the intercept; without a cue, the env ball spot and velocity.
  // A pursuer inside of a ball moving sideways at >= LEVER_V aims min(PURSUE_LEVER, his x distance to the ball) inside the intercept point.
  pursue: (d, e, env) => {
    const cues = env.cues?.(d.id);
    const c = cues?.ball;
    const B = c ? { x: c.x, y: c.y } : env.ballPos;
    const V = c ? { x: c.vx, y: c.vy } : env.defense.ballV;
    const age = c ? (cues.delay ?? 0) : 0;
    // While he fights a block he fights toward the ball spot he sees; react.js leverage, and so the shed rate, reads this goal.
    // Once free he runs to meet the carrier: the lead is solved from where the carrier is now, not where he was seen.
    const engaged = (env.players ?? []).some((q) => q.block?.target === d.id && q.block.engaged);
    const p = engaged ? intercept(d, B, V, d.speed, 0, 1) : intercept(d, B, V, d.speed, age);
    const ref = engaged ? B : project(B, V, age);
    const s = Math.abs(V.x) >= LEVER_V ? Math.sign(V.x) : 0;
    const chase = s !== 0 && s * (d.x - ref.x) < 0 ? { x: p.x - s * Math.min(PURSUE_LEVER, Math.abs(d.x - ref.x)), y: p.y } : p;
    if (engaged) return chase;
    // Free and roughly head-on: blend toward a cut-off point on the carrier's path, facing him.
    const w = headOnWeight(d, ref, V);
    if (w <= 0) return chase;
    const sp = Math.hypot(V.x, V.y);
    const ux = sp >= CUTOFF_MIN_V ? V.x / sp : 0, uy = sp >= CUTOFF_MIN_V ? V.y / sp : 1;
    const along = (d.x - ref.x) * ux + (d.y - ref.y) * uy;
    const k = Math.max(0, along - CLOSE_STEP);
    const C = { x: ref.x + ux * k, y: ref.y + uy * k };
    return { x: chase.x + w * (C.x - chase.x), y: chase.y + w * (C.y - chase.y), face: { x: ref.x, y: ref.y, w } };
  },
  ball: () => null, // no goal: blocking.js keeps today's ball pursuit
});

export const TRIGGERS = Object.freeze({
  // A shed means he beat his man, so he plays the ball.
  shed: (d, e, env) => env.players.some((p) => p.block?.target === d.id && p.block.released === 'shed'),
  recognized: (d, e, env) => env.defense.t >= e.read - 1e-9 && env.behavior.keys.some((k) => KEYS[k](env)),
  carrierPast: (d, e, env) => !!env.run?.carried && env.ballPos.y > env.los,
  ballClose: (d, e, env) => !!env.run?.carried && Math.hypot(env.ballPos.x - d.x, env.ballPos.y - d.y) <= PURSUE_REACH,
  // The ball (carrier or QB) is outside his contain x.
  ballOutside: (d, e, env) => env.defense.side * (env.ballPos.x - containX(e, env)) < 0,
  // The RB committed to the playside of the center.
  committedAway: (d, e, env) => !!env.run?.locked && env.run.x != null && env.defense.side * (env.run.x - env.defense.centerX) > 0,
  // A scripted defender's time has come (the script row's `at`, default 0).
  scriptAt: (d, e, env) => env.defense.t >= (e.at ?? 0) - 1e-9,
  // What the DL feels from his blocker(s) (perceive.js `felt`); the exit row's `is` names the value.
  felt: (d, e, env, x) => env.cues?.(d.id)?.felt === x.is,
  // The get-off is over: it has run its time and he feels nothing (or sees nothing).
  getoffDone: (d, e, env) => {
    const f = env.cues?.(d.id)?.felt;
    return e.st >= GETOFF_TIME - 1e-9 && (f == null || f === 'none');
  },
  // A blocker is climbing on him (perceive.js climber cue).
  climberSeen: (d, e, env) => env.cues?.(d.id)?.climber != null,
  // The climber is gone: no climber cue and nobody engaged on him. A row's `back` limits it to takeOn entered from those states.
  climberGone: (d, e, env, x) => env.cues?.(d.id)?.climber == null && !engagerOf(d, env) && (!x.back || x.back.includes(e.back)),
  // The ball commits (the carrier is past the line or moving downfield).
  ballCommitted: (d, e, env) => env.cues?.(d.id)?.ball?.committed === true,
  // The LB read is in: after def.read, his key read is x.is (and flow class x.flow, coverage x.cover when named).
  read: (d, e, env, x) => {
    if (env.defense.t < e.read - 1e-9) return false;
    const c = env.cues(d.id);
    if (!c || keyRead(e.assign?.key, c) !== x.is) return false;
    if (x.flow !== undefined && c.flow?.kind !== x.flow) return false;
    if (x.cover !== undefined && (e.assign?.cover ?? 'zone') !== x.cover) return false;
    return true;
  },
  atFill: (d, e, env) => {
    const g = GOALS.fill(d, e, env);
    return Math.hypot(d.x - g.x, d.y - g.y) <= BODY_RADIUS;
  },
});

// What a DL does for each thing he feels: a response state per felt value. Read-the-hat is this data.
export const DL_RESPONSES = Object.freeze({ base: 'hold', reach: 'outsideArm', double: 'anchor', down: 'close', pass: 'rush' });
export const FELT_VALUES = Object.freeze(['double', 'reach', 'base', 'pass', 'down', 'none']);

const PURSUE_EXITS = Object.freeze([{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }]);
// The LB pursue exits: a shed, the carrier past the line, or the ball committed (perceive.js ball.committed).
export const LB_PURSUE_EXITS = Object.freeze([{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'ballCommitted', to: 'pursue' }]);
// The DL pursue exits: the shared ones, plus the ball committing (a two-gap DL leaves on it for twoGapFit instead).
export const DL_PURSUE_EXITS = Object.freeze([...PURSUE_EXITS, { when: 'ballCommitted', to: 'pursue' }]);
// The LB takeOn exits: where a taken-on climber sends him back to (fit or split; else scrape).
const TAKE_ON_EXIT = Object.freeze({ when: 'climberSeen', to: 'takeOn' });
// The felt exits generated from DL_RESPONSES, skipping the state he is already in.
const feltExits = (self) => Object.entries(DL_RESPONSES).filter(([, to]) => to !== self).map(([is, to]) => ({ when: 'felt', is, to }));

// Behaviours: start state, read keys, and per state a goal, a speed and ordered exits.
// A state's optional `face` makes the player face that target while he moves (shuffle or backpedal); 'ball' is the ball spot he sees.
// The DL read ('attack') and the two-gap behaviour follow the spec "Defensive Linemen": get off, read the hat.
export const FACE_TARGETS = Object.freeze(['ball']);
export const BEHAVIORS = Object.freeze({
  pursue: { start: 'pursue', keys: [], states: { pursue: { goal: 'pursue', speed: 1, exits: [] } } },
  // Scripted and DB behaviours: known-in-advance actions for tests, and simple bodies for the DBs.
  sit: {
    start: 'sit',
    keys: [],
    states: {
      sit: { goal: 'hold', speed: 1, exits: [{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  fillNow: {
    start: 'wait',
    keys: [],
    states: {
      wait: { goal: 'hold', speed: 1, exits: [{ when: 'scriptAt', to: 'fill' }] },
      fill: { goal: 'fill', speed: 1, exits: [{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'atFill', to: 'pursue' }] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  blitz: {
    start: 'wait',
    keys: [],
    states: {
      wait: { goal: 'hold', speed: 1, exits: [{ when: 'scriptAt', to: 'blitz' }] },
      blitz: { goal: 'penetrate', speed: 1, exits: [{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  slant: {
    start: 'wait',
    keys: [],
    states: {
      wait: { goal: 'hold', speed: 1, exits: [{ when: 'scriptAt', to: 'slant' }] },
      slant: { goal: 'penetrate', speed: 1, exits: [{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  cover: {
    start: 'cover',
    keys: [],
    states: {
      cover: { goal: 'pedal', speed: 1, face: 'ball', exits: [{ when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  // The DL read: get off into the blocker's gap-side shoulder, then read the hat (DL_RESPONSES).
  attack: {
    start: 'getoff',
    keys: [],
    states: {
      getoff: { goal: 'getoff', speed: 1, exits: [...DL_PURSUE_EXITS, ...feltExits('getoff'), { when: 'getoffDone', to: 'squeeze' }] },
      hold: { goal: 'holdGap', speed: 1, exits: [...DL_PURSUE_EXITS, ...feltExits('hold'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      outsideArm: { goal: 'outsideArm', speed: 1, exits: [...DL_PURSUE_EXITS, ...feltExits('outsideArm'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      anchor: { goal: 'anchor', speed: 1, exits: [...DL_PURSUE_EXITS, ...feltExits('anchor'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      close: { goal: 'close', speed: 1, exits: [...DL_PURSUE_EXITS, ...feltExits('close'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      rush: { goal: 'rush', speed: 1, exits: [...DL_PURSUE_EXITS, ...feltExits('rush'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      squeeze: { goal: 'squeeze', speed: 1, exits: [...DL_PURSUE_EXITS, ...feltExits('squeeze')] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  // Two-gap: play the blocker head-up until the ball commits, then take the ball's side.
  twoGap: {
    start: 'control',
    keys: [],
    states: {
      control: { goal: 'control', speed: 1, exits: [...PURSUE_EXITS, { when: 'ballCommitted', to: 'twoGapFit' }] },
      twoGapFit: { goal: 'twoGapFit', speed: 1, exits: [...PURSUE_EXITS] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  contain: {
    start: 'read',
    keys: ['runBlock', 'mesh', 'backfield'],
    states: {
      read: { goal: 'hold', speed: CONTAIN_SPEED, face: 'ball', exits: [{ when: 'ballOutside', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'committedAway', to: 'pursue' }, { when: 'recognized', to: 'squeeze' }] },
      squeeze: { goal: 'contain', speed: CONTAIN_SPEED, face: 'ball', exits: [{ when: 'ballOutside', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'committedAway', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  // The LB read: read-step, read the key, then play the flow class (fit, scrape, split) or, on a pass read, drop or man.
  zone: {
    start: 'read',
    keys: [],
    states: {
      read: {
        goal: 'readStep',
        speed: READ_SPEED,
        face: 'ball',
        exits: [
          ...LB_PURSUE_EXITS,
          { when: 'read', is: 'pass', cover: 'zone', to: 'drop' },
          { when: 'read', is: 'pass', cover: 'man', to: 'man' },
          { when: 'read', is: 'pull', to: 'scrape' },
          { when: 'read', is: 'run', flow: 'fast', to: 'scrape' },
          { when: 'read', is: 'run', flow: 'split', to: 'split' },
          { when: 'read', is: 'run', to: 'fit' },
        ],
      },
      fit: { goal: 'fitGap', speed: 1, exits: [...LB_PURSUE_EXITS, TAKE_ON_EXIT] },
      scrape: { goal: 'scrapeGoal', speed: 1, exits: [...LB_PURSUE_EXITS, TAKE_ON_EXIT] },
      split: { goal: 'split', speed: 1, exits: [...LB_PURSUE_EXITS, TAKE_ON_EXIT] },
      takeOn: {
        goal: 'takeOn',
        speed: 1,
        exits: [...LB_PURSUE_EXITS, { when: 'climberGone', back: ['fit', 'split'], to: 'fit' }, { when: 'climberGone', to: 'scrape' }],
      },
      drop: { goal: 'drop', speed: DROP_SPEED, face: 'ball', exits: [...LB_PURSUE_EXITS] },
      man: { goal: 'man', speed: 1, exits: [...LB_PURSUE_EXITS] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
});

// The offensive roles a `cover: 'man'` row may name (the nearest one of that role is the man).
export const MAN_ROLES = Object.freeze(['RB', 'TE', 'FB', 'WR']);

// A call is a data table of assignment rows. A new call is a new key; per-player changes are
// rows (selectors in WHO) or a roster row's `def.assign`. LB types belong to the LB AI
// (R-43 edits only the `lb` row and adds LB types). Row order decides: first match wins.
// The edge row comes first so the backside edge defender keeps contain whatever his role
// (odd34's edge is an LB).
// Row fields beyond who/type/gap/depth (all optional; validateRows checks each value):
//   key       'guard' | 'triangle'   the read key the defender reads (guard: the gap, triangle: the back's key)
//   fit       'spill' | 'box'        the gap fit: spill to the ball's side, or stay in the box
//   cover     'run' | 'zone' | 'man' the coverage duty; 'man' names the offensive MAN_ROLES role in `man`
//   technique 'oneGap' | 'twoGap'    one-gap penetration or two-gap control
//   blitz     boolean                a blitz: behaviour 'blitz' from the snap (flag, see startDefense)
//   slant     'play' | 'back'        a slant one gap over, playside or backside (flag, see startDefense)
export const CALLS = Object.freeze({
  base: Object.freeze({
    name: 'Base',
    rows: Object.freeze([
      Object.freeze({ who: 'edge', type: 'contain', fit: 'box' }),
      Object.freeze({ who: 'dl', type: 'attack', gap: 'fit', technique: 'oneGap', fit: 'spill' }),
      Object.freeze({ who: 'lb', type: 'zone', depth: ZONE_DEPTH, key: 'guard', cover: 'zone' }),
    ]),
  }),
  nickel: Object.freeze({
    name: 'Nickel',
    rows: Object.freeze([
      Object.freeze({ who: 'edge', type: 'contain', fit: 'box' }),
      Object.freeze({ who: 'dl', type: 'attack', gap: 'fit', technique: 'oneGap', fit: 'spill' }),
      Object.freeze({ who: 'playLB', type: 'zone', depth: ZONE_DEPTH, key: 'guard', cover: 'zone' }),
      Object.freeze({ who: 'backLB', type: 'zone', depth: ZONE_DEPTH, key: 'triangle', cover: 'zone' }),
      Object.freeze({ who: 'lb', type: 'zone', depth: ZONE_DEPTH, key: 'guard', cover: 'zone' }),
    ]),
  }),
  twoGap: Object.freeze({
    name: 'Two-gap',
    rows: Object.freeze([
      Object.freeze({ who: 'edge', type: 'contain', fit: 'box' }),
      Object.freeze({ who: 'dl', type: 'attack', gap: 'fit', technique: 'twoGap', fit: 'box' }),
      Object.freeze({ who: 'lb', type: 'zone', depth: ZONE_DEPTH, key: 'guard', cover: 'zone' }),
    ]),
  }),
  slant: Object.freeze({
    name: 'Slant (DL slant playside)',
    rows: Object.freeze([
      Object.freeze({ who: 'edge', type: 'contain', fit: 'box' }),
      Object.freeze({ who: 'dl', type: 'attack', gap: 'fit', technique: 'oneGap', fit: 'spill', slant: 'play' }),
      Object.freeze({ who: 'lb', type: 'zone', depth: ZONE_DEPTH, key: 'guard', cover: 'zone' }),
    ]),
  }),
  blitz: Object.freeze({
    name: 'Blitz (playside LB)',
    rows: Object.freeze([
      Object.freeze({ who: 'edge', type: 'contain', fit: 'box' }),
      Object.freeze({ who: 'dl', type: 'attack', gap: 'fit', technique: 'oneGap', fit: 'spill' }),
      Object.freeze({ who: 'playLB', type: 'zone', depth: ZONE_DEPTH, key: 'guard', cover: 'run', blitz: true }),
      Object.freeze({ who: 'lb', type: 'zone', depth: ZONE_DEPTH, key: 'guard', cover: 'zone' }),
    ]),
  }),
});

// Defensive personnel (a DEF_PERSONNEL key) -> the call it plays by default. Others play 'base'.
export const PERSONNEL_CALLS = Object.freeze({ nickel: 'nickel' });

export function callFor(defPersonnel) {
  return defPersonnel != null && Object.hasOwn(PERSONNEL_CALLS, defPersonnel) ? PERSONNEL_CALLS[defPersonnel] : 'base';
}

// Walks one gap over along the line. Gaps in playside order: back F..B, back A, play A, play B..F.
export function shiftGap(fit, dir) {
  const i = GAP_NAMES.indexOf(fit.name);
  const pos = fit.side === 'play' ? i : -i - 1; // back A = -1, play A = 0
  const next = pos + (dir === 'play' ? 1 : -1);
  const side = next >= 0 ? 'play' : 'back';
  const idx = Math.min(GAP_NAMES.length - 1, next >= 0 ? next : -next - 1);
  return { side, name: GAP_NAMES[idx] };
}

// Play-relative picks: the one defender in `front` that best fits, or false for everyone else.
const roleOf = (players, id) => players.find((q) => q.id === id)?.role;
const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
function pick(d, front, players, keep, rank) {
  if (!front || !players) return false;
  const c = front.defenders.filter((f) => keep(f, roleOf(players, f.id)));
  if (!c.length) return false;
  c.sort((a, b) => rank(a) - rank(b) || byId(a, b));
  return c[0].id === d.id;
}

// selector name -> (player, front-read entry, front, players) => bool
export const WHO = Object.freeze({
  dl: (d, f, front) => DL_ROLES.includes(d.role),
  lb: (d, f, front) => LB_ROLES.includes(d.role),
  edge: (d, f, front) => front?.edge != null && front.edge === d.id,
  playLB: (d, f, front, players) => pick(d, front, players, (x, r) => x.level === 'second' && LB_ROLES.includes(r) && x.u >= -HEAD_UP, (x) => Math.abs(x.u)),
  backLB: (d, f, front, players) => pick(d, front, players, (x, r) => x.level === 'second' && LB_ROLES.includes(r) && x.u < -HEAD_UP, (x) => Math.abs(x.u)),
  playDT: (d, f, front, players) => pick(d, front, players, (x, r) => x.level === 'line' && DL_ROLES.includes(r) && x.u > -HEAD_UP, (x) => x.u),
  backDT: (d, f, front, players) => pick(d, front, players, (x, r) => x.level === 'line' && DL_ROLES.includes(r) && x.u <= -HEAD_UP, (x) => -x.u),
  playEnd: (d, f, front, players) => pick(d, front, players, (x) => x.level === 'line' && x.u > HEAD_UP, (x) => -x.u),
  backEnd: (d, f, front, players) => !!front && !!players && front.edge != null && front.edge === d.id,
});

export const LATE_FILL_AT = 0.6; // s: when a late scripted fill starts (tunable)

// Test scripts: which defender does what, picked by play-relative selector.
const row = (r) => Object.freeze(r);
export const SCRIPTS = Object.freeze({
  lbSits: Object.freeze({ name: 'LBs sit', rows: Object.freeze([row({ who: 'playLB', behavior: 'sit' }), row({ who: 'backLB', behavior: 'sit' })]) }),
  lbFills: Object.freeze({ name: 'Playside LB fills at the snap', rows: Object.freeze([row({ who: 'playLB', behavior: 'fillNow' })]) }),
  lbFillsLate: Object.freeze({ name: 'Playside LB sits, then fills', rows: Object.freeze([row({ who: 'playLB', behavior: 'fillNow', at: LATE_FILL_AT })]) }),
  lbBlitz: Object.freeze({ name: 'Playside LB blitzes his gap', rows: Object.freeze([row({ who: 'playLB', behavior: 'blitz' })]) }),
  dtSlant: Object.freeze({ name: 'Playside DT slants playside', rows: Object.freeze([row({ who: 'playDT', behavior: 'slant', slant: 'play' })]) }),
  dtSlantBack: Object.freeze({ name: 'Playside DT slants backside', rows: Object.freeze([row({ who: 'playDT', behavior: 'slant', slant: 'back' })]) }),
  endCrash: Object.freeze({ name: 'Backside end crashes inside', rows: Object.freeze([row({ who: 'backEnd', behavior: 'slant', slant: 'play' })]) }),
});

// Role default for defenders no script, def or call row gives a behaviour.
export const ROLE_BEHAVIORS = Object.freeze({ CB: 'cover', S: 'cover' });

// Accepts a SCRIPTS key, an array of rows, or null; returns the rows (null for none).
export function validateScript(script) {
  if (script == null) return null;
  let rows;
  if (typeof script === 'string') {
    if (!Object.hasOwn(SCRIPTS, script)) throw new Error(`defense: unknown script "${script}"`);
    rows = SCRIPTS[script].rows;
  } else if (Array.isArray(script)) {
    rows = script;
  } else {
    throw new Error('defense: script must be a key, rows or null');
  }
  for (const r of rows) {
    if (!Object.hasOwn(WHO, r.who)) throw new Error(`defense: script unknown who "${r.who}"`);
    validateBehavior(r.behavior);
    if (r.slant !== undefined && r.slant !== 'play' && r.slant !== 'back') throw new Error(`defense: script bad slant "${r.slant}"`);
    if (r.at !== undefined && !(Number.isFinite(r.at) && r.at >= 0)) throw new Error(`defense: script bad at "${r.at}"`);
  }
  return rows;
}

// assignment type -> behaviour name
export const ASSIGNMENTS = Object.freeze({
  attack: Object.freeze({ behavior: 'attack' }),
  contain: Object.freeze({ behavior: 'contain' }),
  zone: Object.freeze({ behavior: 'zone' }),
});

export function validateBehavior(name, behaviors = BEHAVIORS) {
  const b = Object.hasOwn(behaviors, name) ? behaviors[name] : null;
  if (!b) throw new Error(`defense: unknown behavior "${name}"`);
  if (!b.states[b.start]) throw new Error(`defense: behavior "${name}" start state "${b.start}" missing`);
  for (const k of b.keys) {
    if (!Object.hasOwn(KEYS, k)) throw new Error(`defense: behavior "${name}" unknown key "${k}"`);
  }
  for (const [sn, row] of Object.entries(b.states)) {
    if (!Object.hasOwn(GOALS, row.goal)) throw new Error(`defense: behavior "${name}" state "${sn}" unknown goal "${row.goal}"`);
    if (row.face !== undefined && !FACE_TARGETS.includes(row.face)) throw new Error(`defense: behavior "${name}" state "${sn}" bad face "${row.face}"`);
    for (const ex of row.exits) {
      if (!Object.hasOwn(TRIGGERS, ex.when)) throw new Error(`defense: behavior "${name}" state "${sn}" unknown trigger "${ex.when}"`);
      if (ex.when === 'read') {
        if (!['run', 'pull', 'pass'].includes(ex.is)) throw new Error(`defense: behavior "${name}" state "${sn}" bad read "${ex.is}"`);
        if (ex.flow !== undefined && !['fast', 'slow', 'split', 'none'].includes(ex.flow)) throw new Error(`defense: behavior "${name}" state "${sn}" bad read flow "${ex.flow}"`);
        if (ex.cover !== undefined && !['zone', 'man'].includes(ex.cover)) throw new Error(`defense: behavior "${name}" state "${sn}" bad read cover "${ex.cover}"`);
      }
      if (ex.when === 'felt' && !FELT_VALUES.includes(ex.is)) throw new Error(`defense: behavior "${name}" state "${sn}" bad felt "${ex.is}"`);
      if (!Object.hasOwn(b.states, ex.to)) throw new Error(`defense: behavior "${name}" state "${sn}" unknown exit target "${ex.to}"`);
    }
  }
  return b;
}

// First row whose selector matches, as an assignment ({type, ...params}); null when none.
export function pickAssign(rows, d, f, front, players) {
  const row = rows.find((r) => WHO[r.who](d, f, front, players));
  if (!row) return null;
  const { who, ...rest } = row;
  return rest;
}

// Optional row fields and their allowed values; an absent field is fine.
const ROW_VALUES = Object.freeze({
  key: Object.freeze(['guard', 'triangle']),
  fit: Object.freeze(['spill', 'box']),
  cover: Object.freeze(['run', 'zone', 'man']),
  technique: Object.freeze(['oneGap', 'twoGap']),
  slant: Object.freeze(['play', 'back']),
});

export function validateRows(name, rows) {
  for (const row of rows) {
    if (!Object.hasOwn(WHO, row.who)) throw new Error(`defense: call "${name}" unknown who "${row.who}"`);
    if (!Object.hasOwn(ASSIGNMENTS, row.type)) throw new Error(`defense: call "${name}" unknown type "${row.type}"`);
    validateBehavior(ASSIGNMENTS[row.type].behavior);
    for (const [field, allowed] of Object.entries(ROW_VALUES)) {
      if (row[field] !== undefined && !allowed.includes(row[field])) throw new Error(`defense: call "${name}" bad ${field} "${row[field]}"`);
    }
    if (row.blitz !== undefined && typeof row.blitz !== 'boolean') throw new Error(`defense: call "${name}" bad blitz "${row.blitz}"`);
    if (row.man !== undefined || row.cover === 'man') {
      if (!MAN_ROLES.includes(row.man)) throw new Error(`defense: call "${name}" bad man "${row.man}"`);
    }
  }
}

export function validateCall(name) {
  if (!Object.hasOwn(CALLS, name)) throw new Error(`defense: unknown call "${name}"`);
  validateRows(name, CALLS[name].rows);
  return CALLS[name];
}

export function startDefense(players, front, { los, call = 'base', carrierId, script = null } = {}) {
  const table = validateCall(call);
  const scriptRows = validateScript(script);
  const rb = players.find((p) => p.id === carrierId);
  const defense = {
    call,
    los,
    side: front.side,
    centerX: front.centerX,
    t: 0,
    carrierId,
    rb0: rb ? { x: rb.x, y: rb.y } : null,
    lineIds: front.line.map(({ id, n }) => ({ id, n })),
    line: {},
    agents: {},
    committed: {},
    ballV: { x: 0, y: 0 },
    ballPrev: null,
  };
  for (const l of front.line) {
    const p = players.find((q) => q.id === l.id);
    if (p) defense.line[l.id] = { x: p.x, y: p.y };
  }
  const checked = new Set();
  for (const f of front.defenders) {
    const d = players.find((p) => p.id === f.id);
    if (!d) continue;
    const srow = scriptRows?.find((r) => WHO[r.who](d, f, front, players));
    let assign = d.def?.assign ?? pickAssign(table.rows, d, f, front, players);
    if (assign && !Object.hasOwn(ASSIGNMENTS, assign.type)) throw new Error(`defense: unknown type "${assign.type}"`);
    if (assign?.type === 'zone' && assign.depth === undefined) assign = { ...assign, depth: ZONE_DEPTH };
    // A call's blitz or slant flag picks the behaviour after the script row and def.behavior.
    const flag = assign?.blitz === true ? 'blitz' : assign?.slant ? 'slant' : null;
    const name = srow ? srow.behavior : (d.def?.behavior ?? flag ?? (assign ? (assign.type === 'attack' && assign.technique === 'twoGap' ? 'twoGap' : ASSIGNMENTS[assign.type].behavior) : null) ?? ROLE_BEHAVIORS[d.role] ?? null);
    if (!name) continue;
    if (!checked.has(name)) { validateBehavior(name); checked.add(name); }
    const agent = {
      behavior: name,
      state: BEHAVIORS[name].start,
      st: 0,
      read: d.def?.read ?? LB_READ_TIME,
      x0: d.x,
      y0: d.y,
      assign: assign ?? null,
      fit: assign?.gap && assign.gap !== 'fit' ? assign.gap : f.fit,
      why: srow ? 'script' : 'start',
    };
    if (srow) {
      if (srow.slant) agent.fit = shiftGap(agent.fit, srow.slant);
      agent.at = srow.at ?? 0;
      agent.script = srow.who;
    } else if (flag && !d.def?.behavior) {
      agent.at = 0;
      if (flag === 'slant') agent.fit = shiftGap(agent.fit, assign.slant);
    }
    defense.agents[d.id] = agent;
  }
  // Defence players outside the numbered front (wide corners, deep safeties) with a def behaviour or a role default.
  const inFront = new Set(front.defenders.map((f) => f.id));
  for (const d of players) {
    if (d.team !== 'defense' || inFront.has(d.id)) continue;
    const name = d.def?.behavior ?? ROLE_BEHAVIORS[d.role] ?? null;
    if (!name) continue;
    if (!checked.has(name)) { validateBehavior(name); checked.add(name); }
    defense.agents[d.id] = {
      behavior: name,
      state: BEHAVIORS[name].start,
      st: 0,
      read: d.def?.read ?? LB_READ_TIME,
      x0: d.x,
      y0: d.y,
      assign: null,
      fit: null,
      why: 'start',
    };
  }
  return defense;
}

export function stepDefense(players, defense, { run, ballPos, cues }, dt) {
  defense.t += dt;
  const cueOf = cues ?? (() => null);
  defense.ballV = defense.ballPrev && dt > 0
    ? { x: (ballPos.x - defense.ballPrev.x) / dt, y: (ballPos.y - defense.ballPrev.y) / dt }
    : { x: 0, y: 0 };
  defense.ballPrev = { x: ballPos.x, y: ballPos.y };
  const out = {};
  for (const [id, e] of Object.entries(defense.agents)) {
    const d = players.find((p) => p.id === id);
    if (!d) continue;
    const behavior = BEHAVIORS[e.behavior];
    const env = { players, defense, run, ballPos, los: defense.los, behavior, cues: cueOf };
    e.st += dt;
    const tech = cueOf(id)?.tech;
    if (e.blocker == null && tech?.blocker != null) e.blocker = tech.blocker;
    const hit = behavior.states[e.state].exits.find((x) => x.to !== e.state && TRIGGERS[x.when](d, e, env, x));
    if (hit) { e.from = e.state; e.state = hit.to; e.st = 0; e.why = hit.when; }
    const row = behavior.states[e.state];
    const g = GOALS[row.goal](d, e, env);
    if (e.state !== behavior.start && !defense.committed[id]) {
      defense.committed[id] = { x: g ? g.x : ballPos.x, t: defense.t };
    }
    if (g) {
      out[id] = { x: g.x, y: g.y, key: 'def:' + e.state, rate: row.speed * d.speed };
      if (g.face) out[id].face = g.face;
      else if (row.face === 'ball') {
        const b = cueOf(id)?.ball;
        out[id].face = { x: b ? b.x : ballPos.x, y: b ? b.y : ballPos.y, w: 1 };
      }
      const move = moveFor(d, e, env);
      if (move) out[id].move = move;
    }
  }
  return out;
}
