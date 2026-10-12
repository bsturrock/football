import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gapSpan, startDefense, stepDefense, validateBehavior, validateCall, validateRows, pickAssign, CALLS, WHO, ASSIGNMENTS, GOALS, TRIGGERS, BEHAVIORS,
  LB_READ_TIME, KEY_MOVE, READ_STEP, READ_STEP_DOWN, READ_SPEED, OVER_TOP, keyRead, FILL_DEPTH, ZONE_DEPTH, DROP_SPEED, PENETRATE_DEPTH, PURSUE_REACH, LEAD_MAX, intercept, CONTAIN_DEPTH, CONTAIN_WIDTH, CONTAIN_SPEED,
  MAN_ROLES, PERSONNEL_CALLS, moveFor, callFor, shiftGap, DL_RESPONSES, GETOFF_TIME, GETOFF_DEPTH, ARM_FREE, RUSH_DEPTH, LEVER_V, PURSUE_LEVER,
} from '../src/dots/defense.js';
import { createPlay } from '../src/dots/play.js';
import { readFront } from '../src/dots/front.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup } from '../src/dots/roster.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { LEVER_COS } from '../src/dots/react.js';
import { TACKLE_DIST } from '../src/dots/tackle.js';
import { frontPlayers, FRONT_NAMES, frontNumbers } from './fixtures/fronts.js';
import { BASE_LB_IDS } from './fixtures/base-front.js';

const LOS = 25;
const by = (pl, id) => pl.find((p) => p.id === id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const setup = (opts = {}) => {
  const players = buildLineup(LOS, 'insideZone').map((p) => ({ ...p }));
  const numbers = numberPlay(players, { los: LOS, centerId: 'C', playside: 'left' });
  const front = readFront(players, numbers, LOS);
  const defense = startDefense(players, front, { los: LOS, carrierId: 'RB', ...opts });
  const run = { carrier: 'RB', aim: { x: -2, y: LOS }, carried: false, locked: false };
  return { players, front, defense, run, ball: { x: 0, y: LOS - 3 } };
};
const step = (s, dt = 0.05) => stepDefense(s.players, s.defense, { run: s.run, ballPos: s.ball, cues: s.cues }, dt);
// Stub cues: every defender is lined on his nearest offensive lineman, feels `felt`, sees the ball at ball.
const nearestOL = (s, id) => s.players.filter((p) => p.team === 'offense' && p.role === 'OL').sort((a, b) => Math.abs(a.x - by(s.players, id).x) - Math.abs(b.x - by(s.players, id).x))[0];
const stubCues = (s, felt, ball = { x: 0, y: LOS, committed: false }) => {
  s.cues = (id) => (s.defense.agents[id] ? { felt, tech: { blocker: nearestOL(s, id).id, label: '3', shade: 'head' }, ball } : null);
  return s;
};

test('F-33/F-34: base call gives every DL an attack agent, LBs a zone agent in read (the LB read replaces the drop)', () => {
  for (const name of FRONT_NAMES) {
    const pl = frontPlayers(name).map((p) => ({ ...p }));
    const fr = readFront(pl, frontNumbers(pl), LOS);
    const df = startDefense(pl, fr, { los: LOS, carrierId: 'RB' });
    for (const p of pl) {
      if (fr.edge != null && p.id === fr.edge) {
        assert.equal(df.agents[p.id].behavior, 'contain', `${name} ${p.id}`);
        assert.equal(df.agents[p.id].assign.type, 'contain');
        assert.equal(df.agents[p.id].state, 'read');
      } else if (p.role === 'DE' || p.role === 'DT') {
        assert.equal(df.agents[p.id].behavior, 'attack', `${name} ${p.id}`);
        assert.equal(df.agents[p.id].assign.type, 'attack');
        assert.equal(df.agents[p.id].assign.gap, 'fit');
        assert.deepEqual(df.agents[p.id].fit, fr.defenders.find((f) => f.id === p.id).fit);
      } else if (p.role === 'LB') {
        assert.equal(df.agents[p.id].behavior, 'zone', `${name} ${p.id}`);
        assert.equal(df.agents[p.id].assign.type, 'zone');
        assert.equal(df.agents[p.id].assign.depth, ZONE_DEPTH);
        assert.equal(df.agents[p.id].state, 'read');
      }
    }
  }
  const s = setup();
  for (const id of BASE_LB_IDS) {
    assert.equal(s.defense.agents[id].state, 'read', id);
    assert.equal(s.defense.agents[id].read, by(s.players, id).def.read, id);
  }
  const p2 = buildLineup(LOS, 'insideZone').map((p) => ({ ...p, def: null }));
  const n2 = numberPlay(p2, { los: LOS, centerId: 'C', playside: 'left' });
  const d2 = startDefense(p2, readFront(p2, n2, LOS), { los: LOS, carrierId: 'RB' });
  assert.equal(d2.agents.WLB.read, LB_READ_TIME);
  assert.ok(Object.isFrozen(CALLS.base));
});

// LB cue stubs: every defender with an agent sees `cue` (key/hat/flow/ball merged over a quiet default).
const lbCue = (o = {}) => ({
  key: { id: 'LG', action: 'none', dir: 0 }, hat: 'none', flow: { kind: 'none', dir: 0 },
  ball: { x: 0, y: LOS, vx: 0, vy: 0, carried: false, past: false, committed: false }, ...o,
});
const stubLB = (s, o) => { s.cues = (id) => (s.defense.agents[id] ? lbCue(typeof o === 'function' ? o(id) : o) : null); return s; };
const RUN = { key: { id: 'LG', action: 'run', dir: 0 } };
const toState = (s, o, id = 'MLB') => { stubLB(s, o); step(s, by(s.players, id).def.read + 0.01); return s.defense.agents[id].state; };

test('F-58 #1: keyRead maps guard and triangle keys', () => {
  const k = (action, dir = 0) => ({ id: 'LG', action, dir });
  const f = (kind) => ({ kind, dir: 1 });
  for (const [a, want] of [['run', 'run'], ['pull', 'pull'], ['pass', 'pass'], ['none', null]]) {
    assert.equal(keyRead('guard', { key: k(a), hat: 'high', flow: f('fast') }), want, `guard ${a}`);
    assert.equal(keyRead(undefined, { key: k(a) }), want, `default ${a}`);
  }
  assert.equal(keyRead('guard', {}), null);
  assert.equal(keyRead('triangle', { key: k('pull'), hat: 'high', flow: f('slow') }), 'pull');
  assert.equal(keyRead('triangle', { key: k('none'), hat: 'high', flow: f('none') }), 'pass');
  assert.equal(keyRead('triangle', { key: k('pass'), hat: 'high', flow: f('none') }), 'pass');
  assert.equal(keyRead('triangle', { key: k('run'), hat: 'high', flow: f('slow') }), 'run');
  assert.equal(keyRead('triangle', { key: k('none'), hat: 'low', flow: f('slow') }), 'run');
  assert.equal(keyRead('triangle', { key: k('run'), hat: 'none', flow: f('fast') }), 'run');
  assert.equal(keyRead('triangle', { key: k('run'), hat: 'none', flow: f('none') }), null);
  assert.equal(keyRead('triangle', { key: k('none'), hat: 'low', flow: f('none') }), null);
  assert.equal(keyRead('triangle', { key: k('none'), hat: 'none', flow: f('slow') }), null);
});

test('F-58 #2: validateBehavior checks read exits', () => {
  const mk = (ex) => ({ b: { start: 'a', keys: [], states: { a: { goal: 'readStep', speed: 1, exits: [{ ...ex, to: 'a' }] } } } });
  validateBehavior('b', mk({ when: 'read', is: 'run', flow: 'fast', cover: 'zone' }));
  assert.throws(() => validateBehavior('b', mk({ when: 'read', is: 'sprint' })), /bad read/);
  assert.throws(() => validateBehavior('b', mk({ when: 'read', is: 'run', flow: 'quick' })), /flow/);
  assert.throws(() => validateBehavior('b', mk({ when: 'read', is: 'pass', cover: 'run' })), /cover/);
});

test('F-34 #2 (LB read): read-step goal at READ_SPEED, never deeper than y0; a pass read with zone cover drops to x0, los + depth at DROP_SPEED; def.assign depth replaces the default', () => {
  const s = setup();
  const mlb = by(s.players, 'MLB');
  stubLB(s, { flow: { kind: 'slow', dir: 1 } });
  const out = step(s, 0.01);
  near(out.MLB.x, mlb.x + READ_STEP);
  near(out.MLB.y, mlb.y - READ_STEP_DOWN);
  assert.ok(out.MLB.y <= mlb.y);
  near(out.MLB.rate, READ_SPEED * mlb.speed);
  assert.equal(out.MLB.key, 'def:read');
  const q = setup();
  stubLB(q, { flow: { kind: 'fast', dir: -5 } });
  near(step(q, 0.01).MLB.x, mlb.x - READ_STEP);
  const none = setup();
  stubLB(none, {});
  near(step(none, 0.01).MLB.x, mlb.x);
  const nocue = setup();
  assert.equal(step(nocue, 1).MLB.key, 'def:read');
  assert.equal(nocue.defense.agents.MLB.state, 'read');

  const p = setup();
  stubLB(p, { key: { id: 'LG', action: 'pass', dir: 0 } });
  step(p, by(p.players, 'MLB').def.read + 0.01);
  assert.equal(p.defense.agents.MLB.state, 'drop');
  const d = step(p, 0.01);
  near(d.MLB.x, mlb.x);
  near(d.MLB.y, LOS + ZONE_DEPTH);
  near(d.MLB.rate, DROP_SPEED * mlb.speed);
  assert.equal(d.MLB.key, 'def:drop');
  const t = setup();
  by(t.players, 'MLB').def = { ...by(t.players, 'MLB').def, assign: { type: 'zone', depth: 6, key: 'guard', cover: 'zone' } };
  const d6 = startDefense(t.players, t.front, { los: LOS, carrierId: 'RB' });
  assert.equal(d6.agents.MLB.assign.depth, 6);
  t.defense = d6;
  stubLB(t, { key: { id: 'LG', action: 'pass', dir: 0 } });
  step(t, 1);
  near(step(t, 0.01).MLB.y, LOS + 6);
  const u = setup();
  by(u.players, 'MLB').def = { ...by(u.players, 'MLB').def, assign: { type: 'zone' } };
  const d0 = startDefense(u.players, u.front, { los: LOS, carrierId: 'RB' });
  assert.equal(d0.agents.MLB.assign.depth, ZONE_DEPTH);
});

test('F-34 #3 (LB read): the key read moves read to a class state after def.read and not before', () => {
  const read = by(setup().players, 'MLB').def.read;
  const s = stubLB(setup(), { ...RUN, flow: { kind: 'slow', dir: 1 } });
  step(s, read - 0.1);
  assert.equal(s.defense.agents.MLB.state, 'read', 'before def.read');
  step(s, 0.2);
  assert.equal(s.defense.agents.MLB.state, 'fit', 'after def.read');
  assert.equal(s.defense.agents.MLB.why, 'read');
  const quiet = stubLB(setup(), {});
  step(quiet, 1);
  assert.equal(quiet.defense.agents.MLB.state, 'read', 'key says nothing');
  // Each class transition, one exit row each.
  assert.equal(toState(setup(), { ...RUN, flow: { kind: 'slow', dir: 1 } }), 'fit');
  assert.equal(toState(setup(), { ...RUN, flow: { kind: 'none', dir: 0 } }), 'fit');
  assert.equal(toState(setup(), { ...RUN, flow: { kind: 'fast', dir: 1 } }), 'scrape');
  assert.equal(toState(setup(), { ...RUN, flow: { kind: 'split', dir: 1 } }), 'split');
  assert.equal(toState(setup(), { key: { id: 'LG', action: 'pull', dir: 1 }, flow: { kind: 'slow', dir: -1 } }), 'scrape');
  assert.equal(toState(setup(), { key: { id: 'LG', action: 'pass', dir: 0 } }), 'drop');
  // A man call sends a pass read to man; the man is the offensive player of that role nearest his alignment.
  const m = setup();
  m.defense.agents.MLB.assign = { ...m.defense.agents.MLB.assign, cover: 'man', man: 'RB' };
  assert.equal(toState(m, { key: { id: 'LG', action: 'pass', dir: 0 } }), 'man');
  const out = step(m, 0.01);
  const rb = by(m.players, 'RB');
  assert.equal(m.defense.agents.MLB.manId, 'RB');
  near(out.MLB.x, rb.x);
  assert.ok(out.MLB.y >= LOS + 1 - 1e-9);
  // The triangle key reads the hat: high hat and no run is a pass.
  const tri = setup();
  tri.defense.agents.MLB.assign = { ...tri.defense.agents.MLB.assign, key: 'triangle' };
  assert.equal(toState(tri, { hat: 'high', key: { id: 'LG', action: 'none', dir: 0 } }), 'drop');
});

test('F-58 #4: the side rule: a play-side fit scrapes, a back-side fit fits his gap', () => {
  const read = (side) => {
    const s = setup();
    const e = s.defense.agents.MLB;
    e.fit = { side, name: 'A' };
    stubLB(s, { ...RUN, flow: { kind: 'split', dir: 1 }, ball: { x: 0, y: LOS, vx: 0, vy: 0, carried: true, past: false, committed: false } });
    step(s, e.read + 0.01);
    assert.equal(e.state, 'split');
    return { out: step(s, 0.01).MLB, s, e };
  };
  const play = read('play');
  near(play.out.x, 0 - OVER_TOP);
  const back = read('back');
  const span = gapSpan(back.s.players, back.s.defense, back.e.fit);
  assert.ok(back.out.x >= span.lo + BODY_RADIUS - 1e-9 && back.out.x <= span.hi - BODY_RADIUS + 1e-9);
  near(back.out.y, LOS + FILL_DEPTH);
});

test('F-58 #1: fit goal is the ball cue x inside his gap span at FILL_DEPTH; he holds fit until the ball commits', () => {
  assert.ok(FILL_DEPTH >= 3 && FILL_DEPTH <= 5);
  const s = setup();
  const sp = gapSpan(s.players, s.defense, s.defense.agents.MLB.fit);
  for (const bx of [sp.lo - 5, (sp.lo + sp.hi) / 2, sp.hi + 5]) {
    stubLB(s, { ...RUN, ball: { x: bx, y: LOS, vx: 0, vy: 0, carried: false, past: false, committed: false } });
    const g = GOALS.fitGap(by(s.players, 'MLB'), s.defense.agents.MLB, { players: s.players, defense: s.defense, los: LOS, cues: s.cues });
    assert.ok(g.x >= sp.lo + BODY_RADIUS - 1e-9 && g.x <= sp.hi - BODY_RADIUS + 1e-9, `${bx}`);
    near(g.y, LOS + FILL_DEPTH);
  }
  const t = stubLB(setup(), RUN);
  step(t, 1);
  const out = step(t, 0.01);
  assert.equal(t.defense.agents.MLB.state, 'fit');
  const mlb = by(t.players, 'MLB');
  mlb.x = out.MLB.x;
  mlb.y = out.MLB.y;
  // Rule now judged: at his fit with the ball uncommitted, carrier not past, no shed, he holds fit.
  step(t, 0.01);
  step(t, 0.01);
  assert.equal(t.defense.agents.MLB.state, 'fit');
  stubLB(t, { ...RUN, ball: { x: 0, y: LOS, vx: 0, vy: 0, carried: true, past: false, committed: true } });
  step(t, 0.01);
  assert.equal(t.defense.agents.MLB.state, 'pursue');
  assert.equal(t.defense.agents.MLB.why, 'ballCommitted');
  const pur = step(t, 0.01).MLB;
  // T-57 3a: pursue leads with the ball cue (spot and velocity of the holder), not the env ball spot.
  assert.deepEqual({ x: pur.x, y: pur.y }, intercept(mlb, { x: 0, y: LOS }, { x: 0, y: 0 }, mlb.speed));
});

test('F-58 #3: scrape goal is one OVER_TOP behind the ball against flow, no deeper than y0, never shallower than fill depth', () => {
  for (const dir of [-1, 1]) {
    const s = setup();
    const mlb = by(s.players, 'MLB');
    stubLB(s, { ...RUN, flow: { kind: 'fast', dir }, ball: { x: 3, y: LOS, vx: 0, vy: 0, carried: true, past: false, committed: false } });
    step(s, 1);
    assert.equal(s.defense.agents.MLB.state, 'scrape');
    const g = step(s, 0.01).MLB;
    near(g.x, 3 - dir * OVER_TOP);
    assert.ok(g.y <= mlb.y + 1e-9 && g.y >= LOS + FILL_DEPTH - 1e-9);
  }
  // A pull read scrapes with the guard's direction, not the flow's.
  const p = setup();
  stubLB(p, { key: { id: 'LG', action: 'pull', dir: -1 }, flow: { kind: 'slow', dir: 1 }, ball: { x: 3, y: LOS, vx: 0, vy: 0, carried: false, past: false, committed: false } });
  step(p, 1);
  near(step(p, 0.01).MLB.x, 3 + OVER_TOP);
});

test('F-58: a committed ball, the carrier past the line or a shed sends an LB in any state to pursue', () => {
  const shed = (s) => { by(s.players, 'LG').block = { target: 'MLB', engaged: false, released: 'shed', seq: null, angle: 'straight' }; };
  for (const st of ['read', 'fit', 'scrape', 'split', 'drop', 'man']) {
    const a = setup();
    a.defense.agents.MLB.state = st;
    shed(a);
    step(a);
    assert.equal(a.defense.agents.MLB.state, 'pursue', `shed ${st}`);
    const b = setup();
    b.defense.agents.MLB.state = st;
    stubLB(b, { ball: { x: 0, y: LOS, vx: 0, vy: 3, carried: true, past: false, committed: true } });
    step(b);
    assert.equal(b.defense.agents.MLB.state, 'pursue', `committed ${st}`);
    const c = setup();
    c.defense.agents.MLB.state = st;
    c.run.carried = true;
    c.ball = { x: 0, y: LOS + 1 };
    step(c);
    assert.equal(c.defense.agents.MLB.state, 'pursue', `past ${st}`);
  }
});

test('F-19 #3: gapSpan on the base lineup', () => {
  const s = setup();
  const x = (id) => by(s.players, id).x;
  let sp = gapSpan(s.players, s.defense, { side: 'play', name: 'A' });
  near(sp.lo, x('LG')); near(sp.hi, x('C'));
  sp = gapSpan(s.players, s.defense, { side: 'back', name: 'A' });
  near(sp.lo, x('C')); near(sp.hi, x('RG'));
  sp = gapSpan(s.players, s.defense, { side: 'play', name: 'C' });
  near(sp.hi, x('LT'));
  near(sp.lo, x('LT') - (x('LG') - x('LT')));
});

test('F-19 #3: unknown call, behaviour or bad names throw', () => {
  const players = buildLineup(LOS, 'insideZone').map((p) => ({ ...p }));
  const numbers = numberPlay(players, { los: LOS, centerId: 'C', playside: 'left' });
  const front = readFront(players, numbers, LOS);
  assert.throws(() => startDefense(players, front, { los: LOS, call: 'nope', carrierId: 'RB' }), /nope/);
  by(players, 'MLB').def = { behavior: 'missing' };
  assert.throws(() => startDefense(players, front, { los: LOS, carrierId: 'RB' }), /missing/);
  const mk = (row, keys = []) => ({ b: { start: 'a', keys, states: { a: row } } });
  assert.throws(() => validateBehavior('b', mk({ goal: 'zz', speed: 1, exits: [] }).b && { b: mk({ goal: 'zz', speed: 1, exits: [] }).b }), /zz/);
  assert.throws(() => validateBehavior('b', mk({ goal: 'ball', speed: 1, exits: [{ when: 'qq', to: 'a' }] }).b && { b: mk({ goal: 'ball', speed: 1, exits: [{ when: 'qq', to: 'a' }] }).b }), /qq/);
  assert.throws(() => validateBehavior('b', { b: mk({ goal: 'ball', speed: 1, exits: [{ when: 'atFill', to: 'x' }] }).b }), /exit target/);
  assert.throws(() => validateBehavior('b', { b: mk({ goal: 'ball', speed: 1, exits: [] }, ['kk']).b }), /kk/);
});

test('F-19 #9: fresh startDefense has empty committed', () => {
  const s = setup();
  assert.deepEqual(s.defense.committed, {});
});

// F-19 #9, restated for the LB read: committed is set when an LB leaves read (his start state).
test('F-19 #9: committed records the goal x and time a LB leaves read', () => {
  const s = stubLB(setup(), { ...RUN, flow: { kind: 'slow', dir: 1 } });
  step(s, 0.1);
  assert.equal(s.defense.agents.MLB.state, 'read');
  assert.ok(!('MLB' in s.defense.committed));
  step(s, 0.5);
  assert.equal(s.defense.agents.MLB.state, 'fit');
  assert.equal(s.defense.agents.WLB.state, 'fit');
  const env = { players: s.players, defense: s.defense, run: s.run, ballPos: s.ball, los: LOS, cues: s.cues };
  near(s.defense.committed.MLB.x, GOALS.fitGap(by(s.players, 'MLB'), s.defense.agents.MLB, env).x);
  assert.ok(s.defense.committed.MLB.t > 0.1 && s.defense.committed.MLB.t <= s.defense.t);
  assert.ok('WLB' in s.defense.committed);
});

test('F-19 #9: committed entry never changes once set', () => {
  const s = stubLB(setup(), { ...RUN, flow: { kind: 'slow', dir: 1 } });
  step(s, 0.1);
  step(s, 0.5);
  const first = { ...s.defense.committed.MLB };
  s.cues = (id) => (s.defense.agents[id] ? lbCue({ ...RUN, ball: { x: first.x + 5, y: LOS, vx: 0, vy: 0, carried: false, past: false, committed: false } }) : null);
  step(s);
  s.run.locked = true;
  step(s);
  s.ball = { x: 0, y: LOS + 1 };
  step(s);
  near(s.defense.committed.MLB.x, first.x);
  near(s.defense.committed.MLB.t, first.t);
});

test('F-19 #9: committed holds only agents that left their start state', () => {
  const s = stubLB(setup(), { ...RUN, flow: { kind: 'slow', dir: 1 } });
  step(s, 0.1);
  assert.deepEqual(s.defense.committed, {});
  step(s, 0.5);
  step(s, 1);
  for (const id of Object.keys(s.defense.committed)) {
    assert.ok(id in s.defense.agents, id);
    const e = s.defense.agents[id];
    assert.notEqual(e.state, BEHAVIORS[e.behavior].start, id);
  }
  assert.ok('MLB' in s.defense.committed);
});

test('F-33: row order decides, first match wins; no row -> no agent', () => {
  const s = setup();
  const f = s.front.defenders.find((x) => x.id === 'LDE');
  const lde = by(s.players, 'LDE');
  const mlb = by(s.players, 'MLB');
  const rows = [{ who: 'lb', type: 'attack' }, { who: 'lb', type: 'zone' }, { who: 'dl', type: 'zone' }];
  assert.deepEqual(pickAssign(rows, mlb, f), { type: 'attack' });
  assert.deepEqual(pickAssign(rows, lde, f), { type: 'zone' });
  assert.equal(pickAssign([{ who: 'dl', type: 'attack' }], mlb, f), null);
  assert.ok(WHO.dl(lde, f) && !WHO.lb(lde, f));
  const base = startDefense(s.players, s.front, { los: LOS, carrierId: 'RB' });
  assert.equal(base.agents.MLB.behavior, 'zone');
  assert.equal(base.agents[s.front.edge].behavior, 'contain');
  assert.equal(base.agents.LDT.behavior, 'attack');
  assert.ok(!('QB' in base.agents) && !('RB' in base.agents));
});

test('F-33: def.assign overrides the row; explicit gap moves the penetrate goal', () => {
  const s = setup();
  const gap = { side: 'back', name: 'A' };
  by(s.players, 'LDE').def = { assign: { type: 'attack', gap } };
  const d = startDefense(s.players, s.front, { los: LOS, carrierId: 'RB' });
  assert.deepEqual(d.agents.LDE.fit, gap);
  const span = gapSpan(s.players, d, gap);
  const out = stepDefense(s.players, d, { run: s.run, ballPos: s.ball }, 0.01);
  assert.ok(out.LDE.x >= span.lo && out.LDE.x <= span.hi, 'the goal lies in the explicit gap');
  near(GOALS.penetrate(by(s.players, 'LDE'), d.agents.LDE, { players: s.players, defense: d, run: s.run, ballPos: s.ball, los: LOS }).x, (span.lo + span.hi) / 2);
  by(s.players, 'LDT').def = { assign: { type: 'zone' } };
  const d2 = startDefense(s.players, s.front, { los: LOS, carrierId: 'RB' });
  assert.equal(d2.agents.LDT.behavior, 'zone');
});

test('F-33: validateCall and startDefense throw on unknown who/type', () => {
  validateCall('base');
  assert.throws(() => validateCall('zz'), /zz/);
  assert.throws(() => validateRows('x', [{ who: 'qq', type: 'attack' }]), /qq/);
  assert.throws(() => validateRows('x', [{ who: 'dl', type: 'tt' }]), /tt/);
  assert.throws(() => setup({ call: 'zz' }), /zz/);
  const s = setup();
  by(s.players, 'LDE').def = { assign: { type: 'tt' } };
  assert.throws(() => startDefense(s.players, s.front, { los: LOS, carrierId: 'RB' }), /tt/);
  assert.deepEqual(Object.keys(ASSIGNMENTS).sort(), ['attack', 'contain', 'zone']);
});

test('F-33: penetrate and gapFit goals', () => {
  const s = setup();
  const e = s.defense.agents.LDT;
  const env = { players: s.players, defense: s.defense, run: s.run, ballPos: s.ball, los: LOS };
  const span = gapSpan(s.players, s.defense, e.fit);
  const g = GOALS.penetrate(by(s.players, 'LDT'), e, env);
  near(g.x, (span.lo + span.hi) / 2);
  near(g.y, LOS - PENETRATE_DEPTH);
  const lo = span.lo + BODY_RADIUS;
  const hi = span.hi - BODY_RADIUS;
  s.run.aim.x = span.lo - 5;
  near(GOALS.gapFit(null, e, env).x, lo);
  s.run.aim.x = span.hi + 5;
  near(GOALS.gapFit(null, e, env).x, hi);
  s.run.aim.x = (lo + hi) / 2;
  near(GOALS.gapFit(null, e, env).x, (lo + hi) / 2);
  near(GOALS.gapFit(null, e, env).y, LOS - PENETRATE_DEPTH);
  // shrunk span: both OL close together
  const a = { ...e, fit: { side: 'play', name: 'A' } };
  by(s.players, 'C').x = by(s.players, 'LG').x + BODY_RADIUS;
  const sp = gapSpan(s.players, s.defense, a.fit);
  const gg = GOALS.gapFit(null, a, env);
  near(gg.x, (sp.lo + sp.hi) / 2);
  // no span: fall back to x0
  const nofit = { ...e, fit: { side: 'play', name: 'A' } };
  s.defense.lineIds = [];
  const ng = GOALS.penetrate(null, nofit, { ...env, defense: s.defense });
  assert.ok(Number.isFinite(ng.x));
});

test('F-33: ballClose and attack exits', () => {
  const s = setup();
  const d = by(s.players, 'LDT');
  const e = s.defense.agents.LDT;
  const env = { players: s.players, defense: s.defense, run: s.run, ballPos: { x: d.x, y: d.y - PURSUE_REACH + 0.01 }, los: LOS };
  assert.equal(TRIGGERS.ballClose(d, e, env), false); // not carried
  s.run.carried = true;
  assert.equal(TRIGGERS.ballClose(d, e, env), true);
  assert.equal(TRIGGERS.ballClose(d, e, { ...env, ballPos: { x: d.x, y: d.y - PURSUE_REACH - 0.01 } }), false);

  // recognized only after read
  const t = setup();
  by(t.players, 'LG').x += KEY_MOVE;
  step(t, 0.01);
  assert.equal(t.defense.agents.LDT.state, 'getoff');
  stubCues(t, 'base');
  step(t, 0.01);
  assert.equal(t.defense.agents.LDT.state, 'hold'); // getoff -> response on felt
  const t2 = stubCues(setup(), 'none');
  step(t2, 0.01);
  assert.equal(t2.defense.agents.LDT.state, 'getoff'); // nothing felt: not before GETOFF_TIME
  step(t2, GETOFF_TIME);
  assert.equal(t2.defense.agents.LDT.state, 'squeeze');
  // pursue beats fit
  const u = setup();
  by(u.players, 'LG').x += KEY_MOVE;
  u.run.carried = true;
  u.ball = { x: 0, y: LOS + 1 };
  step(u, 1);
  assert.equal(u.defense.agents.LDT.state, 'pursue');
  const v = setup();
  by(v.players, 'LG').x += KEY_MOVE;
  v.run.carried = true;
  v.ball = { x: by(v.players, 'LDT').x, y: LOS - 1 };
  step(v, 1);
  assert.equal(v.defense.agents.LDT.state, 'pursue');
});

test('F-33 #4/#8: a shed blocker sends his DL to pursue from getoff or a response state', () => {
  const dlOf = (s) => Object.keys(s.defense.agents).find((id) => s.defense.agents[id].behavior === 'attack');
  const shed = (s, id, released = 'shed') => {
    by(s.players, 'LG').block = { target: id, engaged: false, released, seq: null, angle: 'straight' };
  };

  const s = setup();
  const dlId = dlOf(s);
  assert.ok(dlId);
  step(s);
  assert.notEqual(s.defense.agents[dlId].state, 'pursue');

  const a = setup();
  const aId = dlOf(a);
  shed(a, aId);
  step(a);
  assert.equal(a.defense.agents[aId].state, 'pursue');
  const pa = step(a)[aId];
  assert.ok(pa);
  assert.equal(pa.key, 'def:pursue');
  const ea = intercept(by(a.players, aId), a.ball, a.defense.ballV, by(a.players, aId).speed);
  near(pa.x, ea.x);
  near(pa.y, ea.y);

  const f = setup();
  const fId = dlOf(f);
  f.defense.agents[fId].state = 'hold';
  shed(f, fId);
  step(f);
  assert.equal(f.defense.agents[fId].state, 'pursue');
  const pf = step(f)[fId];
  assert.ok(pf);
  assert.equal(pf.key, 'def:pursue');
  const ef = intercept(by(f.players, fId), f.ball, f.defense.ballV, by(f.players, fId).speed);
  near(pf.x, ef.x);
  near(pf.y, ef.y);

  for (const released of ['lost', 'past']) {
    const u = setup();
    const uId = dlOf(u);
    shed(u, uId, released);
    step(u);
    assert.notEqual(u.defense.agents[uId].state, 'pursue', released);
  }

  assert.equal(TRIGGERS.shed(by(s.players, 'LDT'), s.defense.agents.LDT, { players: s.players }), false);
  assert.doesNotThrow(() => validateBehavior('attack'));
});

test('F-34 #7: intercept leads a crossing carrier, returns a still ball, caps at LEAD_MAX', () => {
  const ball = { x: 0, y: 30 };
  const lead = intercept({ x: 5, y: 30 }, ball, { x: 0, y: 6 }, 7.5);
  assert.ok(lead.y > ball.y);
  near(lead.x, 0);
  assert.deepEqual(intercept({ x: 5, y: 30 }, ball, { x: 0, y: 0 }, 7.5), ball);
  const away = intercept({ x: 0, y: 20 }, ball, { x: 0, y: 9 }, 7.5);
  near(away.y, ball.y + 9 * LEAD_MAX);
  near(away.x, 0);
  const eq = intercept({ x: 0, y: 20 }, ball, { x: 0, y: 7.5 }, 7.5);
  near(eq.y, ball.y + 7.5 * LEAD_MAX);
});

test('T-135: intercept leads a close pursuer no longer than his time to the ball', () => {
  const ball = { x: 0, y: 30 };
  const pursuer = { x: 1, y: 30 };
  const speed = 7.5;
  const dist = 1;
  const a = intercept(pursuer, ball, { x: 0, y: 7.4 }, speed);
  const b = intercept(pursuer, ball, { x: 0, y: 7.6 }, speed);
  const reachA = Math.hypot(a.x - ball.x, a.y - ball.y);
  const reachB = Math.hypot(b.x - ball.x, b.y - ball.y);
  assert.ok(reachA <= 7.4 * (dist / speed) + 1e-9);
  assert.ok(reachB <= 7.6 * (dist / speed) + 1e-9);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.1);
  const far = intercept({ x: 0, y: 20 }, ball, { x: 0, y: 9 }, speed);
  near(far.y, ball.y + 9 * LEAD_MAX);
  near(far.x, 0);
  const still = intercept(pursuer, ball, { x: 0, y: 7.6 }, 0);
  assert.ok(Number.isFinite(still.x) && Number.isFinite(still.y));
});

test('F-34 #7: a chase from the side reaches TACKLE_DIST in fewer ticks with intercept than with the carrier spot', () => {
  const run = (lead) => {
    const dt = 1 / 60;
    const d = { x: 8, y: 10 };
    let c = 10;
    for (let i = 1; i < 2000; i++) {
      const g = lead ? intercept(d, { x: 0, y: c }, { x: 0, y: 6 }, 7.5) : { x: 0, y: c };
      const dist = Math.hypot(g.x - d.x, g.y - d.y);
      const k = dist > 0 ? Math.min(7.5 * dt, dist) / dist : 0;
      d.x += (g.x - d.x) * k;
      d.y += (g.y - d.y) * k;
      c += 6 * dt;
      if (Math.hypot(d.x, d.y - c) <= TACKLE_DIST) return i;
    }
    return Infinity;
  };
  assert.ok(run(true) < run(false));
});

test('F-34 #7: stepDefense records ballV from consecutive ball positions; LB pursue goal is intercept', () => {
  const s = setup();
  step(s);
  assert.deepEqual(s.defense.ballV, { x: 0, y: 0 });
  s.ball = { x: 1, y: LOS - 3 + 0.3 };
  step(s, 0.05);
  near(s.defense.ballV.x, 20 * 1);
  near(s.defense.ballV.y, 6);
  const mlb = by(s.players, 'MLB');
  const e = s.defense.agents.MLB;
  e.state = 'pursue';
  const out = step(s, 0.05);
  const want = intercept(mlb, s.ball, s.defense.ballV, mlb.speed);
  assert.ok(out.MLB);
  near(out.MLB.x, want.x);
  near(out.MLB.y, want.y);
});

// F-38: the backside edge keeps contain.
const cx = (s) => {
  const end = by(s.players, s.front.line[s.front.line.length - 1].id);
  return end.x - s.front.side * CONTAIN_WIDTH;
};
const toSqueeze = (s) => {
  by(s.players, 'LG').y += KEY_MOVE;
  step(s, s.defense.agents[s.front.edge].read);
  assert.equal(s.defense.agents[s.front.edge].state, 'squeeze');
};

test('F-38: WHO.edge matches only the edge; pickAssign with and without front; contain validates', () => {
  const s = setup();
  assert.ok(s.front.edge != null);
  for (const f of s.front.defenders) {
    const d = by(s.players, f.id);
    assert.equal(WHO.edge(d, f, s.front), f.id === s.front.edge, f.id);
    assert.equal(WHO.edge(d, f), false);
  }
  const rows = CALLS.base.rows;
  const edge = by(s.players, s.front.edge);
  const f = s.front.defenders.find((x) => x.id === s.front.edge);
  assert.deepEqual(pickAssign(rows, edge, f, s.front), { type: 'contain', fit: 'box' });
  assert.notEqual(pickAssign(rows, edge, f).type, 'contain');
  validateBehavior('contain');
});

test('F-38: edge holds his alignment at CONTAIN_SPEED before the read, then squeezes to the contain point', () => {
  const s = setup();
  const id = s.front.edge;
  const d = by(s.players, id);
  const out = step(s, 0.01);
  near(out[id].x, d.x);
  near(out[id].y, d.y);
  near(out[id].rate, CONTAIN_SPEED * d.speed);
  assert.equal(out[id].key, 'def:read');
  by(s.players, 'LG').y += KEY_MOVE;
  const o2 = step(s, s.defense.agents[id].read);
  assert.equal(s.defense.agents[id].state, 'squeeze');
  near(o2[id].x, cx(s));
  near(o2[id].y, LOS - CONTAIN_DEPTH);
  near(o2[id].rate, CONTAIN_SPEED * d.speed);
  const endId = s.front.line[s.front.line.length - 1].id;
  by(s.players, endId).x += 0.7;
  near(step(s, 0.01)[id].x, cx(s));
  near(cx(s), o2[id].x + 0.7);
});

test('F-38: edge pursues from read and squeeze on the listed triggers, else stays', () => {
  const edgeOf = (s) => s.defense.agents[s.front.edge];
  const fresh = (state) => {
    const s = setup();
    if (state === 'squeeze') toSqueeze(s);
    return s;
  };
  for (const state of ['read', 'squeeze']) {
    // ball outside the contain x
    let s = fresh(state);
    s.ball = { x: cx(s) - s.front.side * 1, y: LOS - 3 };
    step(s, 0.01);
    assert.equal(edgeOf(s).state, 'pursue', `${state} outside`);
    // carried ball past the los
    s = fresh(state);
    s.run.carried = true;
    s.ball = { x: cx(s) + s.front.side * 1, y: LOS + 1 };
    step(s, 0.01);
    assert.equal(edgeOf(s).state, 'pursue', `${state} past`);
    // RB committed playside of center
    s = fresh(state);
    s.run.locked = true;
    s.run.x = s.front.centerX + s.front.side * 2;
    step(s, 0.01);
    assert.equal(edgeOf(s).state, 'pursue', `${state} committed playside`);
    // RB committed backside of center
    s = fresh(state);
    s.run.locked = true;
    s.run.x = s.front.centerX - s.front.side * 2;
    step(s, 0.01);
    assert.equal(edgeOf(s).state, state, `${state} committed backside`);
  }
  const near0 = (s) => {
    const d = by(s.players, s.front.edge);
    return { x: cx(s) + s.front.side * 1, y: d.y };
  };
  let s = fresh('squeeze');
  s.run.carried = true;
  s.ball = near0(s);
  const d = by(s.players, s.front.edge);
  assert.ok(Math.hypot(s.ball.x - d.x, s.ball.y - d.y) <= PURSUE_REACH);
  step(s, 0.01);
  assert.equal(edgeOf(s).state, 'pursue', 'carried within reach');
  s = fresh('squeeze');
  s.ball = near0(s);
  step(s, 0.01);
  assert.equal(edgeOf(s).state, 'squeeze', 'uncarried within reach');
  s = fresh('squeeze');
  s.run.carried = true;
  s.ball = { x: cx(s) + s.front.side * (PURSUE_REACH + 3), y: LOS - 3 };
  step(s, 0.01);
  assert.equal(edgeOf(s).state, 'squeeze', 'carried far');
});

test('F-43 #2: the get-off aim is the live gap middle, also while the gap moves', () => {
  const s = setup();
  const dlId = Object.keys(s.defense.agents).find((id) => s.defense.agents[id].behavior === 'attack');
  const e = s.defense.agents[dlId];
  const d = by(s.players, dlId);
  const env = () => ({ players: s.players, defense: s.defense, run: s.run, ballPos: s.ball, los: LOS });
  const mid = () => { const sp = gapSpan(s.players, s.defense, e.fit); return (sp.lo + sp.hi) / 2; };
  s.defense.t = 1;
  let g = GOALS.penetrate(d, e, env());
  near(g.x, mid());
  near(g.y, LOS - PENETRATE_DEPTH);
  s.defense.t = 1.05;
  g = GOALS.penetrate(d, e, env());
  near(g.x, mid());
  near(g.y, LOS - PENETRATE_DEPTH);
  for (const { id } of s.defense.lineIds) by(s.players, id).x += 0.2;
  s.defense.t = 1.1;
  g = GOALS.penetrate(d, e, env());
  near(g.x, mid());
  near(g.y, LOS - PENETRATE_DEPTH);
});

test('T-48 #1: validateCall accepts every CALLS key; bad row fields and man values throw', () => {
  for (const k of Object.keys(CALLS)) validateCall(k);
  const ok = { who: 'lb', type: 'zone', key: 'triangle', fit: 'spill', cover: 'man', man: 'WR', technique: 'twoGap', blitz: false, slant: 'back' };
  validateRows('t', [ok]);
  validateRows('t', [{ who: 'dl', type: 'attack' }]);
  for (const [field, value] of [['key', 'x'], ['fit', 'x'], ['cover', 'x'], ['technique', 'x'], ['slant', 'x'], ['blitz', 'yes'], ['man', 'QB']]) {
    assert.throws(() => validateRows('t', [{ who: 'dl', type: 'attack', [field]: value }]), new RegExp(`bad ${field} "${value}"`), field);
  }
  assert.throws(() => validateRows('t', [{ who: 'lb', type: 'zone', cover: 'man' }]), /bad man/);
  assert.throws(() => validateRows('t', [{ who: 'lb', type: 'zone', cover: 'man', man: 'DE' }]), /bad man/);
  for (const r of MAN_ROLES) validateRows('t', [{ who: 'lb', type: 'zone', cover: 'man', man: r }]);
  assert.deepEqual(MAN_ROLES, ['RB', 'TE', 'FB', 'WR']);
});

test('T-48 #2: startDefense with each call sends every row field to assign', () => {
  for (const key of Object.keys(CALLS)) {
    const s = setup({ call: key });
    for (const f of s.front.defenders) {
      const d = by(s.players, f.id);
      const row = CALLS[key].rows.find((r) => WHO[r.who](d, f, s.front, s.players));
      if (!row || !s.defense.agents[f.id]) continue;
      const { who, ...rest } = row;
      assert.deepEqual(s.defense.agents[f.id].assign, rest, `${key} ${f.id}`);
    }
  }
  const n = setup({ call: 'nickel' });
  const playLB = n.front.defenders.find((f) => WHO.playLB(by(n.players, f.id), f, n.front, n.players));
  const backLB = n.front.defenders.find((f) => WHO.backLB(by(n.players, f.id), f, n.front, n.players));
  assert.ok(playLB && backLB, 'nickel front has a playside and a backside LB');
  assert.equal(n.defense.agents[playLB.id].assign.key, 'guard');
  assert.equal(n.defense.agents[backLB.id].assign.key, 'triangle');
  assert.equal(n.defense.agents[playLB.id].assign.cover, 'zone');
  assert.equal(n.defense.call, 'nickel');
});

test('T-48 #3: blitz call makes the playside LB blitz from the snap; a script still wins', () => {
  const p = createPlay(LOS, 'insideZone', { call: 'blitz' });
  p.snap();
  const id = Object.keys(p.defense.agents).find((k) => p.defense.agents[k].assign?.blitz === true);
  assert.ok(id, 'a blitz agent exists');
  assert.equal(p.defense.agents[id].behavior, 'blitz');
  assert.equal(p.defense.agents[id].assign.cover, 'run');
  p.step(1 / 60);
  assert.equal(p.defense.agents[id].state, 'blitz');
  const q = createPlay(LOS, 'insideZone', { call: 'blitz', script: 'lbSits' });
  q.snap();
  assert.equal(q.defense.agents[id].behavior, 'sit', 'script row overrides the call flag');
  q.step(1 / 60);
  assert.equal(q.defense.agents[id].state, 'sit');
});

test('T-48 #4: slant call sends each non-edge DL on a slant playside, fit shifted one gap', () => {
  const s = setup({ call: 'slant' });
  let n = 0;
  for (const f of s.front.defenders) {
    const d = by(s.players, f.id);
    if (!WHO.dl(d, f) || f.id === s.front.edge) continue;
    const e = s.defense.agents[f.id];
    assert.equal(e.behavior, 'slant', f.id);
    assert.deepEqual(e.fit, shiftGap(f.fit, 'play'), f.id);
    assert.equal(e.at, 0, f.id);
    n++;
  }
  assert.ok(n > 0, 'the front has non-edge DL');
  assert.equal(s.defense.agents[s.front.edge].behavior, 'contain');
});

test('T-48 #5: callFor and PERSONNEL_CALLS: nickel personnel plays nickel, others and null play base', () => {
  assert.equal(callFor('nickel'), 'nickel');
  assert.equal(callFor('base11'), 'base');
  assert.equal(callFor(null), 'base');
  assert.equal(callFor(undefined), 'base');
  assert.equal(callFor('constructor'), 'base');
  assert.deepEqual(PERSONNEL_CALLS, { nickel: 'nickel' });
});

test('T-48 #6: createPlay call defaults, explicit call, setCall presnap only, unknown call throws', () => {
  assert.equal(createPlay(LOS, 'insideZone', { formation: '11' }).currentCall(), 'nickel');
  assert.equal(createPlay(LOS, 'insideZone', { defPersonnel: 'base11' }).currentCall(), 'base');
  assert.equal(createPlay(LOS, 'insideZone').currentCall(), 'base');
  assert.equal(createPlay(LOS, 'insideZone', { formation: '11', call: 'twoGap' }).currentCall(), 'twoGap');
  assert.throws(() => createPlay(LOS, 'insideZone', { call: 'zz' }), /unknown call/);
  const p = createPlay(LOS, 'insideZone', { formation: '11' });
  assert.equal(p.setCall('blitz'), 'blitz');
  assert.equal(p.currentCall(), 'blitz');
  assert.equal(p.setCall('zz'), false);
  assert.equal(p.currentCall(), 'blitz', 'an unknown key changes nothing');
  assert.equal(p.setCall(null), null);
  assert.equal(p.currentCall(), 'nickel');
  p.snap();
  assert.equal(p.setCall('base'), false, 'no change after the snap');
  assert.equal(p.currentCall(), 'nickel');
  assert.equal(p.defense.call, p.currentCall());
});

test('T-48 #7: stepDefense runs with and without cues; every CALLS key snaps and steps 120 ticks', () => {
  const s = setup();
  const withCues = stepDefense(s.players, s.defense, { run: s.run, ballPos: s.ball, cues: () => null }, 0.05);
  const without = stepDefense(s.players, s.defense, { run: s.run, ballPos: s.ball }, 0.05);
  assert.deepEqual(Object.keys(withCues).sort(), Object.keys(without).sort());
  for (const call of Object.keys(CALLS)) {
    const p = createPlay(LOS, 'insideZone', { call });
    p.snap();
    for (let i = 0; i < 120; i++) p.step(1 / 60);
    assert.equal(p.defense.call, call);
  }
});

// F-56: the DL read as data.
const goalOf = (s, id, name, extra = {}) => GOALS[name](by(s.players, id), s.defense.agents[id], { players: s.players, defense: s.defense, run: s.run, ballPos: s.ball, los: LOS, cues: s.cues, ...extra });

test('F-56: each felt value moves a DL in getoff to its DL_RESPONSES state', () => {
  assert.ok(Object.isFrozen(DL_RESPONSES));
  for (const [felt, to] of Object.entries(DL_RESPONSES)) {
    const s = stubCues(setup(), felt);
    step(s, 0.01);
    assert.equal(s.defense.agents.LDT.state, to, felt);
    assert.equal(s.defense.agents.LDT.why, 'felt');
  }
});

test('F-56 #5: getoff aims at the gap-side shoulder of his blocker, not the gap centre', () => {
  const s = stubCues(setup(), 'none');
  step(s, 0.01);
  const e = s.defense.agents.LDT;
  const b = nearestOL(s, 'LDT');
  assert.equal(e.blocker, b.id);
  const span = gapSpan(s.players, s.defense, e.fit);
  const gs = Math.sign((span.lo + span.hi) / 2 - b.x);
  assert.notEqual(gs, 0);
  const g = goalOf(s, 'LDT', 'getoff');
  near(g.x, b.x + gs * BODY_RADIUS);
  near(g.y, LOS - GETOFF_DEPTH);
  assert.ok(Math.abs(g.x - (span.lo + span.hi) / 2) > 1e-6);
  // hold keeps the shoulder and goes through the blocker
  const h = goalOf(s, 'LDT', 'holdGap');
  near(h.x, g.x);
  near(h.y, LOS - PENETRATE_DEPTH);
  // without a blocker: today's gapFit
  const n = setup();
  const gn = goalOf(n, 'LDT', 'getoff');
  near(gn.x, goalOf(n, 'LDT', 'gapFit').x);
});

test('F-56 #6: outsideArm stays playside of the blocker, anchor goes straight, close stays in his span', () => {
  const s = stubCues(setup(), 'none');
  step(s, 0.01);
  const b = nearestOL(s, 'LDT');
  const d = by(s.players, 'LDT');
  const oa = goalOf(s, 'LDT', 'outsideArm');
  near(oa.x, b.x + s.defense.side * ARM_FREE);
  near(oa.y, LOS - PENETRATE_DEPTH);
  const an = goalOf(s, 'LDT', 'anchor');
  near(an.x, d.x);
  near(an.y, LOS - PENETRATE_DEPTH);
  const span = gapSpan(s.players, s.defense, s.defense.agents.LDT.fit);
  for (const fit of ['spill', 'box']) {
    s.defense.agents.LDT.assign = { ...s.defense.agents.LDT.assign, fit };
    const c = goalOf(s, 'LDT', 'close');
    assert.ok(c.x >= span.lo && c.x <= span.hi, `close inside his span (${fit})`);
    const inner = Math.abs(span.lo - s.defense.centerX) <= Math.abs(span.hi - s.defense.centerX) ? span.lo + BODY_RADIUS : span.hi - BODY_RADIUS;
    near(c.x, inner);
    near(c.y, fit === 'spill' ? LOS - PENETRATE_DEPTH : LOS);
  }
  const r = goalOf(s, 'LDT', 'rush');
  near(r.x, (span.lo + span.hi) / 2);
  near(r.y, LOS - RUSH_DEPTH);
});

test('F-56 #7: hold, outsideArm and anchor keep him on his blocker (no early lever)', () => {
  for (const goal of ['holdGap', 'outsideArm', 'anchor']) {
    for (const id of ['LDT', 'RDT']) {
      const s = stubCues(setup(), 'none');
      step(s, 0.01);
      const d = by(s.players, id);
      const b = nearestOL(s, id);
      const g0 = goalOf(s, id, goal);
      const gx = g0.x - d.x;
      const gy = g0.y - d.y;
      const gl = Math.hypot(gx, gy);
      const ux = b.x - d.x;
      const uy = b.y - d.y;
      const ul = Math.hypot(ux, uy);
      assert.ok((gx * ux + gy * uy) / (gl * ul) > LEVER_COS, `${goal} ${id}`);
    }
  }
});

test('F-56: nothing felt after GETOFF_TIME squeezes; response states squeeze on none', () => {
  const s = stubCues(setup(), 'none');
  step(s, GETOFF_TIME / 2);
  assert.equal(s.defense.agents.LDT.state, 'getoff');
  step(s, GETOFF_TIME);
  assert.equal(s.defense.agents.LDT.state, 'squeeze');
  for (const state of Object.values(DL_RESPONSES)) {
    const t = stubCues(setup(), 'none');
    step(t, 0.01);
    t.defense.agents.LDT.state = state;
    step(t, 0.01);
    assert.equal(t.defense.agents.LDT.state, 'squeeze', state);
  }
  // squeeze takes the felt exits; an exit to the current state is skipped (no st reset)
  const u = stubCues(setup(), 'base');
  step(u, 0.01);
  const st = u.defense.agents.LDT.st;
  step(u, 0.01);
  assert.equal(u.defense.agents.LDT.state, 'hold');
  assert.ok(u.defense.agents.LDT.st > st);
  u.cues = stubCues(setup(), 'double').cues;
  u.defense.agents.LDT.state = 'squeeze';
  step(u, 0.01);
  assert.equal(u.defense.agents.LDT.state, 'anchor');
  // pursue exits come first
  const v = stubCues(setup(), 'double');
  by(v.players, 'LG').block = { target: 'LDT', engaged: false, released: 'shed', seq: null, angle: 'straight' };
  step(v, 0.01);
  assert.equal(v.defense.agents.LDT.state, 'pursue');
});

test('F-56 #8: a two-gap DL controls his blocker head-up, then takes the ball side on commit', () => {
  const s = setup({ call: 'twoGap' });
  assert.equal(s.defense.agents.LDT.behavior, 'twoGap');
  assert.equal(s.defense.agents.LDT.assign.type, 'attack');
  assert.equal(s.defense.agents.LDT.state, 'control');
  stubCues(s, 'base');
  step(s, 0.01);
  const b = nearestOL(s, 'LDT');
  assert.equal(s.defense.agents.LDT.state, 'control');
  const c = goalOf(s, 'LDT', 'control');
  near(c.x, b.x);
  near(c.y, LOS - PENETRATE_DEPTH);
  for (const side of [-1, 1]) {
    const t = setup({ call: 'twoGap' });
    stubCues(t, 'base', { x: nearestOL(t, 'LDT').x + side * 3, y: LOS, committed: true });
    step(t, 0.01);
    assert.equal(t.defense.agents.LDT.state, 'twoGapFit');
    const f = goalOf(t, 'LDT', 'twoGapFit');
    near(f.x, nearestOL(t, 'LDT').x + side * ARM_FREE);
    near(f.y, LOS);
  }
});

test('F-56: validateBehavior rejects a felt exit with an unknown value', () => {
  const bad = { x: { start: 'a', keys: [], states: { a: { goal: 'hold', speed: 1, exits: [{ when: 'felt', is: 'sideways', to: 'a' }] } } } };
  assert.throws(() => validateBehavior('x', bad), /sideways/);
  assert.doesNotThrow(() => validateBehavior('twoGap'));
});

// T-57 (F-58 #5, #6, #7, #12): take on a climber, DLs shed on commit, pursuit inside-out off the ball cue.
const envOf = (s) => ({ players: s.players, defense: s.defense, run: s.run, ballPos: s.ball, los: LOS, cues: s.cues });
const inFit = (s) => { stubLB(s, RUN); step(s, 1); assert.equal(s.defense.agents.MLB.state, 'fit'); return s; };

test('T-57 #1: an LB in fit, scrape or split with a climber cue goes to takeOn; his goal is on his gap side of the climber (clamped into his gap, at or in front of fit depth), both sides', () => {
  for (const side of [-1, 1]) {
    const s = inFit(setup());
    const e = s.defense.agents.MLB;
    const span = gapSpan(s.players, s.defense, e.fit);
    const lg = by(s.players, 'LG');
    lg.x = (span.lo + span.hi) / 2 - side;
    lg.y = LOS - 1;
    stubLB(s, { ...RUN, climber: { id: 'LG', side: -side } });
    const g = step(s, 0.01).MLB;
    assert.equal(e.state, 'takeOn');
    const lo = span.lo + BODY_RADIUS;
    const hi = span.hi - BODY_RADIUS;
    near(g.x, Math.min(hi, Math.max(lo, lg.x + side * BODY_RADIUS)));
    near(g.y, Math.max(lg.y + BODY_RADIUS, LOS + FILL_DEPTH));
  }
  for (const st of ['scrape', 'split']) {
    const s = setup();
    s.defense.agents.MLB.state = st;
    stubLB(s, { climber: { id: 'LG', side: 1 } });
    step(s, 0.01);
    assert.equal(s.defense.agents.MLB.state, 'takeOn', st);
  }
});

test('T-57 #1: the unengaged takeOn goal clamps into his gap at the far edge, and follows a climber deeper than fit depth', () => {
  const s = inFit(setup());
  const e = s.defense.agents.MLB;
  const span = gapSpan(s.players, s.defense, e.fit);
  const lg = by(s.players, 'LG');
  for (const side of [-1, 1]) {
    lg.x = side > 0 ? span.hi : span.lo; // the far edge on his gap side: the shoulder would leave the gap
    lg.y = LOS - 1;
    e.state = 'fit';
    e.gs = undefined;
    stubLB(s, { ...RUN, climber: { id: 'LG', side: -side } });
    step(s, 0.01);
    e.gs = side;
    const g = GOALS.takeOn(by(s.players, 'MLB'), e, envOf(s));
    assert.ok(g.x <= span.hi - BODY_RADIUS + 1e-9 && g.x >= span.lo + BODY_RADIUS - 1e-9, `x ${g.x} in gap`);
  }
  lg.x = (span.lo + span.hi) / 2;
  lg.y = LOS + FILL_DEPTH + 2; // deeper than fit depth: y follows the climber
  e.state = 'fit';
  e.gs = undefined;
  stubLB(s, { ...RUN, climber: { id: 'LG', side: 1 } });
  step(s, 0.01);
  const g = GOALS.takeOn(by(s.players, 'MLB'), e, envOf(s));
  near(g.y, lg.y + BODY_RADIUS);
});

test('T-57 #1: gs and the climber do not change while unengaged in takeOn, when the climber crosses the gap centre or the cue names another', () => {
  const s = inFit(setup());
  const e = s.defense.agents.MLB;
  const span = gapSpan(s.players, s.defense, e.fit);
  const mid = (span.lo + span.hi) / 2;
  const lg = by(s.players, 'LG');
  lg.x = mid - 0.5;
  lg.y = LOS - 1;
  stubLB(s, { ...RUN, climber: { id: 'LG', side: 1 } });
  step(s, 0.01);
  assert.equal(e.state, 'takeOn');
  const gs0 = e.gs;
  assert.ok(gs0 === 1 || gs0 === -1);
  lg.x = mid + 0.5; // crosses the gap centre
  stubLB(s, { ...RUN, climber: { id: 'LG', side: 1 } });
  step(s, 0.01);
  assert.equal(e.gs, gs0);
  stubLB(s, { ...RUN, climber: { id: 'RG', side: 1 } }); // the cue names another climber
  step(s, 0.01);
  assert.equal(e.climber, 'LG');
  assert.equal(e.gs, gs0);
});

test('T-57 #1: climberGone returns takeOn to fit (from fit or split) or scrape; engaged he stays', () => {
  for (const [from, back] of [['fit', 'fit'], ['split', 'fit'], ['scrape', 'scrape']]) {
    const s = setup();
    s.defense.agents.MLB.state = from;
    stubLB(s, { climber: { id: 'LG', side: 1 } });
    step(s, 0.01);
    assert.equal(s.defense.agents.MLB.state, 'takeOn');
    assert.equal(s.defense.agents.MLB.back, from);
    by(s.players, 'LG').block = { target: 'MLB', engaged: true, released: null, seq: null, angle: 'straight' };
    stubLB(s, {});
    step(s, 0.01);
    assert.equal(s.defense.agents.MLB.state, 'takeOn', `${from} engaged`);
    by(s.players, 'LG').block = null;
    step(s, 0.01);
    assert.equal(s.defense.agents.MLB.state, back, from);
  }
});

test('T-57 #1: the engaged takeOn goal is on the gap side of his blocker and passes the leverage check', () => {
  for (const side of [-1, 1]) {
    const s = setup();
    const e = s.defense.agents.MLB;
    e.state = 'fit';
    const span = gapSpan(s.players, s.defense, e.fit);
    const lg = by(s.players, 'LG');
    lg.x = (span.lo + span.hi) / 2 - side;
    lg.y = LOS - 1;
    stubLB(s, { climber: { id: 'LG', side: -side } });
    step(s, 0.01);
    assert.equal(e.state, 'takeOn');
    const mlb = by(s.players, 'MLB');
    mlb.x = lg.x;
    mlb.y = lg.y + 2 * BODY_RADIUS;
    lg.block = { target: 'MLB', engaged: true, released: null, seq: null, angle: 'straight' };
    stubLB(s, {});
    const g = GOALS.takeOn(mlb, e, envOf(s));
    assert.equal(Math.sign(g.x - lg.x), side);
    const gm = Math.hypot(g.x - mlb.x, g.y - mlb.y);
    const bm = Math.hypot(lg.x - mlb.x, lg.y - mlb.y);
    const cos = ((g.x - mlb.x) * (lg.x - mlb.x) + (g.y - mlb.y) * (lg.y - mlb.y)) / (gm * bm);
    assert.ok(cos > LEVER_COS, `cos ${cos}`);
  }
});

test('T-57 #2: ballCommitted sends a DL in getoff, hold, anchor and squeeze to pursue; twoGap control goes to twoGapFit; contain is unchanged', () => {
  const ball = { x: 0, y: LOS, vx: 0, vy: 4, carried: true, past: false, committed: true };
  for (const st of ['getoff', 'hold', 'anchor', 'squeeze']) {
    const s = stubCues(setup(), 'base', ball);
    const id = Object.keys(s.defense.agents).find((k) => s.defense.agents[k].behavior === 'attack');
    s.defense.agents[id].state = st;
    step(s, 0.01);
    assert.equal(s.defense.agents[id].state, 'pursue', st);
    assert.equal(s.defense.agents[id].why, 'ballCommitted', st);
  }
  const t = stubCues(setup({ call: 'twoGap' }), 'base', ball);
  const tg = Object.keys(t.defense.agents).find((k) => t.defense.agents[k].behavior === 'twoGap');
  step(t, 0.01);
  assert.equal(t.defense.agents[tg].state, 'twoGapFit');
  for (const st of Object.values(BEHAVIORS.contain.states)) assert.ok(!st.exits.some((x) => x.when === 'ballCommitted'));
});

// Restated for the T-57 revision: the inside shift fades to zero as the pursuer reaches the ball's x.
test('T-57 #3: an inside pursuer of a sideways ball aims min(PURSUE_LEVER, his x distance) inside the intercept point; outside, slow or still gets the plain intercept', () => {
  const d = { x: 0, y: 30, speed: 7 };
  const mk = (ball, v) => ({ ballPos: ball, defense: { ballV: v }, cues: () => null });
  const e = {};
  for (const s of [-1, 1]) {
    const ball = { x: 5 * s, y: 25 };
    const v = { x: 4 * s, y: 0 };
    const p = intercept(d, ball, v, d.speed);
    const g = GOALS.pursue(d, e, mk(ball, v));
    near(g.x, p.x - s * PURSUE_LEVER);
    near(g.y, p.y);
    const close = { x: 0.2 * s, y: 25 }; // 0.2 yd inside
    const pc = intercept(d, close, v, d.speed);
    const gc = GOALS.pursue(d, e, mk(close, v));
    near(gc.x, pc.x - s * 0.2);
    near(gc.y, pc.y);
    const out = { x: -5 * s, y: 25 }; // the pursuer is on the ball's outside
    assert.deepEqual(GOALS.pursue(d, e, mk(out, v)), intercept(d, out, v, d.speed));
  }
  for (const v of [{ x: 0, y: 4 }, { x: LEVER_V * 0.9, y: 0 }, { x: 0, y: 0 }]) {
    const ball = { x: 5, y: 25 };
    assert.deepEqual(GOALS.pursue(d, e, mk(ball, v)), intercept(d, ball, v, d.speed));
  }
});

test('T-57 #3a: pursue uses the ball cue spot and velocity, not an exchange spike; no cue keeps the env ball', () => {
  const d = { x: 0, y: 30, speed: 7 };
  const e = {};
  const cue = { x: 2, y: 22, vx: 1.5, vy: 3.8, carried: true, past: false, committed: true };
  const env = { ballPos: { x: 10, y: 50 }, defense: { ballV: { x: 10, y: 33 } }, cues: () => ({ ball: cue }) };
  const p = intercept(d, { x: cue.x, y: cue.y }, { x: cue.vx, y: cue.vy }, d.speed);
  const g = GOALS.pursue(d, e, env);
  near(g.y, p.y);
  // inside pursuer (d.x < cue.x, vx > 0) gets the lever
  near(g.x, p.x - PURSUE_LEVER);
  const none = { ...env, cues: () => null };
  assert.deepEqual(GOALS.pursue(d, e, { ...none, defense: { ballV: { x: 0, y: 0 } } }), intercept(d, none.ballPos, { x: 0, y: 0 }, d.speed));
});

// F-61 #6: a one-gap DL puts the best-odds move against his blocker on his goal.
const rate = (s, id, r) => { Object.assign(by(s.players, id), r); };
const rateAll = (s, r) => { for (const p of s.players) if (p.role === 'DT' || p.role === 'DE') Object.assign(p, r); };
const moveGoal = (s, id = 'LDT') => step(s)[id];

test('F-61 #6: a DL in hold with swim the best odds gets a swim move on his gap side', () => {
  const s = stubCues(setup(), 'base');
  rateAll(s, { swim: 1, power: 0 });
  const g = moveGoal(s);
  const e = s.defense.agents.LDT;
  assert.equal(e.state, 'hold');
  const b = by(s.players, e.blocker);
  assert.deepEqual(g.move, { kind: 'swim', side: gapSideOf(s, e, b) });
  assert.notEqual(g.move.side, 0);
});

const gapSideOf = (s, e, b) => {
  const span = gapSpan(s.players, s.defense, e.fit);
  return Math.sign((span ? (span.lo + span.hi) / 2 : e.x0) - b.x);
};

test('F-61 #6: with power the higher odds he gets a power move with side 0', () => {
  const s = stubCues(setup(), 'base');
  rateAll(s, { swim: 0.2, power: 1 });
  const g = moveGoal(s);
  assert.equal(s.defense.agents.LDT.state, 'hold');
  assert.deepEqual(g.move, { kind: 'power', side: 0 });
});

test('F-61 #6: a tie picks the first move in MOVE_COUNTER order', () => {
  const s = stubCues(setup(), 'base');
  rateAll(s, { swim: 0.5, power: 0.5 });
  assert.equal(moveGoal(s).move.kind, 'swim');
});

test('F-61 #6: outsideArm, squeeze and rush also carry a move', () => {
  for (const felt of ['reach', 'pass']) {
    const s = stubCues(setup(), felt);
    rateAll(s, { swim: 1, power: 0 });
    const g = moveGoal(s);
    assert.ok(['outsideArm', 'rush'].includes(s.defense.agents.LDT.state));
    assert.equal(g.move.kind, 'swim', felt);
  }
  const s = stubCues(setup(), 'none');
  rateAll(s, { swim: 1, power: 0 });
  step(s, 0.01);
  s.defense.agents.LDT.state = 'squeeze';
  assert.equal(moveGoal(s).move.kind, 'swim');
});

test('F-61 #6: no move in getoff, anchor or close', () => {
  const s = stubCues(setup(), 'none');
  rateAll(s, { swim: 1, power: 1 });
  assert.equal(step(s, 0.01).LDT.move, undefined);
  assert.equal(s.defense.agents.LDT.state, 'getoff');
  for (const felt of ['double', 'down']) {
    const t = stubCues(setup(), felt);
    rateAll(t, { swim: 1, power: 1 });
    const g = step(t, 0.01).LDT;
    assert.ok(['anchor', 'close'].includes(t.defense.agents.LDT.state));
    assert.equal(Object.hasOwn(g, 'move'), false, felt);
  }
});

test('F-61 #6: no move for a two-gap DL, a contain edge or an LB', () => {
  const t = stubCues(setup({ call: 'twoGap' }), 'base');
  rateAll(t, { swim: 1, power: 1 });
  for (const g of Object.values(step(t))) assert.equal(Object.hasOwn(g, 'move'), false);
  const s = stubCues(setup(), 'base');
  rateAll(s, { swim: 1, power: 1 });
  const out = step(s);
  for (const [id, e] of Object.entries(s.defense.agents)) {
    if (e.behavior !== 'attack') assert.equal(Object.hasOwn(out[id] ?? {}, 'move'), false, id);
  }
  assert.ok(Object.values(s.defense.agents).some((e) => e.behavior === 'zone'));
});

test('F-61 #6: no move with zero ratings, no blocker or a double felt', () => {
  const s = stubCues(setup(), 'base');
  rateAll(s, { swim: 0, power: 0 });
  assert.equal(Object.hasOwn(moveGoal(s), 'move'), false);
  const n = stubCues(setup(), 'base');
  rateAll(n, { swim: 1, power: 1 });
  n.cues = () => null;
  assert.equal(Object.hasOwn(step(n).LDT, 'move'), false);
  const d = stubCues(setup(), 'base');
  rateAll(d, { swim: 1, power: 1 });
  step(d, 0.01);
  d.cues = (id) => (d.defense.agents[id] ? { felt: 'double', tech: { blocker: nearestOL(d, id).id }, ball: { x: 0, y: LOS } } : null);
  const env = { players: d.players, defense: d.defense, cues: d.cues };
  assert.equal(moveFor(by(d.players, 'LDT'), d.defense.agents.LDT, env), null);
});
