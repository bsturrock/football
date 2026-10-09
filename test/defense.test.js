import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gapSpan, startDefense, stepDefense, validateBehavior,
  LB_READ_TIME, SHUFFLE, KEY_MOVE, FLOW_MAX, FILL_DEPTH,
} from '../src/dots/defense.js';
import { readFront } from '../src/dots/front.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup } from '../src/dots/roster.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';

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

test('F-19 #3: base call gives LBs agents in read, DL none', () => {
  const s = setup();
  assert.deepEqual(Object.keys(s.defense.agents).sort(), ['MLB', 'WLB']);
  assert.equal(s.defense.agents.MLB.state, 'read');
  assert.equal(s.defense.agents.MLB.read, by(s.players, 'MLB').def.read);
  const p2 = buildLineup(LOS, 'insideZone').map((p) => ({ ...p, def: null }));
  const n2 = numberPlay(p2, { los: LOS, centerId: 'C', playside: 'left' });
  const d2 = startDefense(p2, readFront(p2, n2, LOS), { los: LOS, carrierId: 'RB' });
  assert.equal(d2.agents.WLB.read, LB_READ_TIME);
  const out = step(s);
  assert.ok(!('LDE' in out) && !('RDT' in out));
});

test('F-19 #3: read mirrors RB, shuffles, waits for a key', () => {
  const s = setup();
  const mlb = by(s.players, 'MLB');
  by(s.players, 'RB').x += 0.7;
  let out = step(s);
  near(out.MLB.x, mlb.x + 0.7);
  near(out.MLB.y, mlb.y);
  near(out.MLB.rate, SHUFFLE * mlb.speed);
  assert.equal(out.MLB.key, 'def:read');
  step(s, 1);
  assert.equal(s.defense.agents.MLB.state, 'read');
  by(s.players, 'LG').x += KEY_MOVE;
  step(s);
  assert.equal(s.defense.agents.MLB.state, 'flow');
});

test('F-19 #3: read holds before def.read even with keys; carried triggers flow after', () => {
  const s = setup();
  s.run.carried = true;
  step(s, 0.1);
  assert.equal(s.defense.agents.MLB.state, 'read');
  step(s, 0.5);
  assert.equal(s.defense.agents.MLB.state, 'flow');
  assert.equal(s.defense.agents.WLB.state, 'flow');
});

test('F-19 #3: flow goal, carrierPast beats committed, locked and FLOW_MAX fill', () => {
  const s = setup();
  s.run.carried = true;
  step(s, 1);
  const mlb = by(s.players, 'MLB');
  const out = step(s, 0.01);
  near(out.MLB.x, s.run.aim.x);
  near(out.MLB.y, mlb.y);
  s.run.locked = true;
  step(s, 0.01);
  assert.equal(s.defense.agents.MLB.state, 'fill');

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

test('F-19 #3: fill goal inside gap span, atFill and carrierPast go to pursue', () => {
  const s = setup();
  s.run.carried = true;
  s.run.locked = true;
  step(s, 1);
  const out = step(s, 0.01);
  assert.equal(s.defense.agents.MLB.state, 'fill');
  const span = gapSpan(s.players, s.defense, s.defense.agents.MLB.fit);
  assert.ok(out.MLB.x >= span.lo + BODY_RADIUS - 1e-9 && out.MLB.x <= span.hi - BODY_RADIUS + 1e-9);
  near(out.MLB.y, LOS + FILL_DEPTH);
  const mlb = by(s.players, 'MLB');
  mlb.x = out.MLB.x;
  mlb.y = out.MLB.y;
  step(s, 0.01);
  assert.equal(s.defense.agents.MLB.state, 'pursue');
  assert.ok(!('MLB' in step(s, 0.01)));

  const t = setup();
  t.run.carried = true;
  t.run.locked = true;
  step(t, 1);
  step(t, 0.01);
  t.ball = { x: 0, y: LOS + 1 };
  step(t, 0.01);
  assert.equal(t.defense.agents.WLB.state, 'pursue');
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

test('F-19 #9: committed records the lateral spot and time a LB leaves read', () => {
  const s = setup();
  s.run.carried = true;
  step(s, 0.1);
  assert.equal(s.defense.agents.MLB.state, 'read');
  assert.ok(!('MLB' in s.defense.committed));
  step(s, 0.5);
  assert.equal(s.defense.agents.MLB.state, 'flow');
  assert.equal(s.defense.agents.WLB.state, 'flow');
  near(s.defense.committed.MLB.x, s.run.aim.x);
  near(s.defense.committed.MLB.t, s.defense.t);
  near(s.defense.committed.WLB.x, s.run.aim.x);
  near(s.defense.committed.WLB.t, s.defense.t);
});

test('F-19 #9: committed entry never changes once set', () => {
  const s = setup();
  s.run.carried = true;
  step(s, 0.1);
  step(s, 0.5);
  const first = { ...s.defense.committed.MLB };
  s.run.aim.x = first.x + 5;
  step(s);
  s.run.locked = true;
  step(s);
  s.ball = { x: 0, y: LOS + 1 };
  step(s);
  near(s.defense.committed.MLB.x, first.x);
  near(s.defense.committed.MLB.t, first.t);
});

test('F-19 #9: DL ids never appear in committed', () => {
  const s = setup();
  s.run.carried = true;
  step(s, 0.1);
  step(s, 0.5);
  step(s, 1);
  for (const id of Object.keys(s.defense.committed)) {
    assert.ok(!/^(LDE|LDT|RDT|RDE|DL|NT)/.test(id), id);
    assert.ok(id in s.defense.agents);
  }
  assert.ok(!('LDE' in s.defense.committed) && !('RDT' in s.defense.committed));
});
