import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonePlan, zoneSwitch } from '../src/dots/zone.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup, PLAYS } from '../src/dots/roster.js';

const plan = (opts) => {
  const players = buildLineup(25, 'insideZone', opts);
  const numbers = numberPlay(players, { los: 25, centerId: 'C', playside: 'left' });
  return { players, numbers, ...zonePlan(players, numbers, 25) };
};

test('scheme flag on insideZone', () => assert.equal(PLAYS.insideZone.scheme, 'zone'));

test('F-12 #1: base zonePlan', () => {
  const r = plan({});
  assert.deepEqual(r.blocks, { C: 'RDT', LG: 'RDE', LT: 'RDE', RG: 'LDT', RT: 'LDT' });
  assert.deepEqual(r.combos, [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
    { owner: 'LG', partner: 'LT', target: 'RDE', watch: 'WLB' },
  ]);
});

test('F-12 #2: lbShift -3.6 zonePlan', () => {
  const r = plan({ lbShift: -3.6 });
  assert.deepEqual(r.blocks, { C: 'RDT', LG: 'RDT', LT: 'RDE', RG: 'LDT', RT: 'LDE' });
  assert.deepEqual(r.combos, [{ owner: 'C', partner: 'LG', target: 'RDT', watch: 'MLB' }]);
});

test('F-12 #3: dlShift 2.4 zonePlan', () => {
  const r = plan({ dlShift: 2.4 });
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
  const players = buildLineup(25, 'insideZone', { lbShift: -3.6 });
  const g = (id) => players.find((p) => p.id === id);
  const blk = { target: 'RDT', angle: 'straight', engaged: true, seq: 1 };
  g('C').block = { ...blk };
  g('LG').block = { ...blk };
  const ctx = { combos: [{ owner: 'C', partner: 'LG', target: 'RDT', watch: 'MLB' }] };
  return { players, g, ctx };
};

test('F-12 #4: zoneSwitch far', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('MLB'), { x: -1.0, y: 29.5 });
  assert.deepEqual(zoneSwitch(players, null, ctx), []);
});
test('F-12 #4: zoneSwitch nearer C', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('MLB'), { x: -0.6, y: 25.0 });
  assert.deepEqual(zoneSwitch(players, null, ctx), [{ blocker: 'C', target: 'MLB' }]);
});
test('F-12 #4: zoneSwitch nearer LG', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('MLB'), { x: -3.0, y: 25.0 });
  assert.deepEqual(zoneSwitch(players, null, ctx), [{ blocker: 'LG', target: 'MLB' }]);
});
test('F-12 #4: zoneSwitch lateral tie goes to owner', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('C'), { x: 0, y: 24.3 });
  Object.assign(g('LG'), { x: -2.2, y: 24.3 });
  Object.assign(g('MLB'), { x: -1.1, y: 25.0 });
  assert.deepEqual(zoneSwitch(players, null, ctx), [{ blocker: 'C', target: 'MLB' }]);
});
test('F-12 #4: zoneSwitch already switched, no ctx', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('MLB'), { x: -0.6, y: 25.0 });
  g('C').block.target = 'MLB';
  assert.deepEqual(zoneSwitch(players, null, ctx), []);
  assert.deepEqual(zoneSwitch(players, null, {}), []);
  assert.deepEqual(zoneSwitch(players, null, undefined), []);
});
