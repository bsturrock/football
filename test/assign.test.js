import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFront } from '../src/dots/front.js';
import { runScheme } from '../src/dots/assign.js';
import { zonePlan, INSIDE_ZONE } from '../src/dots/zone.js';
import { A_GAP_HALF } from '../src/dots/numbering.js';
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
      assert.deepEqual(runScheme(readFront(players, numbers, LOS), INSIDE_ZONE), plan, `${name} ${personnel}`);
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
  const f = read('base');
  const r = runScheme(f, { rules: [
    { when: 'covered', at: 'playEnd', tech: 'X' }, { when: 'covered', tech: 'Y' },
  ] });
  const open = Object.keys(f.covered).filter((id) => f.covered[id].length === 0);
  assert.equal(open.length, 1);
  assert.equal(r.techs.LT.tech, 'X');
  for (const id of Object.keys(f.covered)) {
    if (f.covered[id].length > 0 && id !== 'LT') assert.equal(r.techs[id].tech, 'Y', id);
  }
  for (const [id, t] of Object.entries(r.techs)) {
    if (id !== 'LT') assert.equal(t.tech, 'Y', id);
  }
  const [uncovered] = open;
  assert.ok(!(uncovered in r.techs));
  assert.ok(!(uncovered in r.blocks));
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

test('R-63: over43/walkedUp te: RT climbs, RG blocks BT alone', () => {
  for (const name of ['over43', 'walkedUp']) {
    const players = frontPlayers(name, 'te');
    const f = readFront(players, frontNumbers(players), LOS);
    const r = runScheme(f, IZ);
    assert.equal(r.blocks.RT, 'WIL', name);
    assert.equal(r.techs.RT.tech, 'climb', name);
    assert.equal(r.blocks.RG, 'BT', name);
    assert.ok(r.combos.every((c) => c.target !== 'BT'), name);
  }
});

test('every combo target is less than A_GAP_HALF playside of the partner', () => {
  for (const name of FRONT_NAMES) {
    for (const personnel of ['noTe', 'te']) {
      const players = frontPlayers(name, personnel);
      const f = readFront(players, frontNumbers(players), LOS);
      for (const c of runScheme(f, IZ).combos) {
        const tgt = f.defenders.find((d) => d.id === c.target);
        const nb = f.line.find((l) => l.id === c.partner);
        assert.ok(tgt.u - nb.u < A_GAP_HALF, `${name} ${personnel} ${c.owner}/${c.partner}`);
      }
    }
  }
});

test('spare: a man-short line leaves the backside end man and the end lineman climbs', () => {
  const SP = { rules: [{ when: 'spare', at: 'backEnd', tech: 'climb' }, ...IZ.rules] };
  const climbs = [];
  for (const name of ['under43', 'bear', 'base', 'over43', 'odd34']) {
    const players = frontPlayers(name, 'te');
    const f = readFront(players, frontNumbers(players), LOS);
    const r = runScheme(f, SP);
    const end = f.line.at(-1).id;
    const tgt = f.defenders.find((d) => d.id === r.blocks[end]);
    if (tgt && tgt.level === 'second') {
      climbs.push(name);
      assert.ok(r.free.includes(f.edge), name);
      assert.equal(r.techs[end].tech, 'climb', name);
    } else {
      assert.equal(r.blocks[end], f.edge, name);
    }
  }
  for (const name of ['under43', 'bear', 'base']) assert.ok(climbs.includes(name), name);
  for (const name of ['over43', 'odd34']) assert.ok(!climbs.includes(name), name);
});

test('purity with the spare table', () => {
  const SP = { rules: [{ when: 'spare', at: 'backEnd', tech: 'climb' }, ...IZ.rules] };
  for (const name of FRONT_NAMES) {
    const players = frontPlayers(name, 'te');
    const f = readFront(players, frontNumbers(players), LOS);
    const f0 = structuredClone(f);
    runScheme(f, SP);
    assert.deepEqual(f, f0, name);
  }
});
