import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dots2Lineup, LOS } from '../src/dots2/lineup.js';
import { POSITIONS, PERSONNEL, DEF_PERSONNEL, DL_DEPTH, LB_DEPTH } from '../src/dots/roster.js';

const ORDER = ['LT', 'LG', 'C', 'RG', 'RT', 'QB', 'RB', 'TE', 'PE', 'PT', 'BT', 'BE', 'MIK', 'WIL'];
const NICKEL = DEF_PERSONNEL.nickel.defenders;

function rowFor(id) {
  return POSITIONS.find((p) => p.id === id) ?? PERSONNEL.te.rows.find((p) => p.id === id) ?? NICKEL.find((p) => p.id === id);
}

test('dots2Lineup has 14 players in order with the right roles and teams', () => {
  const players = dots2Lineup();
  assert.equal(players.length, 14);
  assert.equal(new Set(players.map((p) => p.id)).size, 14);
  assert.deepEqual(players.map((p) => p.id), ORDER);
  const count = (role) => players.filter((p) => p.role === role).length;
  assert.equal(count('OL'), 5);
  assert.equal(count('QB'), 1);
  assert.equal(count('RB'), 1);
  assert.equal(count('TE'), 1);
  assert.equal(count('DE'), 2);
  assert.equal(count('DT'), 2);
  assert.equal(count('LB'), 2);
  const offense = ['OL', 'QB', 'RB', 'TE'];
  for (const p of players.filter((q) => offense.includes(q.role))) assert.equal(p.team, 'offense');
  for (const p of players.filter((q) => !offense.includes(q.role))) assert.equal(p.team, 'defense');
});

test('QB, RB and TE stand at their pre-snap spots on the dots page', () => {
  const players = dots2Lineup();
  const at = (id) => players.find((p) => p.id === id);
  const qb = at('QB');
  assert.equal(qb.x, 0);
  assert.ok(Math.abs(qb.y - (LOS - 5.3)) < 1e-9);
  const rb = at('RB');
  assert.ok(Math.abs(rb.x - 1.6) < 1e-9);
  assert.ok(Math.abs(rb.y - (LOS - 5.3)) < 1e-9);
  const te = at('TE');
  assert.ok(Math.abs(te.x - 3.6) < 1e-9);
  assert.ok(Math.abs(te.y - (LOS - 0.75)) < 1e-9);
});

test('each player sits at its roster dx and LOS + dy, with the depth constants', () => {
  const players = dots2Lineup();
  for (const p of players) {
    const row = rowFor(p.id);
    assert.ok(row, `roster row for ${p.id}`);
    assert.equal(p.x, row.dx);
    assert.equal(p.y, LOS + row.dy);
  }
  for (const p of players.filter((q) => q.role === 'DE' || q.role === 'DT')) {
    assert.equal(p.y, LOS + DL_DEPTH);
  }
  const lbs = players.filter((q) => q.role === 'LB');
  for (const p of lbs) assert.equal(p.y, LOS + LB_DEPTH);
  const dlY = players.find((q) => q.role === 'DE').y;
  for (const p of lbs) assert.ok(Math.abs(p.y - dlY - 3) < 1e-9);
});

test('dots2Lineup(40) shifts every y by 15 and no x', () => {
  const base = dots2Lineup();
  const shifted = dots2Lineup(40);
  assert.equal(shifted.length, base.length);
  base.forEach((p, i) => {
    assert.equal(shifted[i].x, p.x);
    assert.ok(Math.abs(shifted[i].y - p.y - 15) < 1e-9);
  });
});

test('dots2Lineup returns fresh objects on each call', () => {
  const a = dots2Lineup();
  const b = dots2Lineup();
  assert.notEqual(a[0], b[0]);
  a[0].x = 999;
  assert.notEqual(b[0].x, 999);
  assert.notEqual(a[0].x, b[0].x);
});

test('every src/dots2 module imports only the allowed specifiers', () => {
  const dir = fileURLToPath(new URL('../src/dots2/', import.meta.url));
  const allowed = new Set(['../dots/roster.js', '../dots/geometry.js', '../util.js']);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.includes('lineup.js'));
  const specRe = /(?:\bfrom\s+|\bimport\s+)['"]([^'"]+)['"]/g;
  for (const file of files) {
    const src = fs.readFileSync(new URL(file, new URL('../src/dots2/', import.meta.url)), 'utf8');
    for (const m of src.matchAll(specRe)) {
      const sibling = /^\.\/[\w-]+\.js$/.test(m[1]) && files.includes(m[1].slice(2));
      assert.ok(allowed.has(m[1]) || sibling, `${file} imports disallowed "${m[1]}"`);
    }
  }
});
