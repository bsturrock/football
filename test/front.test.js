import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFront, shade } from '../src/dots/front.js';
import { frontPlayers, frontNumbers, LOS, FRONT_NAMES } from './fixtures/fronts.js';

const read = (name) => {
  const players = frontPlayers(name);
  return readFront(players, frontNumbers(players), LOS);
};
const def = (r, id) => r.defenders.find((d) => d.id === id);

test('base front', () => {
  const r = read('base');
  assert.equal(r.side, -1);
  assert.deepEqual(r.line.map((l) => l.id), ['LT', 'LG', 'C', 'RG', 'RT']);
  assert.deepEqual(r.covered, { LT: ['RDE'], LG: [], C: ['RDT'], RG: ['LDT'], RT: [] });
  assert.equal(def(r, 'LDE').cover, null);
  assert.equal(def(r, 'MLB').level, 'second');
  assert.equal(def(r, 'WLB').level, 'second');
});

test('over43', () => {
  const r = read('over43');
  assert.deepEqual(r.covered, { LT: ['PE'], LG: ['PT'], C: [], RG: ['BT'], RT: [] });
  assert.equal(def(r, 'BE').cover, null);
  assert.deepEqual(def(r, 'PT').gap, { side: 'play', name: 'B' });
  assert.deepEqual(def(r, 'BT').gap, { side: 'back', name: 'A' });
  assert.deepEqual(def(r, 'PE').gap, { side: 'play', name: 'C' });
  assert.deepEqual(def(r, 'MIK').gap, { side: 'play', name: 'A' });
});

test('walkedUp', () => {
  const r = read('walkedUp');
  assert.equal(def(r, 'SAM').level, 'line');
  assert.deepEqual(r.covered.LT, ['SAM', 'PE']);
});

test('backedOff', () => {
  const r = read('backedOff');
  assert.equal(def(r, 'BT').level, 'second');
  assert.deepEqual(r.covered.RT, []);
});

test('odd34', () => {
  const r = read('odd34');
  assert.equal(def(r, 'N').gap, null);
  assert.deepEqual(r.covered.C, ['N']);
  assert.deepEqual(r.covered.LT, ['PO', 'PE']);
});

test('shade', () => {
  assert.equal(shade(0, 0.25), 'head');
  assert.equal(shade(0, 0.26), 'playside');
  assert.equal(shade(0, -0.26), 'backside');
});

test('order independence, purity, no center', () => {
  for (const name of FRONT_NAMES) {
    const players = frontPlayers(name);
    const numbers = frontNumbers(players);
    const copy = structuredClone(players);
    const a = readFront(players, numbers, LOS);
    assert.deepEqual(players, copy);
    const shuffled = players.slice().reverse();
    assert.deepEqual(readFront(shuffled, numbers, LOS), a);
    assert.equal(a.box, a.defenders.length);
  }
  const players = frontPlayers('base');
  const numbers = { ...frontNumbers(players), C: null };
  assert.throws(() => readFront(players, numbers, LOS), /no center/);
});
