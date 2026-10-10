import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberPlay, A_GAP_HALF, LINE_ROLES } from '../src/dots/numbering.js';
import { POSITIONS, buildLineup } from '../src/dots/roster.js';
import { isBlocker, BLOCKER_ROLES } from '../src/dots/blocking.js';

// numbering rules are tested on fixed coordinates; the real roster's numbers are covered by `test/inside-zone.test.js`.
const FIXTURE = Object.freeze([
  ['LT', 'offense', 'OL', -4.4, -1.5],
  ['LG', 'offense', 'OL', -2.2, -1.2],
  ['C', 'offense', 'OL', 0, -0.7],
  ['RG', 'offense', 'OL', 2.2, -1.2],
  ['RT', 'offense', 'OL', 4.4, -1.5],
  ['QB', 'offense', 'QB', 0, -4.5],
  ['RB', 'offense', 'RB', 1.8, -4.5],
  ['LDE', 'defense', 'DE', 5.4, 1.1],
  ['LDT', 'defense', 'DT', 1.8, 1.1],
  ['RDT', 'defense', 'DT', -1.8, 1.1],
  ['RDE', 'defense', 'DE', -5.4, 1.1],
  ['MLB', 'defense', 'LB', 2.0, 4.5],
  ['WLB', 'defense', 'LB', -2.0, 4.5],
]);

const setup = () => {
  const ps = FIXTURE.map(([id, team, role, dx, dy]) => ({ id, team, role, x: dx, y: 25 + dy }));
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

test('F-14 #11: no playside lineman: 0-gap fallback is half the roster C-guard split', () => {
  const C = POSITIONS.find((p) => p.id === 'C');
  const RG = POSITIONS.find((p) => p.id === 'RG');
  assert.equal(A_GAP_HALF, Math.abs(RG.dx - C.dx) / 2);
  const mk = (guardX, guardId, dir) => [
    { id: 'C', team: 'offense', role: 'OL', x: 0, y: 24.6 },
    { id: guardId, team: 'offense', role: 'OL', x: guardX, y: 24.3 },
    { id: 'A', team: 'defense', role: 'DT', x: dir * A_GAP_HALF, y: 25.7 },
    { id: 'B', team: 'defense', role: 'DT', x: dir * (A_GAP_HALF + 0.3), y: 25.7 },
  ];
  const left = numberPlay(mk(2.2, 'RG', -1), { los: 25, centerId: 'C', playside: 'left' });
  assert.equal(left.A, 0);
  assert.equal(left.B, 1);
  const right = numberPlay(mk(-2.2, 'LG', 1), { los: 25, centerId: 'C', playside: 'right' });
  assert.equal(right.A, 0);
  assert.equal(right.B, 1);
});

test('F-39 #2: LINE_ROLES and BLOCKER_ROLES both include TE and OL', () => {
  for (const roles of [LINE_ROLES, BLOCKER_ROLES]) {
    assert.ok(roles.includes('TE'));
    assert.ok(roles.includes('OL'));
  }
});

test('F-39 #2: TE lineup, backside TE numbers after the backside tackle; OL unchanged', () => {
  const te = buildLineup(25, 'insideZone', { personnel: 'te' });
  const noTe = buildLineup(25, 'insideZone', { personnel: 'noTe' });
  const teP = te.find((p) => p.role === 'TE');
  const n = numberPlay(te, { los: 25, centerId: 'C', playside: 'left' });
  const nNoTe = numberPlay(noTe, { los: 25, centerId: 'C', playside: 'left' });
  assert.equal(n[teP.id], n.RT - 1);
  for (const p of te.filter((q) => q.role === 'OL')) assert.equal(n[p.id], nNoTe[p.id], p.id);
  for (const p of te) if (p.role === 'QB' || p.role === 'RB') assert.equal(n[p.id], null);
});

test('F-39 #2: playside TE numbers after the playside tackle', () => {
  const te = buildLineup(25, 'insideZone', { personnel: 'te' });
  const teP = te.find((p) => p.role === 'TE');
  const n = numberPlay(te, { los: 25, centerId: 'C', playside: 'right' });
  assert.equal(n[teP.id], n.RT + 1);
});

test('F-39 #2: isBlocker true for TE, false for QB, RB and defenders', () => {
  const te = buildLineup(25, 'insideZone', { personnel: 'te' });
  assert.equal(isBlocker(te.find((p) => p.role === 'TE')), true);
  for (const p of te) {
    if (p.role === 'QB' || p.role === 'RB' || p.team === 'defense') assert.equal(isBlocker(p), false, p.id);
  }
});

test('F-39 #2: no-TE numbers are unchanged: equal the base play numbers and the TE lineup without the TE', () => {
  const explicit = buildLineup(25, 'insideZone', { personnel: 'noTe' });
  assert.deepEqual(
    numberPlay(explicit, { los: 25, centerId: 'C', playside: 'left' }),
    numberPlay(buildLineup(25, 'base'), { los: 25, centerId: 'C', playside: 'left' }),
  );
  const withTe = numberPlay(buildLineup(25, 'insideZone', { personnel: 'te' }), { los: 25, centerId: 'C', playside: 'left' });
  delete withTe.TE;
  assert.deepEqual(withTe, numberPlay(explicit, { los: 25, centerId: 'C', playside: 'left' }));
});
