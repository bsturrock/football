// Defender decisions as data: a behaviour is a small state machine whose states
// name a GOAL (where to run) and whose exits name TRIGGERS (when to change state).
// Pure: reads players, never moves them; blocking.js steers toward the goals.
// A blitz or drop is a new GOALS entry plus a state row; linebackers do not blitz today.
import { BODY_RADIUS } from './blocking.js';
import { GAP_NAMES, liveGaps } from './front.js';
import { DL_ROLES, LB_ROLES } from './roster.js';

export const LB_READ_TIME = 0.45; // s, fallback when a player has no def.read
export const SHUFFLE = 0.3; // fraction of speed while reading
export const KEY_MOVE = BODY_RADIUS; // yd a line player must move to count as an OL-movement key
export const FLOW_MAX = 0.5; // s in flow before he must fill
export const FILL_DEPTH = 3 * BODY_RADIUS; // yd past the los where he fills
export const PENETRATE_DEPTH = 4 * BODY_RADIUS; // yd behind the los the DL aims for
export const PURSUE_REACH = 8 * BODY_RADIUS; // yd: a DL this close to the carried ball pursues

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The live span of the fit's gap, or null when there is no center to walk from.
export function gapSpan(players, defense, fit) {
  const i = GAP_NAMES.indexOf(fit.name);
  const g = liveGaps(players, defense.lineIds, defense.side, fit.side === 'play' ? 1 : -1, i + 1)[i];
  return g ? { lo: g.lo, hi: g.hi } : null;
}

const aimX = (env) => (env.run ? env.run.aim.x : env.ballPos.x);

export const KEYS = Object.freeze({
  olMove: (env) => env.defense.lineIds.some(({ id }) => {
    const p = env.players.find((q) => q.id === id);
    const s = env.defense.line[id];
    return !!p && !!s && Math.hypot(p.x - s.x, p.y - s.y) >= KEY_MOVE;
  }),
  mesh: (env) => !!env.run?.carried,
});

export const GOALS = Object.freeze({
  mirror: (d, e, env) => {
    const rb = env.players.find((p) => p.id === env.defense.carrierId);
    return { x: e.x0 + (rb.x - env.defense.rb0.x), y: e.y0 };
  },
  flow: (d, e, env) => ({ x: aimX(env), y: e.y0 }),
  fill: (d, e, env) => {
    const span = gapSpan(env.players, env.defense, e.fit);
    if (!span) return { x: aimX(env), y: env.los + FILL_DEPTH };
    const lo = span.lo + BODY_RADIUS;
    const hi = span.hi - BODY_RADIUS;
    const x = lo <= hi ? clamp(aimX(env), lo, hi) : (span.lo + span.hi) / 2;
    return { x, y: env.los + FILL_DEPTH };
  },
  penetrate: (d, e, env) => {
    const span = gapSpan(env.players, env.defense, e.fit);
    return { x: span ? (span.lo + span.hi) / 2 : e.x0, y: env.los - PENETRATE_DEPTH };
  },
  gapFit: (d, e, env) => {
    const span = gapSpan(env.players, env.defense, e.fit);
    const y = env.los - PENETRATE_DEPTH;
    if (!span) return { x: e.x0, y };
    const lo = span.lo + BODY_RADIUS;
    const hi = span.hi - BODY_RADIUS;
    return { x: lo <= hi ? clamp(aimX(env), lo, hi) : (span.lo + span.hi) / 2, y };
  },
  ball: () => null, // no goal: blocking.js keeps today's ball pursuit
});

export const TRIGGERS = Object.freeze({
  recognized: (d, e, env) => env.defense.t >= e.read - 1e-9 && env.behavior.keys.some((k) => KEYS[k](env)),
  carrierPast: (d, e, env) => !!env.run?.carried && env.ballPos.y > env.los,
  committed: (d, e, env) => !!env.run?.locked || e.st >= FLOW_MAX - 1e-9,
  ballClose: (d, e, env) => !!env.run?.carried && Math.hypot(env.ballPos.x - d.x, env.ballPos.y - d.y) <= PURSUE_REACH,
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
      attack: { goal: 'penetrate', speed: 1, exits: [{ when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }, { when: 'recognized', to: 'fit' }] },
      fit: { goal: 'gapFit', speed: 1, exits: [{ when: 'carrierPast', to: 'pursue' }, { when: 'ballClose', to: 'pursue' }] },
      pursue: { goal: 'ball', speed: 1, exits: [] },
    },
  },
  readFlowFill: {
    start: 'read',
    keys: ['olMove', 'mesh'],
    states: {
      read: { goal: 'mirror', speed: SHUFFLE, exits: [{ when: 'recognized', to: 'flow' }] },
      flow: { goal: 'flow', speed: 1, exits: [{ when: 'carrierPast', to: 'pursue' }, { when: 'committed', to: 'fill' }] },
      fill: { goal: 'fill', speed: 1, exits: [{ when: 'carrierPast', to: 'pursue' }, { when: 'atFill', to: 'pursue' }] },
      pursue: { goal: 'ball', speed: 1, exits: [] },
    },
  },
});

// A call is a data table of assignment rows. A new call is a new key; per-player changes are
// rows (selectors in WHO) or a roster row's `def.assign`. LB types belong to the LB AI
// (R-43 edits only the `lb` row and adds LB types). Row order decides: first match wins.
export const CALLS = Object.freeze({
  base: Object.freeze({
    name: 'Base',
    rows: Object.freeze([
      Object.freeze({ who: 'dl', type: 'attack', gap: 'fit' }),
      Object.freeze({ who: 'lb', type: 'readFlowFill' }),
    ]),
  }),
});

// selector name -> (player, front-read entry) => bool
export const WHO = Object.freeze({
  dl: (d, f) => DL_ROLES.includes(d.role),
  lb: (d, f) => LB_ROLES.includes(d.role),
});

// assignment type -> behaviour name
export const ASSIGNMENTS = Object.freeze({
  attack: Object.freeze({ behavior: 'attack' }),
  readFlowFill: Object.freeze({ behavior: 'readFlowFill' }),
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
export function pickAssign(rows, d, f) {
  const row = rows.find((r) => WHO[r.who](d, f));
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
    t: 0,
    carrierId,
    rb0: rb ? { x: rb.x, y: rb.y } : null,
    lineIds: front.line.map(({ id, n }) => ({ id, n })),
    line: {},
    agents: {},
    committed: {},
  };
  for (const l of front.line) {
    const p = players.find((q) => q.id === l.id);
    if (p) defense.line[l.id] = { x: p.x, y: p.y };
  }
  const checked = new Set();
  for (const f of front.defenders) {
    const d = players.find((p) => p.id === f.id);
    if (!d) continue;
    const assign = d.def?.assign ?? pickAssign(table.rows, d, f);
    if (assign && !Object.hasOwn(ASSIGNMENTS, assign.type)) throw new Error(`defense: unknown type "${assign.type}"`);
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
