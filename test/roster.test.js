import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSITIONS, PERSONNEL, PLAYS, FRONTS, DEF_PERSONNEL, BALL_LENGTH, BALL_WIDTH, MOVE_COUNTER, FORMATIONS, emptyAssignment, buildLineup, moveOdds, DL_DEPTH, LB_DEPTH, SS_DEPTH, FS_DEPTH } from '../src/dots/roster.js';
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
  assert.equal(C.dy, -0.28);
  assert.equal(LG.dy, -0.6);
  assert.equal(RG.dy, LG.dy);
  assert.equal(LT.dy, -0.75);
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
  assert.equal(qb.dy, -5.3);
  assert.equal(rb.dy, qb.dy);
  assert.equal(rb.dx, 1.6);
});

test('QB/RB shotgun spacing measured from C', () => {
  const C = byId('C');
  const QB = byId('QB');
  const RB = byId('RB');
  assert.ok(Math.abs(QB.dy - C.dy + 5.02) < 1e-9);
  assert.ok(QB.dy - C.dy >= -7 && QB.dy - C.dy <= -5);
  assert.equal(QB.dx, C.dx);
  assert.equal(RB.dy, QB.dy);
  const daylight = RB.dx - QB.dx - 2 * BODY_RADIUS;
  assert.ok(daylight >= 2 / 3 && daylight <= 1.05, `daylight ${daylight}`);
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
  assert.ok(Math.abs(lineup.find((pl) => pl.id === 'QB').y - (25 - 5.3)) < 1e-9);
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

test('DL at technique spots, centered on the ball', () => {
  const LDE = byId('LDE');
  const LDT = byId('LDT');
  const RDT = byId('RDT');
  const RDE = byId('RDE');
  const RG = byId('RG');
  const RT = byId('RT');
  assert.equal(LDE.dx, 2.65);
  assert.equal(LDT.dx, 0.95);
  assert.equal(RDT.dx, -0.95);
  assert.equal(RDE.dx, -2.65);
  assert.ok(Math.abs(LDT.dx - (RG.dx - 0.25)) < 1e-9, '2i');
  assert.ok(Math.abs(LDE.dx - (RT.dx + 0.25)) < 1e-9, '5');
  assert.equal(LDE.dx, -RDE.dx);
  assert.equal(LDT.dx, -RDT.dx);
});

test('F-30 #1: real body radius', () => {
  assert.equal(BODY_RADIUS, 0.28);
  assert.equal(CONTACT_DIST, 2 * BODY_RADIUS);
  assert.equal(SPREAD, 2 * BODY_RADIUS);
  assert.equal(DL_SHIFT_STEP, BODY_RADIUS);
  assert.equal(LB_SHIFT_STEP, BODY_RADIUS);
});

test('F-30 #3: OL splits', () => {
  const want = {
    LT: [-2.4, -0.75], LG: [-1.2, -0.6], C: [0, -0.28], RG: [1.2, -0.6], RT: [2.4, -0.75],
  };
  for (const [id, [dx, dy]] of Object.entries(want)) {
    assert.equal(byId(id).dx, dx, `${id} dx`);
    assert.equal(byId(id).dy, dy, `${id} dy`);
  }
  const chain = ['LT', 'LG', 'C', 'RG', 'RT'].map((id) => byId(id).dx);
  for (let i = 1; i < chain.length; i++) {
    assert.ok(Math.abs(chain[i] - chain[i - 1] - 1.2) < 1e-9, `gap ${i}`);
  }
  const split = 1.2 - 2 * BODY_RADIUS;
  assert.ok(split >= 1 / 3 && split <= 2 / 3, `body-to-body split ${split}`);
});

test('F-30 #4: front and LBs', () => {
  for (const id of ['LDE', 'LDT', 'RDT', 'RDE']) assert.equal(byId(id).dy, 0.6, id);
  assert.deepEqual([byId('MLB').dx, byId('MLB').dy], [1.28, 3.6]);
  assert.deepEqual([byId('WLB').dx, byId('WLB').dy], [-1.28, 3.6]);
  assert.deepEqual([byId('SLB').dx, byId('SLB').dy], [3.52, 3.6]);
  assert.deepEqual([byId('QB').dx, byId('QB').dy], [0, -5.3]);
  assert.deepEqual([byId('RB').dx, byId('RB').dy], [1.6, -5.3]);
});

test('F-30 #2/#5: ball and neutral zone', () => {
  assert.equal(BALL_LENGTH, 11 / 36);
  assert.equal(BALL_WIDTH, 6.7 / 36);
  for (const k of FRONT_KEYS) {
    for (const d of FRONTS[k].defenders) {
      assert.ok(d.dy - BODY_RADIUS >= BALL_LENGTH - 1e-9, `${k} ${d.id}`);
    }
  }
  for (const p of POSITIONS.filter((r) => r.team === 'offense' && r.id !== 'C')) {
    assert.ok(p.dy + BODY_RADIUS <= 1e-9, p.id);
  }
  assert.equal(byId('C').dy, -BODY_RADIUS);
});

test('F-30 #4: FRONTS rows', () => {
  const want = {
    base: null,
    over43: {
      PE: [-2.65, 0.6], PT: [-1.45, 0.6], BT: [0.25, 0.6], BE: [2.65, 0.6],
      SAM: [-2.4, 3.6], MIK: [-0.4, 3.6], WIL: [1.6, 3.6],
    },
    under43: {
      PE: [-2.65, 0.6], PN: [-0.25, 0.6], BT: [1.45, 0.6], BE: [2.65, 0.6],
      L1: [-1.92, 3.6], L2: [0.48, 3.6], L3: [2.4, 3.6],
    },
    odd34: {
      PO: [-4.0, 1.0], PE: [-2.65, 0.6], N: [0, 0.6], BE: [2.65, 0.6],
      BO: [4.0, 1.0], PI: [-1.12, 3.6], BI: [1.12, 3.6],
    },
    bear: {
      PE: [-3.35, 0.6], P3: [-1.45, 0.6], N: [0, 0.6], B3: [1.45, 0.6],
      BE: [3.35, 0.6], L1: [-1.12, 3.6], L2: [1.6, 3.6],
    },
    walkedUp: {
      PE: [-2.65, 0.6], PT: [-1.45, 0.6], BT: [0.25, 0.6], BE: [2.65, 0.6],
      SAM: [-3.68, 1.5], MIK: [-0.4, 3.6], WIL: [1.6, 3.6],
    },
    backedOff: {
      PE: [-2.65, 0.6], PN: [-0.25, 0.6], BT: [1.45, 2.5], BE: [2.65, 0.6],
      L1: [-1.92, 3.6], L2: [0.48, 3.6], L3: [2.4, 3.6],
    },
  };
  for (const k of FRONT_KEYS) {
    if (want[k] === null) continue;
    const got = Object.fromEntries(FRONTS[k].defenders.map((d) => [d.id, [d.dx, d.dy]]));
    assert.deepEqual(got, want[k], k);
  }
});

test('F-70 #1/#2: LBs 3 yd, SS 7 yd, FS 10 yd behind the D line', () => {
  assert.equal(LB_DEPTH - DL_DEPTH, 3);
  assert.equal(SS_DEPTH - DL_DEPTH, 7);
  assert.equal(FS_DEPTH - DL_DEPTH, 10);
  // Every D line row sits at DL_DEPTH, except the backed-off 3-tech (backedOff BT, dy 2.5, by design).
  for (const k of FRONT_KEYS) {
    for (const d of FRONTS[k].defenders) {
      if (d.role === 'DE' || d.role === 'DT') {
        if (k === 'backedOff' && d.id === 'BT') {
          assert.equal(d.dy, 2.5, `${k} ${d.id}`);
        } else {
          assert.equal(d.dy, DL_DEPTH, `${k} ${d.id}`);
        }
      }
      if (d.role === 'LB' && d.dy > 2) assert.equal(d.dy, LB_DEPTH, `${k} ${d.id}`);
    }
  }
  for (const k of Object.keys(DEF_PERSONNEL)) {
    for (const d of DEF_PERSONNEL[k].defenders) {
      if (d.role === 'LB' && d.dy > 2) assert.equal(d.dy, LB_DEPTH, `${k} ${d.id}`);
    }
  }
  for (const k of ['nickel', 'base11']) {
    const row = (id) => DEF_PERSONNEL[k].defenders.find((d) => d.id === id);
    assert.equal(row('FS').dy, FS_DEPTH, `${k} FS`);
    assert.equal(row('SS').dy, SS_DEPTH, `${k} SS`);
  }
  const lineup = buildLineup(25, 'insideZone', { formation: '11', defPersonnel: 'nickel' });
  const at = (id) => lineup.find((p) => p.id === id).y;
  assert.ok(Math.abs(at('SS') - 32.6) < 1e-9, `SS y ${at('SS')}`);
  assert.ok(Math.abs(at('FS') - 35.6) < 1e-9, `FS y ${at('FS')}`);
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

const nOff = POSITIONS.filter((p) => p.team === 'offense').length + PERSONNEL[PLAYS.insideZone.personnel ?? 'noTe'].rows.length;

test('buildLineup with odd34 front: offense rows then odd34 defenders at x = dx, y = los + dy', () => {
  const lineup = buildLineup(25, 'insideZone', { front: 'odd34' });
  assert.equal(lineup.length, nOff + FRONTS.odd34.defenders.length);
  assert.ok(lineup.slice(0, nOff).every((pl) => pl.team === 'offense'));
  FRONTS.odd34.defenders.forEach((d, i) => {
    const pl = lineup[nOff + i];
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

test('F-34 #1: every defender in every FRONTS entry takes speed, strength and def from the nearest base row of his role', () => {
  // Same rule as roleRating: smallest hypot distance, earlier POSITIONS row on a tie.
  const nearestBase = (role, dx, dy) => {
    let best = null;
    let bestD = Infinity;
    for (const p of POSITIONS) {
      if (p.team !== 'defense' || p.role !== role) continue;
      const dist = Math.hypot(p.dx - dx, p.dy - dy);
      if (dist < bestD) { bestD = dist; best = p; }
    }
    return best;
  };
  for (const [key, f] of Object.entries(FRONTS)) {
    for (const d of f.defenders) {
      const row = nearestBase(d.role, d.dx, d.dy);
      assert.deepEqual(d.def, row.def, `${key} ${d.id} def`);
      assert.equal(d.speed, row.speed, `${key} ${d.id} speed`);
      assert.equal(d.strength, row.strength, `${key} ${d.id} strength`);
    }
  }
});

test('F-34 #1: odd34 LB reads follow the nearest base LB (PO, PI, BI, BO)', () => {
  const reads = Object.fromEntries(
    FRONTS.odd34.defenders.filter((d) => d.role === 'LB').map((d) => [d.id, d.def.read]),
  );
  assert.deepEqual(reads, { PO: 0.5, PI: 0.5, BI: 0.35, BO: 0.5 });
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
    const pl = lineup[nOff + i];
    assert.equal(pl.id, d.id);
    assert.deepEqual(pl.def, d.def, d.id);
    if (d.role !== 'LB') assert.equal(pl.def, null, d.id);
  });
  assert.ok(lineup.slice(0, nOff).every((pl) => pl.def === null));
});

test('F-39 #1: PERSONNEL keys, frozen; noTe empty; te is one attached TE row', () => {
  assert.deepEqual(Object.keys(PERSONNEL), ['noTe', 'te']);
  assert.ok(Object.isFrozen(PERSONNEL));
  assert.ok(Object.isFrozen(PERSONNEL.noTe));
  assert.ok(Object.isFrozen(PERSONNEL.te));
  assert.deepEqual(PERSONNEL.noTe.rows, []);
  assert.equal(PERSONNEL.te.rows.length, 1);
  const [te] = PERSONNEL.te.rows;
  const RT = byId('RT');
  const RG = byId('RG');
  assert.equal(te.id, 'TE');
  assert.equal(te.team, 'offense');
  assert.equal(te.role, 'TE');
  assert.equal(te.dx, RT.dx + (RT.dx - RG.dx));
  assert.equal(te.dy, RT.dy);
  assert.ok(te.dy + BODY_RADIUS <= 0, 'TE behind the line');
  for (const f of Object.values(FRONTS)) {
    for (const d of f.defenders) {
      assert.ok(te.strength * Math.SQRT1_2 > d.strength, `TE vs ${d.id}`);
    }
  }
});

test('F-39 #7: buildLineup personnel option', () => {
  const te = buildLineup(25, 'insideZone', { personnel: 'te' });
  const off = te.filter((pl) => pl.team === 'offense');
  assert.equal(off.length, 8);
  const tePl = off[7];
  assert.equal(tePl.id, 'TE');
  assert.equal(tePl.x, PERSONNEL.te.rows[0].dx);
  assert.equal(tePl.y, 25 + PERSONNEL.te.rows[0].dy);
  assert.deepEqual(tePl.assignment, { goal: null, target: null });
  assert.equal(tePl.def, null);
  const noTe = buildLineup(25, 'insideZone', { personnel: 'noTe' });
  assert.equal(noTe.some((pl) => pl.role === 'TE'), false);
  assert.deepEqual(te.filter((pl) => pl.id !== 'TE'), noTe);
  assert.throws(() => buildLineup(25, 'base', { personnel: 'nope' }), /nope/);
  const shifted = buildLineup(25, 'insideZone', { personnel: 'te', dlShift: 1.2, lbShift: -2 });
  assert.equal(shifted.find((pl) => pl.id === 'TE').x, tePl.x);
});

const isRate = (v) => typeof v === 'number' && v >= 0 && v <= 1;

test('move ratings: every DL row of POSITIONS, FRONTS and DEF_PERSONNEL has swim and power in [0,1]', () => {
  const dlRows = [
    ...POSITIONS.filter((p) => ['DE', 'DT'].includes(p.role)),
    ...Object.values(FRONTS).flatMap((f) => f.defenders.filter((d) => ['DE', 'DT'].includes(d.role))),
    ...Object.values(DEF_PERSONNEL).flatMap((dp) => dp.defenders.filter((d) => ['DE', 'DT'].includes(d.role))),
  ];
  assert.ok(dlRows.length > 0);
  for (const d of dlRows) {
    assert.ok(isRate(d.swim), `${d.id} swim ${d.swim}`);
    assert.ok(isRate(d.power), `${d.id} power ${d.power}`);
  }
});

test('move ratings: every LB row of POSITIONS, FRONTS and DEF_PERSONNEL has swim 0.2 and power 0.15', () => {
  const rows = [
    ...POSITIONS.filter((p) => p.role === 'LB'),
    ...Object.values(FRONTS).flatMap((f) => f.defenders.filter((d) => d.role === 'LB')),
    ...Object.values(DEF_PERSONNEL).flatMap((dp) => dp.defenders.filter((d) => d.role === 'LB')),
  ];
  assert.ok(rows.length > 0);
  for (const d of rows) {
    assert.equal(d.swim, 0.2, `${d.id} swim`);
    assert.equal(d.power, 0.15, `${d.id} power`);
  }
});

test('move ratings: every CB and S row of DEF_PERSONNEL has swim 0.2 and power 0.05', () => {
  const rows = Object.values(DEF_PERSONNEL).flatMap((dp) => dp.defenders.filter((d) => ['CB', 'S'].includes(d.role)));
  assert.ok(rows.length > 0);
  for (const d of rows) {
    assert.equal(d.swim, 0.2, `${d.id} swim`);
    assert.equal(d.power, 0.05, `${d.id} power`);
  }
});

test('move ratings: every OL and TE row (POSITIONS plus PERSONNEL.te) has hands and anchor in [0,1]', () => {
  const rows = [
    ...POSITIONS.filter((p) => p.role === 'OL'),
    ...PERSONNEL.te.rows.filter((p) => p.role === 'TE'),
  ];
  assert.equal(rows.length, 6);
  for (const p of rows) {
    assert.ok(isRate(p.hands), `${p.id} hands ${p.hands}`);
    assert.ok(isRate(p.anchor), `${p.id} anchor ${p.anchor}`);
  }
});

test('move ratings: buildLineup DL and OL players carry the fields', () => {
  const lineup = buildLineup(25, 'insideZone', { defPersonnel: 'nickel' });
  const de = lineup.find((pl) => pl.id === 'PE');
  assert.equal(de.swim, 0.25);
  assert.equal(de.power, 0.15);
  const dt = lineup.find((pl) => pl.id === 'PT');
  assert.equal(dt.swim, 0.15);
  assert.equal(dt.power, 0.25);
  const ol = lineup.find((pl) => pl.id === 'LG');
  assert.equal(ol.hands, 0.5);
  assert.equal(ol.anchor, 0.5);
  const te = buildLineup(25, 'insideZone', { personnel: 'te' }).find((pl) => pl.id === 'TE');
  assert.equal(te.hands, 0.4);
  assert.equal(te.anchor, 0.35);
  assert.equal(lineup.find((pl) => pl.id === 'MIK').swim, 0.2);
  assert.equal(lineup.find((pl) => pl.id === 'RB').vision, 0.8);
});

test('footwork ratings: every DL row has shuffle 0.6 and pedal 0.45', () => {
  const rows = [
    ...POSITIONS.filter((p) => ['DE', 'DT'].includes(p.role)),
    ...Object.values(FRONTS).flatMap((f) => f.defenders.filter((d) => ['DE', 'DT'].includes(d.role))),
    ...Object.values(DEF_PERSONNEL).flatMap((dp) => dp.defenders.filter((d) => ['DE', 'DT'].includes(d.role))),
  ];
  assert.ok(rows.length > 0);
  for (const d of rows) {
    assert.equal(d.shuffle, 0.6, `${d.id} shuffle`);
    assert.equal(d.pedal, 0.45, `${d.id} pedal`);
  }
});

test('footwork ratings: every LB row has shuffle 0.75 and pedal 0.6', () => {
  const rows = [
    ...POSITIONS.filter((p) => p.role === 'LB'),
    ...Object.values(FRONTS).flatMap((f) => f.defenders.filter((d) => d.role === 'LB')),
    ...Object.values(DEF_PERSONNEL).flatMap((dp) => dp.defenders.filter((d) => d.role === 'LB')),
  ];
  assert.ok(rows.length > 0);
  for (const d of rows) {
    assert.equal(d.shuffle, 0.75, `${d.id} shuffle`);
    assert.equal(d.pedal, 0.6, `${d.id} pedal`);
  }
});

test('footwork ratings: every CB and S row of DEF_PERSONNEL has shuffle 0.85 and pedal 0.8', () => {
  const rows = Object.values(DEF_PERSONNEL).flatMap((dp) => dp.defenders.filter((d) => ['CB', 'S'].includes(d.role)));
  assert.ok(rows.length > 0);
  for (const d of rows) {
    assert.equal(d.shuffle, 0.85, `${d.id} shuffle`);
    assert.equal(d.pedal, 0.8, `${d.id} pedal`);
  }
});

test('footwork ratings: buildLineup MIK and FS carry them; OL, QB, RB, TE and WR rows have none', () => {
  const lineup = buildLineup(25, 'insideZone', { defPersonnel: 'nickel' });
  const mik = lineup.find((pl) => pl.id === 'MIK');
  assert.equal(mik.shuffle, 0.75);
  assert.equal(mik.pedal, 0.6);
  const fs = lineup.find((pl) => pl.id === 'FS');
  assert.equal(fs.shuffle, 0.85);
  assert.equal(fs.pedal, 0.8);
  const off = [
    ...POSITIONS.filter((p) => p.team === 'offense'),
    ...PERSONNEL.te.rows,
    ...Object.values(FORMATIONS).flatMap((f) => f.rows.filter((r) => r.team === 'offense')),
  ];
  assert.ok(off.length > 0);
  for (const p of off) {
    assert.ok(!('shuffle' in p), `${p.id} shuffle`);
    assert.ok(!('pedal' in p), `${p.id} pedal`);
  }
});

test('MOVE_COUNTER maps swim to hands and power to anchor, frozen', () => {
  assert.deepEqual(MOVE_COUNTER, { swim: 'hands', power: 'anchor' });
  assert.ok(Object.isFrozen(MOVE_COUNTER));
});

test('moveOdds: log5 cases', () => {
  assert.equal(moveOdds(0, 0.5), 0);
  assert.equal(moveOdds(1, 0.5), 1);
  for (const r of [0.1, 0.25, 0.5, 0.8]) {
    assert.ok(Math.abs(moveOdds(r, 0.5) - r) < 1e-12, `c=0.5 r=${r}`);
  }
  for (const r of [0.15, 0.25, 0.6]) {
    let prev = Infinity;
    for (let c = 0; c <= 1 + 1e-9; c += 0.05) {
      const o = moveOdds(r, Math.min(c, 1));
      assert.ok(o <= prev + 1e-12, `r=${r} c=${c} not falling`);
      prev = o;
    }
  }
  assert.equal(moveOdds(0, 1), 0);
  assert.equal(moveOdds(1, 0), 1);
  assert.equal(moveOdds(0.25, 0.5), 0.25);
  assert.ok(Math.abs(moveOdds(0.25, 0.4) - (0.25 * 0.6) / (0.25 * 0.6 + 0.4 * 0.75)) < 1e-12);
});

test('moveOdds: defaults and clamping', () => {
  assert.equal(moveOdds(), 0);
  assert.equal(moveOdds(0.3), moveOdds(0.3, 0.5));
  assert.equal(moveOdds(undefined, 0.2), 0);
  assert.equal(moveOdds(0.25, undefined), 0.25);
  assert.equal(moveOdds(null, null), 0);
  assert.equal(moveOdds(1.5, 0.5), 1);
  assert.equal(moveOdds(-0.5, 0.5), 0);
  assert.equal(moveOdds(0.5, -1), moveOdds(0.5, 0));
});
