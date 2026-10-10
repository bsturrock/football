import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFront, GAP_NAMES } from '../src/dots/front.js';
import { frontPlayers, frontNumbers, LOS, FRONT_NAMES } from './fixtures/fronts.js';
import { POSITIONS } from '../src/dots/roster.js';
import { BOX_MARGIN } from '../src/dots/numbering.js';

const dxOf = (id) => POSITIONS.find((p) => p.id === id).dx;

const base = () => {
  const players = frontPlayers('base');
  return { players, numbers: frontNumbers(players) };
};
const def = (r, id) => r.defenders.find((d) => d.id === id);

// Base 4-3 with the WLB moved to a lateral x (center is at x = 0).
const withWlbAt = (x) => {
  const { players, numbers } = base();
  const moved = players.map((p) => (p.id === 'WLB' ? { ...p, x } : p));
  return readFront(moved, numbers, LOS);
};

test('F-19 #1: base insideZone fits: WLB play B, MLB back A', () => {
  const { players, numbers } = base();
  const read = readFront(players, numbers, LOS);
  assert.deepEqual(def(read, 'WLB').fit, { side: 'play', name: 'B' });
  assert.deepEqual(def(read, 'MLB').fit, { side: 'back', name: 'A' });
  for (const id of ['LDT', 'RDT', 'LDE', 'RDE']) {
    const { fit } = def(read, id);
    assert.ok(['play', 'back'].includes(fit.side), id);
    assert.ok(GAP_NAMES.includes(fit.name), id);
  }
});

test('F-19 #1: base read keeps level, cover, gap and u for WLB', () => {
  const { players, numbers } = base();
  const read = readFront(players, numbers, LOS);
  const wlb = def(read, 'WLB');
  assert.equal(wlb.level, 'second');
  assert.equal(wlb.cover, null);
  assert.equal(wlb.gap, null);
  assert.equal(wlb.u, -dxOf('WLB'));
});

test('F-19 #1: head-up on the center is play A', () => {
  assert.deepEqual(def(withWlbAt(0), 'WLB').fit, { side: 'play', name: 'A' });
});

test('F-19 #1: a third of the way to LG is play A', () => {
  assert.deepEqual(def(withWlbAt(dxOf('LG') / 3), 'WLB').fit, { side: 'play', name: 'A' });
});

test('F-19 #1: head-up on LG is play B', () => {
  assert.deepEqual(def(withWlbAt(dxOf('LG')), 'WLB').fit, { side: 'play', name: 'B' });
});

test('F-19 #1: head-up on RG is back A', () => {
  assert.deepEqual(def(withWlbAt(dxOf('RG')), 'WLB').fit, { side: 'back', name: 'A' });
});

test('F-19 #1: between RG and RT is back B', () => {
  assert.deepEqual(def(withWlbAt((dxOf('RG') + dxOf('RT')) / 2), 'WLB').fit, { side: 'back', name: 'B' });
});

test('F-19 #1: far outside playside, inside the box, is play C', () => {
  assert.deepEqual(def(withWlbAt(dxOf('LT') - BOX_MARGIN + 1), 'WLB').fit, { side: 'play', name: 'C' });
});

test('F-19 #1: every defender in every front has a valid fit', () => {
  for (const name of FRONT_NAMES) {
    const players = frontPlayers(name);
    const read = readFront(players, frontNumbers(players), LOS);
    for (const d of read.defenders) {
      assert.ok(['play', 'back'].includes(d.fit.side), `${name} ${d.id} side`);
      assert.ok(GAP_NAMES.includes(d.fit.name), `${name} ${d.id} name`);
    }
  }
});
