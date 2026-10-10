import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, DL_SHIFT_STEP, LB_SHIFT_STEP } from '../src/dots/play.js';
import { PLAYS, buildLineup } from '../src/dots/roster.js';
import { BASE_LB_IDS, IZ_NUMBERS } from './fixtures/base-front.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);
const LB_IDS = BASE_LB_IDS;
const snap = (play) => play.players.map((p) => [p.id, p.x, p.y]);

test('F-11 #4: PLAYS.insideZone shape; buildLineup lbShift moves only the LBs', () => {
  const z = PLAYS.insideZone;
  assert.equal(z.name, 'Inside Zone');
  assert.deepEqual(z.ball, { start: 'C', snapTo: 'QB' });
  assert.deepEqual(z.assignments, {});
  assert.equal(z.playside, 'left');
  assert.equal(PLAYS.base.playside, undefined);
  const base = buildLineup(25, 'base');
  const shifted = buildLineup(25, 'base', { lbShift: 1.2 });
  for (let i = 0; i < base.length; i++) {
    near(shifted[i].x, base[i].x + (LB_IDS.includes(base[i].id) ? 1.2 : 0));
    assert.equal(shifted[i].y, base[i].y);
  }
});

test('F-11 #5: shiftLB moves only LBs by one LB_SHIFT_STEP, clamps, ignores bad dirs, refused live', () => {
  const play = createPlay(25);
  assert.equal(play.lbShift, 0);
  const base = buildLineup(25);
  assert.equal(play.shiftLB(1), 1);
  for (const b of base) {
    const p = play.player(b.id);
    near(p.x, b.x + (LB_IDS.includes(b.id) ? LB_SHIFT_STEP : 0));
    assert.equal(p.y, b.y);
  }
  for (let i = 0; i < 7; i++) play.shiftLB(1);
  assert.equal(play.lbShift, 6);
  const down = createPlay(25);
  for (let i = 0; i < 7; i++) down.shiftLB(-1);
  assert.equal(down.lbShift, -6);
  for (const bad of [0, 2, 0.5, NaN]) {
    const s = snap(play);
    assert.equal(play.shiftLB(bad), 6, String(bad));
    assert.deepEqual(snap(play), s);
  }
  play.snap();
  const s = snap(play);
  assert.equal(play.shiftLB(-1), false);
  assert.equal(play.lbShift, 6);
  assert.deepEqual(snap(play), s);
  play.reset();
  assert.equal(play.lbShift, 6);
  near(play.player('MLB').x, base.find((b) => b.id === 'MLB').x + 6 * LB_SHIFT_STEP);
});

test('F-11 #5: shiftDL and shiftLB are independent', () => {
  const play = createPlay(25);
  const base = buildLineup(25);
  play.shiftDL(1);
  play.shiftLB(-1);
  assert.equal(play.dlShift, 1);
  assert.equal(play.lbShift, -1);
  near(play.player('LDT').x, base.find((b) => b.id === 'LDT').x + DL_SHIFT_STEP);
  near(play.player('MLB').x, base.find((b) => b.id === 'MLB').x - LB_SHIFT_STEP);
  near(play.player('C').x, 0);
});

test('F-11 #6: insideZone numbers; base numbers empty', () => {
  assert.deepEqual(createPlay(25, 'insideZone').numbers, IZ_NUMBERS.base);
  assert.deepEqual(createPlay(25).numbers, {});
});

test('F-11 #7: numbers follow LB and DL shifts; frozen after snap', () => {
  const a = createPlay(25, 'insideZone');
  for (let i = 0; i < 6; i++) a.shiftLB(-1);
  assert.deepEqual(a.numbers, IZ_NUMBERS.lbMinus6);
  const b = createPlay(25, 'insideZone');
  for (let i = 0; i < 4; i++) b.shiftDL(1);
  assert.deepEqual(b.numbers, IZ_NUMBERS.dlPlus4);
  const pre = structuredClone(b.numbers);
  b.snap();
  for (let i = 0; i < 4; i++) b.step(0.5);
  assert.deepEqual(b.numbers, pre);
});
