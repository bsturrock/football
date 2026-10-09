import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineup } from '../src/dots/roster.js';
import { numberPlay } from '../src/dots/numbering.js';

const setup = () => {
  const ps = buildLineup(25, 'base');
  const c = ps.find((p) => p.role === 'OL' && p.x === 0);
  return { ps, c, by: (x, team = 'defense') => ps.find((p) => p.team === team && Math.abs(p.x - x) < 1e-6) };
};
const run = (ps, c, playside) => numberPlay(ps, { los: 25, centerId: c.id, playside });
const at = (ps, x, team = 'defense') => ps.find((p) => p.team === team && Math.abs(p.x - x) < 1e-6);
const check = (ps, out, spec, team) => {
  for (const [x, n] of spec) assert.equal(out[at(ps, x, team).id], n, `x=${x}`);
};
const off = [[0, 0], [-2.2, 1], [-4.4, 2], [2.2, -1], [4.4, -2]];
const offR = [[0, 0], [2.2, 1], [4.4, 2], [-2.2, -1], [-4.4, -2]];

test('base left/right', () => {
  const { ps, c } = setup();
  let o = run(ps, c, 'left');
  check(ps, o, off.filter(([x]) => true).map(([x, n]) => [x, n]), 'offense');
  check(ps, o, [[-1.8, 0], [-2.0, 1], [-5.4, 2], [1.8, -1], [2.0, -2], [5.4, -3]]);
  for (const p of ps) if (p.role === 'QB' || p.role === 'RB') assert.equal(o[p.id], null);
  o = run(ps, c, 'right');
  check(ps, o, offR, 'offense');
  check(ps, o, [[1.8, 0], [2.0, 1], [5.4, 2], [-1.8, -1], [-2.0, -2], [-5.4, -3]]);
});

test('moved LBs', () => {
  const { ps, c } = setup();
  at(ps, 2.0).x = -1.6; at(ps, -2.0).x = -5.6;
  const o = run(ps, c, 'left');
  check(ps, o, [[-1.6, 0], [-1.8, 1], [-5.4, 2], [-5.6, 3], [1.8, -1], [5.4, -2]]);
});

test('shifted DL', () => {
  const { ps, c } = setup();
  at(ps, -5.4).x = -3.0; at(ps, -1.8).x = 0.6; at(ps, 1.8).x = 4.2; at(ps, 5.4).x = 7.8;
  const o = run(ps, c, 'left');
  check(ps, o, [[-2.0, 0], [-3.0, 1], [0.6, -1], [2.0, -2], [4.2, -3], [7.8, -4]]);
});

test('box exclusion', () => {
  const { ps, c } = setup();
  const far = at(ps, 5.4); far.x = 9.0;
  const deep = at(ps, 2.0); deep.y = 33.5;
  const o = run(ps, c, 'left');
  assert.equal(o[far.id], null);
  assert.equal(o[deep.id], null);
  check(ps, o, [[-1.8, 0], [-2.0, 1], [-5.4, 2], [1.8, -1]]);
});

test('0 tie broken by depth', () => {
  const { ps, c } = setup();
  const a = at(ps, -1.8), b = at(ps, -2.0);
  b.x = -1.8; b.y = 25.5;
  const o = run(ps, c, 'left');
  assert.equal(o[b.id], 0);
  assert.equal(o[a.id], 1);
});

test('stacked defenders: shallower first', () => {
  const { ps, c } = setup();
  const lb = at(ps, -2.0); lb.x = 1.8; // stacked behind LDT
  const dt = at(ps, 1.8, 'defense');
  const o = run(ps, c, 'left');
  const pair = ps.filter((p) => p.team === 'defense' && p.x === 1.8);
  assert.equal(pair.length, 2);
  pair.sort((p, q) => p.y - q.y);
  assert.equal(o[pair[0].id], -1);
  assert.equal(o[pair[1].id], -2);
  assert.ok(dt);
});

test('bad playside throws, no mutation', () => {
  const { ps, c } = setup();
  assert.throws(() => run(ps, c, 'up'));
  assert.throws(() => numberPlay(ps, { los: 25, centerId: 'nope', playside: 'left' }));
  const snap = JSON.stringify(ps);
  run(ps, c, 'left');
  assert.equal(JSON.stringify(ps), snap);
});
