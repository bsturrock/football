import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonePlan, zoneSwitch, SWITCH_DIST } from '../src/dots/zone.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup, PLAYS } from '../src/dots/roster.js';
import { DL_SHIFT_STEP, LB_SHIFT_STEP } from '../src/dots/play.js';

const plan = (opts) => {
  const players = buildLineup(25, 'insideZone', opts);
  const numbers = numberPlay(players, { los: 25, centerId: 'C', playside: 'left' });
  return { players, numbers, ...zonePlan(players, numbers, 25) };
};
const X = (r, id) => r.players.find((p) => p.id === id).x;

test('scheme flag on insideZone', () => assert.equal(PLAYS.insideZone.scheme, 'zone'));

test('F-12 #1: base zonePlan', () => {
  const r = plan({});
  assert.deepEqual(r.blocks, { C: 'RDT', LG: 'RDE', LT: 'RDE', RG: 'LDT', RT: 'LDT' });
  assert.deepEqual(r.combos, [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
    { owner: 'LG', partner: 'LT', target: 'RDE', watch: 'WLB' },
  ]);
});

test('F-12 #2: full LB shift (-6 steps) zonePlan', () => {
  const r = plan({ lbShift: -6 * LB_SHIFT_STEP });
  assert.deepEqual(r.blocks, { C: 'RDT', LG: 'RDT', LT: 'RDE', RG: 'LDT', RT: 'LDE' });
  assert.deepEqual(r.combos, [
    { owner: 'C', partner: 'LG', target: 'RDT', watch: 'MLB' },
  ]);
});

test('F-12 #3: full DL shift (+4 steps) zonePlan', () => {
  const r = plan({ dlShift: 4 * DL_SHIFT_STEP });
  assert.deepEqual(r.blocks, { C: 'RDE', LG: 'RDE', RG: 'RDT', RT: 'RDT' });
  assert.deepEqual(r.combos, [
    { owner: 'RT', partner: 'RG', target: 'RDT', watch: 'MLB' },
    { owner: 'C', partner: 'LG', target: 'RDE', watch: 'WLB' },
  ]);
});

test('F-12 #3: rule (c) climb with no combo', () => {
  const players = [
    { id: 'LT', team: 'offense', x: -4, y: 24 },
    { id: 'LB', team: 'defense', x: -4, y: 29.5 },
  ];
  const r = zonePlan(players, { LT: 2, LB: 2 }, 25);
  assert.deepEqual(r.blocks, { LT: 'LB' });
  assert.deepEqual(r.combos, []);
});

const sw = () => {
  const players = buildLineup(25, 'insideZone', { lbShift: -6 * LB_SHIFT_STEP });
  const g = (id) => players.find((p) => p.id === id);
  const blk = { target: 'RDT', angle: 'straight', engaged: true, seq: 1 };
  g('C').block = { ...blk };
  g('LG').block = { ...blk };
  Object.assign(g('C'), { x: 0, y: 24.3 });
  Object.assign(g('LG'), { x: -2.2, y: 23.8 });
  const ctx = { combos: [{ owner: 'C', partner: 'LG', target: 'RDT', watch: 'MLB' }] };
  return { players, g, ctx };
};
const at = (x, y, mut) => {
  const s = sw();
  Object.assign(s.g('MLB'), { x, y });
  if (mut) mut(s);
  return zoneSwitch(s.players, null, s.ctx);
};

test('F-12 #4a: unmoved, out of range', () => assert.deepEqual(at(-1.6, 29.5), []));
test('F-12 #4f: range: laterally nearer LG', () =>
  assert.deepEqual(at(-1.3, 25.0), [{ blocker: 'LG', target: 'MLB' }]));
test('F-12 #4g: range lateral tie goes to owner', () =>
  assert.deepEqual(at(-1.1, 25.0, (s) => {
    Object.assign(s.g('LG'), { x: -2.2, y: 24.3 });
  }), [{ blocker: 'C', target: 'MLB' }]));
test('range boundary: inside SWITCH_DIST goes to C', () =>
  assert.deepEqual(at(0, 24.3 + SWITCH_DIST - 0.05), [{ blocker: 'C', target: 'MLB' }]));
test('range boundary: outside SWITCH_DIST stays', () =>
  assert.deepEqual(at(0, 24.3 + SWITCH_DIST + 0.05), []));
test('F-12 #4i: already switched', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('C').block.target = 'MLB'; }), []));
test('F-12 #4j: no combos or ctx', () => {
  const { players } = sw();
  assert.deepEqual(zoneSwitch(players, null, {}), []);
  assert.deepEqual(zoneSwitch(players, null, undefined), []);
});
test('F-12 #4k: purity', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('MLB'), { x: -2.2, y: 29.5 });
  const p0 = structuredClone(players);
  const c0 = structuredClone(ctx);
  zoneSwitch(players, null, ctx);
  assert.deepEqual(players, p0);
  assert.deepEqual(ctx, c0);
});
