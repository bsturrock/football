import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSITIONS, PLAYS, emptyAssignment, buildLineup } from '../src/dots/roster.js';

const byId = (id) => POSITIONS.find((p) => p.id === id);
const idsFor = (team) => POSITIONS.filter((p) => p.team === team).map((p) => p.id).sort();

test('13 positions with unique ids and all fields present', () => {
  assert.equal(POSITIONS.length, 13);
  assert.equal(new Set(POSITIONS.map((p) => p.id)).size, 13);
  for (const p of POSITIONS) {
    for (const k of ['id', 'name', 'team', 'role', 'dx', 'dy', 'speed', 'strength']) {
      assert.ok(k in p, `${p.id} missing ${k}`);
    }
    assert.ok(p.team === 'offense' || p.team === 'defense');
  }
});

test('exact id sets per team', () => {
  assert.deepEqual(idsFor('offense'), ['C', 'LG', 'LT', 'QB', 'RB', 'RG', 'RT']);
  assert.deepEqual(idsFor('defense'), ['LDE', 'LDT', 'MLB', 'RDE', 'RDT', 'WLB']);
});

test('roles as listed', () => {
  const expected = {
    LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', QB: 'QB', RB: 'RB',
    LDE: 'DE', LDT: 'DT', RDT: 'DT', RDE: 'DE', MLB: 'LB', WLB: 'LB',
  };
  for (const [id, role] of Object.entries(expected)) {
    assert.equal(byId(id).role, role, id);
  }
});

test('offense is behind the line, defense is past it', () => {
  for (const p of POSITIONS.filter((p) => p.team === 'offense')) assert.ok(p.dy < 0, p.id);
  for (const p of POSITIONS.filter((p) => p.team === 'defense')) assert.ok(p.dy > 0, p.id);
});

test('OL dx strictly increasing LT to RT', () => {
  const ol = ['LT', 'LG', 'C', 'RG', 'RT'].map((id) => byId(id).dx);
  for (let i = 1; i < ol.length; i++) assert.ok(ol[i] > ol[i - 1]);
});

test('OL forms a V pointing at the defense', () => {
  const C = byId('C');
  const LG = byId('LG');
  const RG = byId('RG');
  const LT = byId('LT');
  const RT = byId('RT');
  assert.equal(C.dx, 0);
  assert.equal(C.dy, -0.7);
  assert.equal(LG.dy, -1.2);
  assert.equal(RG.dy, LG.dy);
  assert.equal(LT.dy, -1.5);
  assert.equal(RT.dy, LT.dy);
  assert.equal(LG.dy, RG.dy);
  assert.ok(C.dy > LG.dy);
  assert.ok(LG.dy > LT.dy);
  assert.equal(LG.dx, -RG.dx);
  assert.equal(LT.dx, -RT.dx);
});

test('linebackers sit deeper than defensive linemen', () => {
  const lbDy = Math.min(...POSITIONS.filter((p) => p.role === 'LB').map((p) => p.dy));
  const dlDy = Math.max(...POSITIONS.filter((p) => ['DE', 'DT'].includes(p.role)).map((p) => p.dy));
  assert.ok(lbDy > dlDy);
});

test('QB and RB alignment in the backfield', () => {
  const qb = byId('QB');
  const rb = byId('RB');
  assert.equal(qb.dx, 0);
  assert.equal(qb.dy, -4.5);
  assert.equal(rb.dy, qb.dy);
  assert.equal(rb.dx, 1.8);
});

test('QB/RB shotgun spacing measured from C', () => {
  const C = byId('C');
  const QB = byId('QB');
  const RB = byId('RB');
  assert.ok(Math.abs(QB.dy - C.dy + 3.8) < 1e-9);
  assert.equal(QB.dx, C.dx);
  assert.equal(RB.dy, QB.dy);
  assert.ok(Math.abs(RB.dx - C.dx - 1.8) < 1e-9);
});

test('buildLineup(25) positions players from the line of scrimmage', () => {
  const lineup = buildLineup(25);
  assert.equal(lineup.length, 13);
  lineup.forEach((pl, i) => {
    const p = POSITIONS[i];
    assert.equal(pl.id, p.id);
    assert.equal(pl.x, p.dx);
    assert.equal(pl.y, 25 + p.dy);
  });
  assert.equal(lineup.find((pl) => pl.id === 'QB').y, 20.5);
});

test('buildLineup gives every player a distinct empty assignment', () => {
  const a = buildLineup(25);
  for (const pl of a) assert.deepEqual(pl.assignment, { goal: null, target: null });
  assert.deepEqual(emptyAssignment(), { goal: null, target: null });
  assert.notEqual(a[0].assignment, a[1].assignment);
  const b = buildLineup(25);
  assert.notEqual(a[0].assignment, b[0].assignment);
  a[0].assignment.goal = 'x';
  assert.equal(a[1].assignment.goal, null);
  assert.equal(b[0].assignment.goal, null);
});

test('every position has speed and strength', () => {
  const rating = {
    OL: { speed: 6.0, strength: 1.0 },
    QB: { speed: 7.0, strength: 0.3 },
    RB: { speed: 8.0, strength: 0.5 },
    DT: { speed: 6.5, strength: 0.6 },
    DE: { speed: 7.0, strength: 0.5 },
    LB: { speed: 7.5, strength: 0.5 },
  };
  for (const p of POSITIONS) {
    assert.equal(typeof p.speed, 'number', p.id);
    assert.equal(typeof p.strength, 'number', p.id);
    assert.ok(p.speed > 0, p.id);
    assert.ok(p.strength >= 0, p.id);
    assert.deepEqual({ speed: p.speed, strength: p.strength }, rating[p.role], p.id);
  }
});

test('OL out-strength every defender at any angle', () => {
  const ols = POSITIONS.filter((p) => p.role === 'OL');
  const defs = POSITIONS.filter((p) => p.team === 'defense');
  for (const ol of ols) {
    for (const def of defs) {
      assert.ok(ol.strength * Math.SQRT1_2 > def.strength, `${ol.id} vs ${def.id}`);
    }
  }
});

test('buildLineup copies ratings', () => {
  const lineup = buildLineup(25);
  for (const pl of lineup) {
    const p = byId(pl.id);
    assert.equal(pl.speed, p.speed, pl.id);
    assert.equal(pl.strength, p.strength, pl.id);
  }
});

test('buildLineup throws on unknown play key', () => {
  assert.throws(() => buildLineup(25, 'nope'), /nope/);
});

test('PLAYS.base ball handoff points exist in POSITIONS', () => {
  assert.deepEqual(PLAYS.base.ball, { start: 'C', snapTo: 'QB' });
  assert.ok(byId(PLAYS.base.ball.start));
  assert.ok(byId(PLAYS.base.ball.snapTo));
});

test('POSITIONS and PLAYS are frozen', () => {
  assert.ok(Object.isFrozen(POSITIONS));
  for (const p of POSITIONS) assert.ok(Object.isFrozen(p), p.id);
  assert.ok(Object.isFrozen(PLAYS));
});
