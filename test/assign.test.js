import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFront } from '../src/dots/front.js';
import { runScheme } from '../src/dots/assign.js';
import { zonePlan } from '../src/dots/zone.js';
import { frontPlayers, frontNumbers, LOS, FRONT_NAMES } from './fixtures/fronts.js';
import { IZ_FREE } from './fixtures/base-front.js';

const read = (name) => {
  const players = frontPlayers(name);
  return readFront(players, frontNumbers(players), LOS);
};
const IZ = { rules: [
  { when: 'covered', at: 'backEnd', tech: 'cutoff' }, { when: 'covered', tech: 'zone' },
  { when: 'double', tech: 'combo' }, { when: 'climb', tech: 'climb' }, { when: 'cutoff', tech: 'cutoff' },
] };

test('runScheme with the IZ table matches zonePlan on every front and personnel', () => {
  for (const name of FRONT_NAMES) {
    for (const personnel of ['noTe', 'te']) {
      const players = frontPlayers(name, personnel);
      const numbers = frontNumbers(players);
      const { front, ...plan } = zonePlan(players, numbers, LOS);
      assert.deepEqual(runScheme(readFront(players, numbers, LOS), IZ), plan, `${name} ${personnel}`);
    }
  }
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
  for (const [id, t] of Object.entries(r.techs)) {
    if (id !== 'LT') assert.equal(t.tech, 'Y', id);
  }
  assert.ok(!('LG' in r.techs));
  assert.ok(!('LG' in r.blocks));
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
