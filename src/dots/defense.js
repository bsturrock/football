// Defender decisions as data: a behaviour is a small state machine whose states
// name a GOAL (where to run) and whose exits name TRIGGERS (when to change state).
// Pure: reads players, never moves them; blocking.js steers toward the goals.
// The backside edge keeps contain: he reads run, squeezes to a point outside the backside end
// lineman, and pursues only when the ball gets outside him, crosses the los, or the RB commits away.
// A blitz or drop is a new GOALS entry plus a state row; linebackers do not blitz today.
import { BODY_RADIUS } from './blocking.js';
import { GAP_NAMES, liveGaps } from './front.js';
import { DL_ROLES, LB_ROLES } from './roster.js';

export const LB_READ_TIME = 0.45; // s, fallback when a player has no def.read
export const KEY_MOVE = BODY_RADIUS; // yd a line player must move to count as an OL-movement key
export const FLOW_MAX = 0.5; // s in flow before he must fill
export const ZONE_DEPTH = 10; // yd past the los: the zone drop landmark depth (tunable)
export const DROP_SPEED = 0.6; // fraction of speed while dropping, a backpedal (tunable)
export const FILL_DEPTH = 3.5; // yd past the los where he fills: football depth (3-5 yd), not body geometry (tunable)
export const PENETRATE_DEPTH = 4 * BODY_RADIUS; // yd behind the los the DL aims for
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
  atFill: (d, e, env) => {
    const g = GOALS.fill(d, e, env);
    return Math.hypot(d.x - g.x, d.y - g.y) <= BODY_RADIUS;
  },
});

export const BEHAVIORS = Object.freeze({
  pursue: { start: 'pursue', keys: [], states: { pursue: { goal: 'ball', speed: 1, exits: [] } } },
  attack: {
    start: 'attack',
    keys: ['olMove', 'mesh'],
    states: {
      attack: { goal: 'penetrate', speed: 1, exits: [{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }, { when: 'recognized', to: 'fit' }] },
      fit: { goal: 'gapFit', speed: 1, exits: [{ when: 'shed', to: 'pursue' }, { when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }] },
      pursue: { goal: 'ball', speed: 1, exits: [] },
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

// A call is a data table of assignment rows. A new call is a new key; per-player changes are
// rows (selectors in WHO) or a roster row's `def.assign`. LB types belong to the LB AI
// (R-43 edits only the `lb` row and adds LB types). Row order decides: first match wins.
// The edge row comes first so the backside edge defender keeps contain whatever his role
// (odd34's edge is an LB).
export const CALLS = Object.freeze({
  base: Object.freeze({
    name: 'Base',
    rows: Object.freeze([
      Object.freeze({ who: 'edge', type: 'contain' }),
      Object.freeze({ who: 'dl', type: 'attack', gap: 'fit' }),
      Object.freeze({ who: 'lb', type: 'zone', depth: ZONE_DEPTH }),
    ]),
  }),
});

// selector name -> (player, front-read entry) => bool
export const WHO = Object.freeze({
  dl: (d, f, front) => DL_ROLES.includes(d.role),
  lb: (d, f, front) => LB_ROLES.includes(d.role),
  edge: (d, f, front) => front?.edge != null && front.edge === d.id,
});

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
      if (!Object.hasOwn(b.states, ex.to)) throw new Error(`defense: behavior "${name}" state "${sn}" unknown exit target "${ex.to}"`);
    }
  }
  return b;
}

// First row whose selector matches, as an assignment ({type, ...params}); null when none.
export function pickAssign(rows, d, f, front) {
  const row = rows.find((r) => WHO[r.who](d, f, front));
  if (!row) return null;
  const { who, ...rest } = row;
  return rest;
}

export function validateRows(name, rows) {
  for (const row of rows) {
    if (!Object.hasOwn(WHO, row.who)) throw new Error(`defense: call "${name}" unknown who "${row.who}"`);
    if (!Object.hasOwn(ASSIGNMENTS, row.type)) throw new Error(`defense: call "${name}" unknown type "${row.type}"`);
    validateBehavior(ASSIGNMENTS[row.type].behavior);
  }
}

export function validateCall(name) {
  if (!Object.hasOwn(CALLS, name)) throw new Error(`defense: unknown call "${name}"`);
  validateRows(name, CALLS[name].rows);
  return CALLS[name];
}

export function startDefense(players, front, { los, call = 'base', carrierId } = {}) {
  const table = validateCall(call);
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
    let assign = d.def?.assign ?? pickAssign(table.rows, d, f, front);
    if (assign && !Object.hasOwn(ASSIGNMENTS, assign.type)) throw new Error(`defense: unknown type "${assign.type}"`);
    if (assign?.type === 'zone' && assign.depth === undefined) assign = { ...assign, depth: ZONE_DEPTH };
    const name = d.def?.behavior ?? (assign ? ASSIGNMENTS[assign.type].behavior : null);
    if (!name) continue;
    if (!checked.has(name)) { validateBehavior(name); checked.add(name); }
    defense.agents[d.id] = {
      behavior: name,
      state: BEHAVIORS[name].start,
      st: 0,
      read: d.def?.read ?? LB_READ_TIME,
      x0: d.x,
      y0: d.y,
      assign: assign ?? null,
      fit: assign?.gap && assign.gap !== 'fit' ? assign.gap : f.fit,
    };
  }
  return defense;
}

export function stepDefense(players, defense, { run, ballPos }, dt) {
  defense.t += dt;
  defense.ballV = defense.ballPrev && dt > 0
    ? { x: (ballPos.x - defense.ballPrev.x) / dt, y: (ballPos.y - defense.ballPrev.y) / dt }
    : { x: 0, y: 0 };
  defense.ballPrev = { x: ballPos.x, y: ballPos.y };
  const out = {};
  for (const [id, e] of Object.entries(defense.agents)) {
    const d = players.find((p) => p.id === id);
    if (!d) continue;
    const behavior = BEHAVIORS[e.behavior];
    const env = { players, defense, run, ballPos, los: defense.los, behavior };
    e.st += dt;
    const hit = behavior.states[e.state].exits.find((x) => TRIGGERS[x.when](d, e, env));
    if (hit) { e.state = hit.to; e.st = 0; }
    const row = behavior.states[e.state];
    const g = GOALS[row.goal](d, e, env);
    if (e.state !== behavior.start && !defense.committed[id]) {
      defense.committed[id] = { x: g ? g.x : ballPos.x, t: defense.t };
    }
    if (g) out[id] = { x: g.x, y: g.y, key: 'def:' + e.state, rate: row.speed * d.speed };
  }
  return out;
}
