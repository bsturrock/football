// Defender decisions as data: a behaviour is a small state machine whose states
// name a GOAL (where to run) and whose exits name TRIGGERS (when to change state).
// Pure: reads players, never moves them; blocking.js steers toward the goals.
// A one-gap defensive lineman reads his blocker through env.cues (see BEHAVIORS.attack and DL_RESPONSES).
// The backside edge keeps contain: he reads run, squeezes to a point outside the backside end
// lineman, and pursues only when the ball gets outside him, crosses the los, or the RB commits away.
// A blitz or drop is a new GOALS entry plus a state row; linebackers do not blitz today.
// A one-gap DL gets off into his blocker's gap-side shoulder (not the gap centre), then reads the hat
// through the DL_RESPONSES table (base: hold, reach: outside arm free, double: anchor, down: close,
// pass: rush; nothing felt: squeeze). A two-gap DL plays his blocker head-up (control) until the ball
// commits, then takes the ball's side (twoGapFit). Cues come from env.cues (perceive.js).
import { BODY_RADIUS } from './blocking.js';
import { GAP_NAMES, HEAD_UP, liveGaps } from './front.js';
import { DL_ROLES, LB_ROLES } from './roster.js';

export const LB_READ_TIME = 0.45; // s, fallback when a player has no def.read
export const KEY_MOVE = BODY_RADIUS; // yd a line player must move to count as an OL-movement key
export const FLOW_MAX = 0.5; // s in flow before he must fill
export const ZONE_DEPTH = 10; // yd past the los: the zone drop landmark depth (tunable)
export const DROP_SPEED = 0.6; // fraction of speed while dropping, a backpedal (tunable)
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

export const LEAD_MAX = 1.0; // s, the longest lead a pursuer takes (tunable)

// Where a pursuer at d running at `speed` meets a ball at `ball` moving at v: the earliest
// non-negative meeting time, capped at LEAD_MAX (also used when no meeting exists). The lead
// time is also capped at the pursuer's time to reach the ball's current spot, so a close
// pursuer's lead point shrinks with his distance and ball-velocity noise cannot throw it yards
// away. A man 1 yd from the ball carrier plays the man, he does not run to where the carrier
// will be in a second.
export function intercept(d, ball, v, speed) {
  const rx = ball.x - d.x;
  const ry = ball.y - d.y;
  const a = v.x * v.x + v.y * v.y - speed * speed;
  const b = 2 * (rx * v.x + ry * v.y);
  const c = rx * rx + ry * ry;
  let t = LEAD_MAX;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12 && -c / b >= 0) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const q = Math.sqrt(disc);
      const roots = [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter((r) => r >= 0);
      if (roots.length) t = Math.min(...roots);
    }
  }
  const reach = speed > 0 ? Math.hypot(rx, ry) / speed : Infinity;
  t = Math.min(t, LEAD_MAX, reach);
  return { x: ball.x + v.x * t, y: ball.y + v.y * t };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The live span of the fit's gap, or null when there is no center to walk from.
export function gapSpan(players, defense, fit) {
  const i = GAP_NAMES.indexOf(fit.name);
  const g = liveGaps(players, defense.lineIds, defense.side, fit.side === 'play' ? 1 : -1, i + 1)[i];
  return g ? { lo: g.lo, hi: g.hi } : null;
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
  // Differs from brief item 5 (y: d.y) by pm decision (T-98 answer, option a): an LB who reads run out of his drop
  // flows downhill back to at least his alignment depth y0 while moving laterally, instead of flowing at his dropped
  // depth. That also keeps the F-32 combo-climb timing intact. Never shallower than the fill depth.
  flow: (d, e, env) => ({ x: laneX(env, e.fit) ?? aimX(env), y: Math.max(e.y0, env.los + FILL_DEPTH) }),
  fill: (d, e, env) => ({ x: laneX(env, e.fit) ?? aimX(env), y: env.los + FILL_DEPTH }),
  penetrate: (d, e, env) => {
    const span = gapSpan(env.players, env.defense, e.fit);
    return { x: span ? (span.lo + span.hi) / 2 : e.x0, y: env.los - PENETRATE_DEPTH };
  },
  gapFit: (d, e, env) => {
    return { x: laneX(env, e.fit) ?? e.x0, y: env.los - PENETRATE_DEPTH };
  },
  hold: (d, e) => ({ x: e.x0, y: e.y0 }),
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
  pursue: (d, e, env) => intercept(d, env.ballPos, env.defense.ballV, d.speed),
  ball: () => null, // no goal: blocking.js keeps today's ball pursuit
});

export const TRIGGERS = Object.freeze({
  // A shed means he beat his man, so he plays the ball.
  shed: (d, e, env) => env.players.some((p) => p.block?.target === d.id && p.block.released === 'shed'),
  recognized: (d, e, env) => env.defense.t >= e.read - 1e-9 && env.behavior.keys.some((k) => KEYS[k](env)),
  carrierPast: (d, e, env) => !!env.run?.carried && env.ballPos.y > env.los,
  committed: (d, e, env) => !!env.run?.locked || e.st >= FLOW_MAX - 1e-9,
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
  // The ball commits (the carrier is past the line or moving downfield).
  ballCommitted: (d, e, env) => env.cues?.(d.id)?.ball?.committed === true,
  atFill: (d, e, env) => {
    const g = GOALS.fill(d, e, env);
    return Math.hypot(d.x - g.x, d.y - g.y) <= BODY_RADIUS;
  },
});

// What a DL does for each thing he feels: a response state per felt value. Read-the-hat is this data.
export const DL_RESPONSES = Object.freeze({ base: 'hold', reach: 'outsideArm', double: 'anchor', down: 'close', pass: 'rush' });
export const FELT_VALUES = Object.freeze(['double', 'reach', 'base', 'pass', 'down', 'none']);

const PURSUE_EXITS = Object.freeze([{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }]);
// The felt exits generated from DL_RESPONSES, skipping the state he is already in.
const feltExits = (self) => Object.entries(DL_RESPONSES).filter(([, to]) => to !== self).map(([is, to]) => ({ when: 'felt', is, to }));

// Behaviours: start state, read keys, and per state a goal, a speed and ordered exits.
// The DL read ('attack') and the two-gap behaviour follow the spec "Defensive Linemen": get off, read the hat.
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
      cover: { goal: 'hold', speed: 1, exits: [{ when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  // The DL read: get off into the blocker's gap-side shoulder, then read the hat (DL_RESPONSES).
  attack: {
    start: 'getoff',
    keys: [],
    states: {
      getoff: { goal: 'getoff', speed: 1, exits: [...PURSUE_EXITS, ...feltExits('getoff'), { when: 'getoffDone', to: 'squeeze' }] },
      hold: { goal: 'holdGap', speed: 1, exits: [...PURSUE_EXITS, ...feltExits('hold'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      outsideArm: { goal: 'outsideArm', speed: 1, exits: [...PURSUE_EXITS, ...feltExits('outsideArm'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      anchor: { goal: 'anchor', speed: 1, exits: [...PURSUE_EXITS, ...feltExits('anchor'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      close: { goal: 'close', speed: 1, exits: [...PURSUE_EXITS, ...feltExits('close'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      rush: { goal: 'rush', speed: 1, exits: [...PURSUE_EXITS, ...feltExits('rush'), { when: 'felt', is: 'none', to: 'squeeze' }] },
      squeeze: { goal: 'squeeze', speed: 1, exits: [...PURSUE_EXITS, ...feltExits('squeeze')] },
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
      read: { goal: 'hold', speed: CONTAIN_SPEED, exits: [{ when: 'ballOutside', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'committedAway', to: 'pursue' }, { when: 'recognized', to: 'squeeze' }] },
      squeeze: { goal: 'contain', speed: CONTAIN_SPEED, exits: [{ when: 'ballOutside', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'committedAway', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }] },
      pursue: { goal: 'pursue', speed: 1, exits: [] },
    },
  },
  zone: {
    start: 'drop',
    keys: ['runBlock', 'mesh', 'backfield'],
    states: {
      drop: { goal: 'drop', speed: DROP_SPEED, exits: [{ when: 'recognized', to: 'flow' }] },
      flow: { goal: 'flow', speed: 1, exits: [{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'committed', to: 'fill' }] },
      fill: { goal: 'fill', speed: 1, exits: [{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'atFill', to: 'pursue' }] },
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
    for (const ex of row.exits) {
      if (!Object.hasOwn(TRIGGERS, ex.when)) throw new Error(`defense: behavior "${name}" state "${sn}" unknown trigger "${ex.when}"`);
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
    if (hit) { e.state = hit.to; e.st = 0; e.why = hit.when; }
    const row = behavior.states[e.state];
    const g = GOALS[row.goal](d, e, env);
    if (e.state !== behavior.start && !defense.committed[id]) {
      defense.committed[id] = { x: g ? g.x : ballPos.x, t: defense.t };
    }
    if (g) out[id] = { x: g.x, y: g.y, key: 'def:' + e.state, rate: row.speed * d.speed };
  }
  return out;
}
