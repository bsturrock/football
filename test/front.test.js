import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFront, shade, liveGaps, HEAD_UP, LINE_DEPTH } from '../src/dots/front.js';
import { frontPlayers, frontNumbers, LOS, FRONT_NAMES } from './fixtures/fronts.js';
import { buildLineup } from '../src/dots/roster.js';
import { numberPlay } from '../src/dots/numbering.js';

const read = (name, personnel = 'noTe') => {
  const players = frontPlayers(name, personnel);
  return readFront(players, frontNumbers(players), LOS);
};
const def = (r, id) => r.defenders.find((d) => d.id === id);

test('base front', () => {
  const r = read('base');
  assert.equal(r.side, -1);
  assert.deepEqual(r.line.map((l) => l.id), ['LT', 'LG', 'C', 'RG', 'RT']);
  assert.deepEqual(r.covered.LT, ['RDE']);
  assert.deepEqual(r.covered.LG, []);
  assert.deepEqual(r.covered.C, ['RDT']);
  assert.deepEqual(r.covered.RG, ['LDT']);
  assert.equal(def(r, 'MLB').level, 'second');
  assert.equal(def(r, 'WLB').level, 'second');
});

test('over43', () => {
  const r = read('over43');
  assert.deepEqual(r.covered.LT, ['PE']);
  assert.deepEqual(r.covered.LG, ['PT']);
  assert.deepEqual(r.covered.C, []);
  assert.deepEqual(r.covered.RG, ['BT']);
  assert.deepEqual(def(r, 'PT').gap, { side: 'play', name: 'B' });
  assert.deepEqual(def(r, 'BT').gap, { side: 'back', name: 'A' });
  assert.deepEqual(def(r, 'PE').gap, { side: 'play', name: 'C' });
  assert.deepEqual(def(r, 'MIK').gap, { side: 'play', name: 'A' });
});

test('walkedUp', () => {
  const r = read('walkedUp');
  assert.equal(def(r, 'SAM').level, 'line');
});

test('backedOff', () => {
  const r = read('backedOff');
  assert.equal(def(r, 'BT').level, 'second');
});

test('odd34', () => {
  const r = read('odd34');
  assert.equal(def(r, 'N').gap, null);
  assert.deepEqual(r.covered.C, ['N']);
});

test('shade', () => {
  assert.equal(shade(0, HEAD_UP), 'head');
  assert.equal(shade(0, HEAD_UP + 0.01), 'playside');
  assert.equal(shade(0, -(HEAD_UP + 0.01)), 'backside');
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
    const b = readFront(shuffled, numbers, LOS);
    assert.equal(b.strong, a.strong);
    assert.equal(b.edge, a.edge);
    assert.equal(a.box, a.defenders.length);
  }
  const players = frontPlayers('base');
  const numbers = { ...frontNumbers(players), C: null };
  assert.throws(() => readFront(players, numbers, LOS), /no center/);
});

test('strong side is the TE side; null without a TE', () => {
  for (const name of FRONT_NAMES) {
    assert.equal(read(name, 'noTe').strong, null, name);
    assert.equal(read(name, 'te').strong, 'back', name);
  }
});

test('edge is the backside end man on the line, per the rule', () => {
  for (const name of FRONT_NAMES) {
    for (const p of ['noTe', 'te']) {
      const r = read(name, p);
      const cands = r.defenders.filter((d) => d.level === 'line' && d.u < -HEAD_UP);
      let want = null;
      let wantU = Infinity;
      for (const d of cands) {
        if (d.u < wantU || (d.u === wantU && String(d.id) < String(want))) { want = d.id; wantU = d.u; }
      }
      assert.equal(r.edge, want, `${name} ${p}`);
      if (r.edge !== null) {
        const d = def(r, r.edge);
        assert.equal(d.level, 'line', `${name} ${p}`);
        assert.ok(d.u < -HEAD_UP, `${name} ${p}`);
      }
    }
    assert.notEqual(read('base', 'noTe').edge, null);
    assert.notEqual(read('base', 'te').edge, null);
  }
});

test('edge does not depend on the TE', () => {
  for (const name of FRONT_NAMES) {
    assert.equal(read(name, 'noTe').edge, read(name, 'te').edge, name);
  }
});

test('edge is null when no defender is on the line', () => {
  const players = frontPlayers('base');
  const numbers = frontNumbers(players);
  const cx = players.find((p) => p.id === 'C').x;
  const moved = players.map((p) => (
    p.team === 'defense' && p.y - LOS <= LINE_DEPTH ? { ...p, x: cx } : { ...p }
  ));
  const r = readFront(moved, numbers, LOS);
  assert.equal(r.edge, null);
});

// Base insideZone lineup, numbered playside left, read as the defense would.
const liveSetup = () => {
  const players = buildLineup(LOS, 'insideZone');
  const numbers = numberPlay(players, { los: LOS, centerId: 'C', playside: 'left' });
  const f = readFront(players, numbers, LOS);
  return { players, f };
};
const xById = (players, id) => players.find((p) => p.id === id).x;
const span = (a, b) => ({ lo: Math.min(a, b), hi: Math.max(a, b) });

test('liveGaps playside walks A, B, C off the base line', () => {
  const { players, f } = liveSetup();
  const x = (id) => xById(players, id);
  const gaps = liveGaps(players, f.line, f.side, 1, 3);
  assert.equal(f.side, -1);
  assert.equal(gaps.length, 3);
  assert.deepEqual(gaps[0], { ...span(x('LG'), x('C')), outer: true });
  assert.deepEqual(gaps[1], { ...span(x('LT'), x('LG')), outer: true });
  const bWidth = x('LG') - x('LT');
  assert.deepEqual(gaps[2], { ...span(x('LT') - bWidth, x('LT')), outer: false });
});

test('liveGaps backside walks the backside gaps with dir -1', () => {
  const { players, f } = liveSetup();
  const x = (id) => xById(players, id);
  const gaps = liveGaps(players, f.line, f.side, -1, 1);
  assert.deepEqual(gaps, [{ ...span(x('C'), x('RG')), outer: true }]);
});

test('liveGaps follows live player x, not the snapshot in line', () => {
  const { players, f } = liveSetup();
  const before = liveGaps(players, f.line, f.side, 1, 3);
  const moved = players.map((p) => (p.id === 'LT' ? { ...p, x: p.x - 0.3 } : { ...p }));
  const after = liveGaps(moved, f.line, f.side, 1, 3);
  assert.ok(Math.abs((after[1].lo - before[1].lo) - -0.3) < 1e-9);
  assert.ok(Math.abs((after[2].lo - before[2].lo) - -0.6) < 1e-9);
  assert.equal(after[0].lo, before[0].lo);
});

test('liveGaps with a missing outer lineman: B as wide as A, C continues from B', () => {
  const { players, f } = liveSetup();
  const x = (id) => xById(players, id);
  const without = players.filter((p) => p.id !== 'LT');
  const gaps = liveGaps(without, f.line, f.side, 1, 3);
  const aWidth = x('C') - x('LG');
  const bOuter = x('LG') - aWidth;
  assert.deepEqual(gaps[0], { ...span(x('LG'), x('C')), outer: true });
  assert.deepEqual(gaps[1], { ...span(bOuter, x('LG')), outer: false });
  assert.ok(Math.abs((gaps[1].hi - gaps[1].lo) - aWidth) < 1e-9);
  const bWidth = gaps[1].hi - gaps[1].lo;
  assert.deepEqual(gaps[2], { ...span(bOuter - bWidth, bOuter), outer: false });
});

test('liveGaps with no center returns []', () => {
  const { players, f } = liveSetup();
  const without = players.filter((p) => p.id !== 'C');
  assert.deepEqual(liveGaps(without, f.line, f.side, 1, 3), []);
});

test('liveGaps does not mutate its arguments', () => {
  const { players, f } = liveSetup();
  const copyPlayers = structuredClone(players);
  const copyLine = structuredClone(f.line);
  liveGaps(players, f.line, f.side, 1, 3);
  liveGaps(players, f.line, f.side, -1, 2);
  assert.deepEqual(players, copyPlayers);
  assert.deepEqual(f.line, copyLine);
});
