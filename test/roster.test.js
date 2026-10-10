import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSITIONS, PLAYS, FRONTS, emptyAssignment, buildLineup } from '../src/dots/roster.js';
import { BODY_RADIUS, CONTACT_DIST, SPREAD } from '../src/dots/blocking.js';
import { DL_SHIFT_STEP, LB_SHIFT_STEP } from '../src/dots/play.js';
import { POSITION_COUNT, DEFENSE_IDS, ROLES, BASE_LB_IDS, LB_READ } from './fixtures/base-front.js';

const byId = (id) => POSITIONS.find((p) => p.id === id);
const idsFor = (team) => POSITIONS.filter((p) => p.team === team).map((p) => p.id).sort();

test(`${POSITION_COUNT} positions with unique ids and all fields present`, () => {
  assert.equal(POSITIONS.length, POSITION_COUNT);
  assert.equal(new Set(POSITIONS.map((p) => p.id)).size, POSITION_COUNT);
  for (const p of POSITIONS) {
    for (const k of ['id', 'name', 'team', 'role', 'dx', 'dy', 'speed', 'strength']) {
      assert.ok(k in p, `${p.id} missing ${k}`);
    }
    assert.ok(p.team === 'offense' || p.team === 'defense');
  }
});

test('exact id sets per team', () => {
  assert.deepEqual(idsFor('offense'), ['C', 'LG', 'LT', 'QB', 'RB', 'RG', 'RT']);
  assert.deepEqual(idsFor('defense'), DEFENSE_IDS);
});

test('roles as listed', () => {
  for (const [id, role] of Object.entries(ROLES)) {
    assert.equal(byId(id).role, role, id);
  }
  assert.deepEqual(POSITIONS.filter((p) => p.role === 'LB').map((p) => p.id).sort(), BASE_LB_IDS);
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
  assert.equal(C.dy, -0.4);
  assert.equal(LG.dy, -0.75);
  assert.equal(RG.dy, LG.dy);
  assert.equal(LT.dy, -0.9);
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
  assert.equal(qb.dy, -5.0);
  assert.equal(rb.dy, qb.dy);
  assert.equal(rb.dx, 1.8);
});

test('QB/RB shotgun spacing measured from C', () => {
  const C = byId('C');
  const QB = byId('QB');
  const RB = byId('RB');
  assert.ok(Math.abs(QB.dy - C.dy + 4.6) < 1e-9);
  assert.equal(QB.dx, C.dx);
  assert.equal(RB.dy, QB.dy);
  assert.ok(Math.abs(RB.dx - C.dx - 1.8) < 1e-9);
});

test('buildLineup(25) positions players from the line of scrimmage', () => {
  const lineup = buildLineup(25);
  assert.equal(lineup.length, POSITION_COUNT);
  lineup.forEach((pl, i) => {
    const p = POSITIONS[i];
    assert.equal(pl.id, p.id);
    assert.equal(pl.x, p.dx);
    assert.equal(pl.y, 25 + p.dy);
  });
  assert.equal(lineup.find((pl) => pl.id === 'QB').y, 20);
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

test('DL evenly spaced and centered on the ball', () => {
  const LDE = byId('LDE');
  const LDT = byId('LDT');
  const RDT = byId('RDT');
  const RDE = byId('RDE');
  assert.equal(LDE.dx, 3.6);
  assert.equal(LDT.dx, 1.2);
  assert.equal(RDT.dx, -1.2);
  assert.equal(RDE.dx, -3.6);
  assert.ok(Math.abs(LDE.dx - LDT.dx - 2.4) < 1e-9);
  assert.ok(Math.abs(LDT.dx - RDT.dx - 2.4) < 1e-9);
  assert.ok(Math.abs(RDT.dx - RDE.dx - 2.4) < 1e-9);
  assert.equal(LDE.dx, -RDE.dx);
  assert.equal(LDT.dx, -RDT.dx);
});

test('F-14 #1: NFL body radius', () => {
  assert.equal(BODY_RADIUS, 0.35);
  assert.equal(CONTACT_DIST, 2 * BODY_RADIUS);
  assert.equal(SPREAD, 2 * BODY_RADIUS);
  assert.equal(DL_SHIFT_STEP, BODY_RADIUS);
  assert.equal(LB_SHIFT_STEP, BODY_RADIUS);
});

test('F-14 #2: NFL OL splits', () => {
  const want = {
    LT: [-3.0, -0.9], LG: [-1.5, -0.75], C: [0, -0.4], RG: [1.5, -0.75], RT: [3.0, -0.9],
  };
  for (const [id, [dx, dy]] of Object.entries(want)) {
    assert.equal(byId(id).dx, dx, `${id} dx`);
    assert.equal(byId(id).dy, dy, `${id} dy`);
  }
  const chain = ['LT', 'LG', 'C', 'RG', 'RT'].map((id) => byId(id).dx);
  for (let i = 1; i < chain.length; i++) {
    assert.ok(Math.abs(chain[i] - chain[i - 1] - 1.5) < 1e-9, `gap ${i}`);
  }
  const split = 1.5 - 2 * BODY_RADIUS;
  assert.ok(split >= 2 / 3 && split <= 1, `body-to-body split ${split}`);
});

test('F-14 #3: front and LBs', () => {
  for (const id of ['LDE', 'LDT', 'RDT', 'RDE']) assert.equal(byId(id).dy, 0.7, id);
  assert.deepEqual([byId('MLB').dx, byId('MLB').dy], [1.6, 4.5]);
  assert.deepEqual([byId('WLB').dx, byId('WLB').dy], [-1.6, 4.5]);
  assert.deepEqual([byId('QB').dx, byId('QB').dy], [0, -5.0]);
  assert.deepEqual([byId('RB').dx, byId('RB').dy], [1.8, -5.0]);
});

test('F-14 #4: no pre-snap overlap at any shift', () => {
  for (let k = -4; k <= 4; k++) {
    for (let j = -6; j <= 6; j++) {
      const lineup = buildLineup(25, 'insideZone', { dlShift: k * DL_SHIFT_STEP, lbShift: j * LB_SHIFT_STEP });
      for (let a = 0; a < lineup.length; a++) {
        for (let b = a + 1; b < lineup.length; b++) {
          const d = Math.hypot(lineup[a].x - lineup[b].x, lineup[a].y - lineup[b].y);
          assert.ok(d >= 2 * BODY_RADIUS - 1e-9, `k=${k} j=${j} ${lineup[a].id}-${lineup[b].id} d=${d}`);
        }
      }
    }
  }
});

const FRONT_KEYS = ['base', 'over43', 'under43', 'odd34', 'bear', 'walkedUp', 'backedOff'];
const baseRating = (role) => {
  const p = POSITIONS.find((r) => r.team === 'defense' && r.role === role);
  return { speed: p.speed, strength: p.strength };
};

test('FRONTS keys and names as listed', () => {
  assert.deepEqual(Object.keys(FRONTS), FRONT_KEYS);
  const names = {
    base: '4-3 Base', over43: '4-3 Over', under43: '4-3 Under', odd34: '3-4', bear: 'Bear',
    walkedUp: '4-3 Over, Sam Walked Up', backedOff: '4-3 Under, 3-Tech Backed Off',
  };
  for (const [k, name] of Object.entries(names)) assert.equal(FRONTS[k].name, name, k);
});

test('FRONTS, every entry, defenders array and row are frozen', () => {
  assert.ok(Object.isFrozen(FRONTS));
  for (const k of FRONT_KEYS) {
    assert.ok(Object.isFrozen(FRONTS[k]), k);
    assert.ok(Object.isFrozen(FRONTS[k].defenders), `${k} defenders`);
    for (const d of FRONTS[k].defenders) assert.ok(Object.isFrozen(d), `${k} ${d.id}`);
  }
});

test('FRONTS.base defenders are the POSITIONS defense rows', () => {
  const defs = POSITIONS.filter((p) => p.team === 'defense');
  assert.equal(FRONTS.base.defenders.length, defs.length);
  defs.forEach((p, i) => assert.ok(FRONTS.base.defenders[i] === p, p.id));
});

test('every front has unique defender ids, no clash with offense, team defense, dy > 0, base ratings', () => {
  const offenseIds = new Set(POSITIONS.filter((p) => p.team === 'offense').map((p) => p.id));
  for (const k of FRONT_KEYS) {
    const defs = FRONTS[k].defenders;
    const ids = defs.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length, `${k} unique ids`);
    for (const d of defs) {
      assert.ok(!offenseIds.has(d.id), `${k} ${d.id} clashes with offense`);
      assert.equal(d.team, 'defense', `${k} ${d.id}`);
      assert.ok(d.dy > 0, `${k} ${d.id} dy`);
      const r = baseRating(d.role);
      assert.deepEqual({ speed: d.speed, strength: d.strength }, r, `${k} ${d.id}`);
    }
  }
});

test('OL out-strength every FRONTS defender at any angle', () => {
  const ols = POSITIONS.filter((p) => p.role === 'OL');
  for (const k of FRONT_KEYS) {
    for (const ol of ols) {
      for (const def of FRONTS[k].defenders) {
        assert.ok(ol.strength * Math.SQRT1_2 > def.strength, `${k} ${ol.id} vs ${def.id}`);
      }
    }
  }
});

test('buildLineup with odd34 front: 7 offense then odd34 defenders at x = dx, y = los + dy', () => {
  const lineup = buildLineup(25, 'insideZone', { front: 'odd34' });
  assert.equal(lineup.length, 7 + FRONTS.odd34.defenders.length);
  assert.ok(lineup.slice(0, 7).every((pl) => pl.team === 'offense'));
  FRONTS.odd34.defenders.forEach((d, i) => {
    const pl = lineup[7 + i];
    assert.equal(pl.id, d.id);
    assert.equal(pl.x, d.dx);
    assert.equal(pl.y, 25 + d.dy);
  });
});

test('front plus dlShift moves only that front DE/DT; lbShift moves only LBs', () => {
  const base = buildLineup(25, 'insideZone', { front: 'bear' });
  const dl = buildLineup(25, 'insideZone', { front: 'bear', dlShift: 1.2 });
  base.forEach((pl, i) => {
    const moved = ['DE', 'DT'].includes(pl.role);
    assert.equal(dl[i].x, pl.x + (moved ? 1.2 : 0), pl.id);
  });
  const lb = buildLineup(25, 'insideZone', { front: 'odd34' });
  const lbs = buildLineup(25, 'insideZone', { front: 'odd34', lbShift: -2 });
  lb.forEach((pl, i) => {
    const moved = pl.role === 'LB';
    assert.equal(lbs[i].x, pl.x + (moved ? -2 : 0), pl.id);
  });
});

test('buildLineup throws on unknown front, message names it', () => {
  assert.throws(() => buildLineup(25, 'insideZone', { front: 'nope' }), /nope/);
});

test('F-19 #2: pos rows frozen with def frozen or null', () => {
  for (const p of POSITIONS) {
    assert.ok(Object.isFrozen(p), p.id);
    assert.ok(p.def === null || Object.isFrozen(p.def), `${p.id} def not frozen`);
  }
  for (const f of Object.values(FRONTS)) {
    for (const d of f.defenders) {
      assert.ok(Object.isFrozen(d), d.id);
      assert.ok(d.def === null || Object.isFrozen(d.def), `${d.id} def not frozen`);
    }
  }
});

test('F-19 #2: base LB def.read per row', () => {
  for (const [id, r] of Object.entries(LB_READ)) assert.equal(byId(id).def.read, r, id);
  assert.deepEqual(Object.keys(LB_READ).sort(), BASE_LB_IDS);
});

test('F-19 #2: every LB-role defender in every FRONTS entry has the base MLB def, except the other base LBs', () => {
  const mlbDef = byId('MLB').def;
  for (const [key, f] of Object.entries(FRONTS)) {
    for (const d of f.defenders) {
      if (d.role !== 'LB') continue;
      if (key === 'base' && d.id !== 'MLB') {
        assert.deepEqual(d.def, byId(d.id).def, `base ${d.id}`);
        continue;
      }
      assert.deepEqual(d.def, mlbDef, `${key} ${d.id}`);
    }
  }
});

test('F-19 #2: every non-null def.read is in [0.3, 0.6]', () => {
  for (const f of Object.values(FRONTS)) {
    for (const d of f.defenders) {
      if (d.def && d.def.read !== undefined) {
        assert.ok(d.def.read >= 0.3 && d.def.read <= 0.6, `${d.id} read ${d.def.read}`);
      }
    }
  }
});

test('F-19 #2: buildLineup players carry their row def; non-LB players have def null', () => {
  const lineup = buildLineup(25, 'insideZone', { front: 'bear' });
  const defs = FRONTS.bear.defenders;
  defs.forEach((d, i) => {
    const pl = lineup[7 + i];
    assert.equal(pl.id, d.id);
    assert.deepEqual(pl.def, d.def, d.id);
    if (d.role !== 'LB') assert.equal(pl.def, null, d.id);
  });
  assert.ok(lineup.slice(0, 7).every((pl) => pl.def === null));
});
