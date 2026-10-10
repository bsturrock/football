import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gapSpan, startDefense, stepDefense, validateBehavior, validateCall, validateRows, pickAssign, CALLS, WHO, ASSIGNMENTS, GOALS, TRIGGERS, BEHAVIORS,
  LB_READ_TIME, KEY_MOVE, FLOW_MAX, FILL_DEPTH, ZONE_DEPTH, DROP_SPEED, PENETRATE_DEPTH, PURSUE_REACH, LEAD_MAX, intercept,
} from '../src/dots/defense.js';
import { readFront } from '../src/dots/front.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup } from '../src/dots/roster.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
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
const step = (s, dt = 0.05) => stepDefense(s.players, s.defense, { run: s.run, ballPos: s.ball }, dt);

test('F-33/F-34: base call gives every DL an attack agent, LBs a zone agent in drop', () => {
  for (const name of FRONT_NAMES) {
    const pl = frontPlayers(name).map((p) => ({ ...p }));
    const fr = readFront(pl, frontNumbers(pl), LOS);
    const df = startDefense(pl, fr, { los: LOS, carrierId: 'RB' });
    for (const p of pl) {
      if (p.role === 'DE' || p.role === 'DT') {
        assert.equal(df.agents[p.id].behavior, 'attack', `${name} ${p.id}`);
        assert.equal(df.agents[p.id].assign.type, 'attack');
        assert.equal(df.agents[p.id].assign.gap, 'fit');
        assert.deepEqual(df.agents[p.id].fit, fr.defenders.find((f) => f.id === p.id).fit);
      } else if (p.role === 'LB') {
        assert.equal(df.agents[p.id].behavior, 'zone', `${name} ${p.id}`);
        assert.equal(df.agents[p.id].assign.type, 'zone');
        assert.equal(df.agents[p.id].assign.depth, ZONE_DEPTH);
        assert.equal(df.agents[p.id].state, 'drop');
      }
    }
  }
  const s = setup();
  for (const id of BASE_LB_IDS) {
    assert.equal(s.defense.agents[id].state, 'drop', id);
    assert.equal(s.defense.agents[id].read, by(s.players, id).def.read, id);
  }
  const p2 = buildLineup(LOS, 'insideZone').map((p) => ({ ...p, def: null }));
  const n2 = numberPlay(p2, { los: LOS, centerId: 'C', playside: 'left' });
  const d2 = startDefense(p2, readFront(p2, n2, LOS), { los: LOS, carrierId: 'RB' });
  assert.equal(d2.agents.WLB.read, LB_READ_TIME);
  assert.ok(Object.isFrozen(CALLS.base));
});

test('F-34 #2: zone drop goal is x0 at los + depth, at DROP_SPEED; def.assign depth replaces the default', () => {
  const s = setup();
  const mlb = by(s.players, 'MLB');
  const out = step(s);
  near(out.MLB.x, mlb.x);
  near(out.MLB.y, LOS + ZONE_DEPTH);
  near(out.MLB.rate, DROP_SPEED * mlb.speed);
  assert.equal(out.MLB.key, 'def:drop');
  const t = setup();
  by(t.players, 'MLB').def = { ...by(t.players, 'MLB').def, assign: { type: 'zone', depth: 6 } };
  const d6 = startDefense(t.players, t.front, { los: LOS, carrierId: 'RB' });
  assert.equal(d6.agents.MLB.assign.depth, 6);
  near(stepDefense(t.players, d6, { run: t.run, ballPos: t.ball }, 0.01).MLB.y, LOS + 6);
  const u = setup();
  by(u.players, 'MLB').def = { ...by(u.players, 'MLB').def, assign: { type: 'zone' } };
  const d0 = startDefense(u.players, u.front, { los: LOS, carrierId: 'RB' });
  assert.equal(d0.agents.MLB.assign.depth, ZONE_DEPTH);
});

test('F-34 #3: runBlock, mesh and backfield each move drop to flow after read and not before', () => {
  const keys = {
    runBlock: (s) => { by(s.players, 'LG').y += KEY_MOVE; },
    mesh: (s) => { s.run.carried = true; },
    backfield: (s) => { by(s.players, 'RB').x += KEY_MOVE; },
  };
  for (const [k, fire] of Object.entries(keys)) {
    const s = setup();
    fire(s);
    step(s, 0.1);
    assert.equal(s.defense.agents.MLB.state, 'drop', `${k} before read`);
    step(s, 0.5);
    assert.equal(s.defense.agents.MLB.state, 'flow', `${k} after read`);
  }
  const s = setup();
  step(s, 1);
  assert.equal(s.defense.agents.MLB.state, 'drop', 'no key');
  const back = setup();
  by(back.players, 'LG').y -= 2 * KEY_MOVE;
  step(back, 1);
  assert.equal(back.defense.agents.MLB.state, 'drop', 'backward OL');
  const eng = setup();
  by(eng.players, 'LG').block = { target: 'LDT', engaged: true, released: null, seq: null, angle: 'straight' };
  step(eng, 1);
  assert.equal(eng.defense.agents.MLB.state, 'flow', 'engaged OL');
});

test('F-34: flow and fill share the lane x; fill at FILL_DEPTH; carrierPast, locked and FLOW_MAX', () => {
  assert.ok(FILL_DEPTH >= 3 && FILL_DEPTH <= 5);
  const s = setup();
  s.run.carried = true;
  step(s, 1);
  const flow = step(s, 0.01);
  assert.equal(s.defense.agents.MLB.state, 'flow');
  s.run.locked = true;
  step(s, 0.01);
  assert.equal(s.defense.agents.MLB.state, 'fill');
  const fill = step(s, 0.01);
  near(flow.MLB.x, fill.MLB.x);
  near(fill.MLB.y, LOS + FILL_DEPTH);
  const span = gapSpan(s.players, s.defense, s.defense.agents.MLB.fit);
  assert.ok(fill.MLB.x >= span.lo + BODY_RADIUS - 1e-9 && fill.MLB.x <= span.hi - BODY_RADIUS + 1e-9);

  const t = setup();
  t.run.carried = true;
  step(t, 1);
  step(t, FLOW_MAX);
  assert.equal(t.defense.agents.MLB.state, 'fill');

  const u = setup();
  u.run.carried = true;
  step(u, 1);
  u.run.locked = true;
  u.ball = { x: 0, y: LOS + 1 };
  step(u, 0.01);
  assert.equal(u.defense.agents.MLB.state, 'pursue');
});

test('F-34: atFill goes to pursue; carrierPast from fill', () => {
  const s = setup();
  s.run.carried = true;
  s.run.locked = true;
  step(s, 1);
  const out = step(s, 0.01);
  assert.equal(s.defense.agents.MLB.state, 'fill');
  const mlb = by(s.players, 'MLB');
  mlb.x = out.MLB.x;
  mlb.y = out.MLB.y;
  step(s, 0.01);
  assert.equal(s.defense.agents.MLB.state, 'pursue');
  const pur = step(s, 0.01).MLB;
  assert.deepEqual({ x: pur.x, y: pur.y }, intercept(mlb, s.ball, s.defense.ballV, mlb.speed));

  const t = setup();
  t.run.carried = true;
  t.run.locked = true;
  step(t, 1);
  step(t, 0.01);
  t.ball = { x: 0, y: LOS + 1 };
  step(t, 0.01);
  assert.equal(t.defense.agents.WLB.state, 'pursue');
});

test('F-34: a shed blocker sends an LB in flow or fill to pursue, not in drop', () => {
  const shed = (s) => { by(s.players, 'LG').block = { target: 'MLB', engaged: false, released: 'shed', seq: null, angle: 'straight' }; };
  const d = setup();
  shed(d);
  step(d);
  assert.equal(d.defense.agents.MLB.state, 'drop');
  assert.ok(!(('MLB') in d.defense.committed));
  for (const st of ['flow', 'fill']) {
    const s = setup();
    s.defense.agents.MLB.state = st;
    shed(s);
    step(s);
    assert.equal(s.defense.agents.MLB.state, 'pursue', st);
    assert.equal(step(s).MLB.key, 'def:pursue', st);
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

test('F-19 #9: committed records the lane x and time a LB leaves drop', () => {
  const s = setup();
  s.run.carried = true;
  step(s, 0.1);
  assert.equal(s.defense.agents.MLB.state, 'drop');
  assert.ok(!('MLB' in s.defense.committed));
  step(s, 0.5);
  assert.equal(s.defense.agents.MLB.state, 'flow');
  assert.equal(s.defense.agents.WLB.state, 'flow');
  const env = { players: s.players, defense: s.defense, run: s.run, ballPos: s.ball, los: LOS };
  near(s.defense.committed.MLB.x, GOALS.flow(null, s.defense.agents.MLB, env).x);
  near(s.defense.committed.MLB.t, s.defense.t);
  near(s.defense.committed.WLB.x, GOALS.flow(null, s.defense.agents.WLB, env).x);
  near(s.defense.committed.WLB.t, s.defense.t);
  assert.ok(Math.abs(s.defense.committed.MLB.x - s.defense.committed.WLB.x) > 0);
});

test('F-19 #9: committed entry never changes once set', () => {
  const s = setup();
  s.run.carried = true;
  step(s, 0.1);
  step(s, 0.5);
  const first = { ...s.defense.committed.MLB };
  s.run.aim.x = first.x + 5;
  step(s);
  s.run.aim.x = first.x - 5;
  step(s);
  s.run.locked = true;
  step(s);
  s.ball = { x: 0, y: LOS + 1 };
  step(s);
  near(s.defense.committed.MLB.x, first.x);
  near(s.defense.committed.MLB.t, first.t);
});

test('F-19 #9: committed holds only agents that left their start state', () => {
  const s = setup();
  step(s, 0.1);
  assert.deepEqual(s.defense.committed, {});
  s.run.carried = true;
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
  assert.equal(base.agents.LDE.behavior, 'attack');
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
  near(out.LDE.x, (span.lo + span.hi) / 2);
  near(out.LDE.y, LOS - PENETRATE_DEPTH);
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
  assert.deepEqual(Object.keys(ASSIGNMENTS).sort(), ['attack', 'zone']);
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
  assert.equal(t.defense.agents.LDT.state, 'attack');
  step(t, 1);
  assert.equal(t.defense.agents.LDT.state, 'fit');
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

test('F-33 #4/#8: a shed blocker sends his DL to pursue from attack or fit', () => {
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
  assert.equal(step(a)[aId], undefined);

  const f = setup();
  const fId = dlOf(f);
  f.defense.agents[fId].state = 'fit';
  shed(f, fId);
  step(f);
  assert.equal(f.defense.agents[fId].state, 'pursue');
  assert.equal(step(f)[fId], undefined);

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
