import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFront } from '../src/dots/front.js';
import { runScheme } from '../src/dots/assign.js';
import { frontPlayers, frontNumbers, LOS } from './fixtures/fronts.js';
import { IZ_FREE } from './fixtures/base-front.js';

const read = (name) => {
  const players = frontPlayers(name);
  return readFront(players, frontNumbers(players), LOS);
};
const IZ = { rules: [
  { when: 'covered', at: 'backEnd', tech: 'cutoff' }, { when: 'covered', tech: 'zone' },
  { when: 'double', tech: 'combo' }, { when: 'climb', tech: 'climb' }, { when: 'cutoff', tech: 'cutoff' },
] };

test('base with IZ', () => {
  const r = runScheme(read('base'), IZ);
  assert.equal(r.side, -1);
  assert.deepEqual(r.blocks, { LT: 'RDE', LG: 'RDE', C: 'RDT', RG: 'LDT', RT: 'LDT' });
  assert.deepEqual(r.combos, [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
    { owner: 'LG', partner: 'LT', target: 'RDE', watch: 'WLB' },
  ]);
  assert.deepEqual(r.techs, {
    LT: { tech: 'combo', shade: 'playside', watch: 'WLB' },
    LG: { tech: 'combo', shade: 'none', watch: 'WLB' },
    C: { tech: 'zone', shade: 'playside', watch: null },
    RG: { tech: 'combo', shade: 'playside', watch: 'MLB' },
    RT: { tech: 'combo', shade: 'none', watch: 'MLB' },
  });
  assert.deepEqual(r.free, IZ_FREE.base);
});

test('overflow, walkedUp', () => {
  const r = runScheme(read('walkedUp'), IZ);
  assert.equal(r.blocks.LT, 'SAM');
  assert.equal(r.blocks.LG, 'PE');
  assert.equal(r.blocks.C, 'PT');
  assert.equal(r.blocks.RG, 'BT');
  assert.equal(r.blocks.RT, 'BT');
  assert.deepEqual(r.combos, [{ owner: 'RT', partner: 'RG', target: 'BT', watch: 'WIL' }]);
  assert.deepEqual(r.free, ['MIK', 'BE']);
});

test('two uncovered side by side, odd34', () => {
  const r = runScheme(read('odd34'), IZ);
  assert.equal(r.blocks.LT, 'PO');
  assert.equal(r.blocks.LG, 'PE');
  assert.equal(r.blocks.C, 'N');
  assert.deepEqual(r.combos, [{ owner: 'RG', partner: 'C', target: 'N', watch: 'BI' }]);
  assert.equal(r.blocks.RT, 'BE');
  assert.deepEqual(r.techs.RT, { tech: 'cutoff', shade: 'none', watch: null });
  assert.deepEqual(r.free, ['PI', 'BO']);
});

test('climb at the playside end, dlPlus4', () => {
  const r = runScheme(read('dlPlus4'), IZ);
  assert.equal(r.blocks.LT, 'WLB');
  assert.deepEqual(r.techs.LT, { tech: 'climb', shade: 'none', watch: null });
  assert.equal(r.blocks.RT, 'LDT');
  assert.deepEqual(r.techs.RT, { tech: 'cutoff', shade: 'playside', watch: null });
  assert.equal(r.blocks.RG, 'RDT');
  assert.deepEqual(r.combos, [{ owner: 'RG', partner: 'C', target: 'RDT', watch: 'MLB' }]);
  assert.deepEqual(r.free, IZ_FREE.dlPlus4);
});

test('at filtering and first-match order', () => {
  const r = runScheme(read('base'), { rules: [
    { when: 'covered', at: 'playEnd', tech: 'X' }, { when: 'covered', tech: 'Y' },
  ] });
  assert.equal(r.techs.LT.tech, 'X');
  assert.equal(r.techs.C.tech, 'Y');
  assert.ok(!('LG' in r.techs) && !('RT' in r.techs));
  assert.ok(!('LG' in r.blocks) && !('RT' in r.blocks));
});

test('purity', () => {
  const f = read('base');
  const f0 = structuredClone(f);
  const s0 = structuredClone(IZ);
  runScheme(f, IZ);
  assert.deepEqual(f, f0);
  assert.deepEqual(IZ, s0);
});

test('unknown rule throws even when earlier rows match', () => {
  const bad = { rules: [{ when: 'covered', tech: 'zone' }, { when: 'nope', tech: 'zone' }] };
  assert.throws(() => runScheme(read('base'), bad), /unknown rule "nope"/);
  assert.throws(() => runScheme(read('base'), { rules: [{ when: 'nope', tech: 'zone' }] }), /unknown rule/);
});
