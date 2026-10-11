import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATIONS, DEF_PERSONNEL, FRONTS, PERSONNEL, DL_ROLES, LB_ROLES, WR_ROLES, DB_ROLES, buildLineup,
} from '../src/dots/roster.js';
import { createPlay, FIXED_DT } from '../src/dots/play.js';

const ids = (rows) => rows.map((p) => p.id).sort();
const offense = (play) => play.players.filter((p) => p.team === 'offense');
const defense = (play) => play.players.filter((p) => p.team === 'defense');

test('FORMATIONS and DEF_PERSONNEL keys and freezing', () => {
  assert.deepEqual(Object.keys(FORMATIONS), ['11', '12', '21']);
  assert.deepEqual(Object.keys(DEF_PERSONNEL), ['nickel', 'base11']);
  assert.ok(Object.isFrozen(FORMATIONS));
  assert.ok(Object.isFrozen(DEF_PERSONNEL));
  for (const f of Object.values(FORMATIONS)) {
    assert.ok(Object.isFrozen(f));
    assert.ok(Object.isFrozen(f.rows));
    assert.ok(Object.hasOwn(PERSONNEL, f.personnel), `personnel ${f.personnel} exists`);
    assert.ok(Object.hasOwn(DEF_PERSONNEL, f.defense), `defense ${f.defense} exists`);
  }
  for (const d of Object.values(DEF_PERSONNEL)) {
    assert.ok(Object.isFrozen(d));
    assert.ok(Object.isFrozen(d.defenders));
  }
  assert.deepEqual(WR_ROLES, ['WR']);
  assert.deepEqual(DB_ROLES, ['CB', 'S']);
});

test('each formation with its default defense is 11 v 11 with unique ids', () => {
  for (const key of Object.keys(FORMATIONS)) {
    const play = createPlay(25, 'insideZone', { formation: key });
    assert.equal(offense(play).length, 11, `${key} offense count`);
    assert.equal(defense(play).length, 11, `${key} defense count`);
    const all = play.players.map((p) => p.id);
    assert.equal(new Set(all).size, all.length, `${key} ids unique`);
  }
});

test('nickel: 4 DL, 2 LB, 5 DB; NB sits over the slot', () => {
  const play = createPlay(25, 'insideZone', { formation: '11' });
  assert.equal(play.defPersonnel, 'nickel');
  const d = defense(play);
  assert.equal(d.filter((p) => DL_ROLES.includes(p.role)).length, 4);
  assert.equal(d.filter((p) => LB_ROLES.includes(p.role)).length, 2);
  assert.equal(d.filter((p) => DB_ROLES.includes(p.role)).length, 5);
  const nb = play.player('NB');
  const h = play.player('H');
  assert.ok(Math.abs(nb.x - h.x) <= 1.0, `NB ${nb.x} within 1.0 of H ${h.x}`);
});

test('base11 vs 12 and 21: base front plus CBX, CBZ, FS, SS', () => {
  const base = FRONTS.base.defenders.map((p) => p.id);
  for (const key of ['12', '21']) {
    const play = createPlay(25, 'insideZone', { formation: key });
    assert.equal(play.defPersonnel, 'base11');
    assert.deepEqual(ids(defense(play)), [...base, 'CBX', 'CBZ', 'FS', 'SS'].sort(), `${key} defense ids`);
  }
});

test('explicit overrides for front, defPersonnel and setters', () => {
  const bear = createPlay(25, 'insideZone', { formation: '11', front: 'bear' });
  assert.equal(bear.defPersonnel, null);
  assert.deepEqual(ids(defense(bear)), ids(FRONTS.bear.defenders));

  const forced = createPlay(25, 'insideZone', { formation: '11', defPersonnel: 'base11' });
  assert.equal(forced.defPersonnel, 'base11');
  assert.ok(defense(forced).some((p) => p.id === 'CBX'));

  const play = createPlay(25, 'insideZone', { formation: '11' });
  assert.equal(play.setFront('bear'), 'bear');
  assert.equal(play.defPersonnel, null);
  assert.equal(defense(play).some((p) => DB_ROLES.includes(p.role)), false);

  const off = createPlay(25, 'insideZone');
  assert.equal(off.setFormation('21'), '21');
  assert.equal(off.defPersonnel, 'base11');
  assert.equal(off.setFormation(null), null);
  assert.equal(off.defPersonnel, null);
  assert.equal(off.setFormation('nope'), false);
  assert.equal(off.setDefPersonnel('nope'), false);
  assert.equal(off.setDefPersonnel('nickel'), 'nickel');
  assert.equal(off.setDefPersonnel(null), null);
});

test('setFormation(null) returns to today\'s lineup', () => {
  const plain = createPlay(25, 'insideZone');
  const play = createPlay(25, 'insideZone', { formation: '12' });
  play.setFormation(null);
  assert.deepEqual(play.players.map((p) => p.id), plain.players.map((p) => p.id));
  for (let i = 0; i < plain.players.length; i++) {
    assert.equal(play.players[i].x, plain.players[i].x);
    assert.equal(play.players[i].y, plain.players[i].y);
  }
});

test('each formation snaps and steps 4 s without throwing or non-finite positions', () => {
  for (const key of Object.keys(FORMATIONS)) {
    const play = createPlay(25, 'insideZone', { formation: key });
    assert.equal(play.snap(), true);
    for (let t = 0; t < 4; t += FIXED_DT) play.step(FIXED_DT);
    for (const p of play.players) {
      assert.ok(Number.isFinite(p.x), `${key} ${p.id} x finite`);
      assert.ok(Number.isFinite(p.y), `${key} ${p.id} y finite`);
    }
  }
});

test('default lineup unchanged for the no-formation play and every FRONTS key', () => {
  const plain = createPlay(25, 'insideZone');
  const expectDefault = buildLineup(25, 'insideZone');
  assert.deepEqual(plain.players.map((p) => [p.id, p.x, p.y]), expectDefault.map((p) => [p.id, p.x, p.y]));
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    const expected = buildLineup(25, 'insideZone', { front: k });
    assert.deepEqual(play.players.map((p) => [p.id, p.x, p.y]), expected.map((p) => [p.id, p.x, p.y]), k);
  }
});
