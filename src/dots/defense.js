// Defender decisions as data: a behaviour is a small state machine whose states
// name a GOAL (where to run) and whose exits name TRIGGERS (when to change state).
// Pure: reads players, never moves them; blocking.js steers toward the goals.
// A blitz or drop is a new GOALS entry plus a state row; linebackers do not blitz today.
import { BODY_RADIUS } from './blocking.js';
import { A_GAP_HALF } from './numbering.js';
import { GAP_NAMES } from './front.js';

export const LB_READ_TIME = 0.45; // s, fallback when a player has no def.read
export const SHUFFLE = 0.3; // fraction of speed while reading
export const KEY_MOVE = BODY_RADIUS; // yd a line player must move to count as an OL-movement key
export const FLOW_MAX = 0.5; // s in flow before he must fill
export const FILL_DEPTH = 3 * BODY_RADIUS; // yd past the los where he fills

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function gapSpan(players, defense, fit) {
  const s = fit.side === 'play' ? 1 : -1;
  const i = GAP_NAMES.indexOf(fit.name);
  const lineX = (n) => {
    const entry = defense.lineIds.find((l) => l.n === n);
    const p = entry && players.find((q) => q.id === entry.id);
    return p ? p.x : null;
  };
  let prevWidth = 2 * A_GAP_HALF;
  let prevOuter = 0;
  let lo = 0;
  let hi = 0;
  for (let j = 0; j <= i; j++) {
    const innerX = lineX(s * j) ?? prevOuter;
    const outerX = lineX(s * (j + 1)) ?? innerX + s * defense.side * prevWidth;
    lo = Math.min(innerX, outerX);
    hi = Math.max(innerX, outerX);
    prevWidth = hi - lo;
    prevOuter = outerX;
  }
  return { lo, hi };
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
    const lo = span.lo + BODY_RADIUS;
    const hi = span.hi - BODY_RADIUS;
    const x = lo <= hi ? clamp(aimX(env), lo, hi) : (span.lo + span.hi) / 2;
    return { x, y: env.los + FILL_DEPTH };
  },
  ball: () => null, // no goal: blocking.js keeps today's ball pursuit
});

export const TRIGGERS = Object.freeze({
  recognized: (d, e, env) => env.defense.t >= e.read - 1e-9 && env.behavior.keys.some((k) => KEYS[k](env)),
  carrierPast: (d, e, env) => !!env.run?.carried && env.ballPos.y > env.los,
  committed: (d, e, env) => !!env.run?.locked || e.st >= FLOW_MAX - 1e-9,
  atFill: (d, e, env) => {
    const g = GOALS.fill(d, e, env);
    return Math.hypot(d.x - g.x, d.y - g.y) <= BODY_RADIUS;
  },
});

export const BEHAVIORS = Object.freeze({
  pursue: { start: 'pursue', keys: [], states: { pursue: { goal: 'ball', speed: 1, exits: [] } } },
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

// role -> behaviour name; roles not listed get no agent entry and keep today's pursuit.
export const CALLS = Object.freeze({ base: Object.freeze({ LB: 'readFlowFill' }) });

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

export function startDefense(players, front, { los, call = 'base', carrierId } = {}) {
  if (!Object.hasOwn(CALLS, call)) throw new Error(`defense: unknown call "${call}"`);
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
  };
  for (const l of front.line) {
    const p = players.find((q) => q.id === l.id);
    if (p) defense.line[l.id] = { x: p.x, y: p.y };
  }
  const checked = new Set();
  for (const f of front.defenders) {
    const d = players.find((p) => p.id === f.id);
    if (!d) continue;
    const name = d.def?.behavior ?? CALLS[call][d.role];
    if (!name) continue;
    if (!checked.has(name)) { validateBehavior(name); checked.add(name); }
    defense.agents[d.id] = {
      behavior: name,
      state: BEHAVIORS[name].start,
      st: 0,
      read: d.def?.read ?? LB_READ_TIME,
      x0: d.x,
      y0: d.y,
      fit: f.fit,
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
    if (g) out[id] = { x: g.x, y: g.y, key: 'def:' + e.state, rate: row.speed * d.speed };
  }
  return out;
}
