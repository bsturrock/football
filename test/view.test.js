import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldToWorld, pickDot, blockSummary, shiftLabel, numberLabel } from '../src/dots/view.js';
import { createPlay, DL_SHIFT_STEP, LB_SHIFT_STEP } from '../src/dots/play.js';

const players = () => createPlay(25).players;
const get = (ps, id) => ps.find((p) => p.id === id);

test('shiftLabel formats the pre-snap D-line shift', () => {
  assert.equal(shiftLabel(0), 'DL shift: even (←/→)');
  assert.equal(shiftLabel(2), `DL shift: ${(2 * DL_SHIFT_STEP).toFixed(1)} yd R (←/→)`);
  assert.equal(shiftLabel(-1), `DL shift: ${(1 * DL_SHIFT_STEP).toFixed(1)} yd L (←/→)`);
  assert.equal(shiftLabel(4), `DL shift: ${(4 * DL_SHIFT_STEP).toFixed(1)} yd R (←/→)`);
});

test('fieldToWorld maps game to world', () => {
  assert.deepEqual(fieldToWorld(3, 25), { x: 3, z: 25 });
});

test('pickDot returns the dot at a spot', () => {
  const ps = players();
  const c = get(ps, 'C');
  assert.equal(pickDot(ps, c.x, c.y, 0.9).id, 'C');
});

test('pickDot between two dots returns the nearer', () => {
  const ps = players();
  const qb = get(ps, 'QB'), rb = get(ps, 'RB');
  const nearQb = pickDot(ps, qb.x * 0.7 + rb.x * 0.3, qb.y * 0.7 + rb.y * 0.3, 10);
  assert.equal(nearQb.id, 'QB');
  const nearRb = pickDot(ps, qb.x * 0.3 + rb.x * 0.7, qb.y * 0.3 + rb.y * 0.7, 10);
  assert.equal(nearRb.id, 'RB');
});

test('pickDot far from everyone returns null', () => {
  assert.equal(pickDot(players(), 500, 500, 0.9), null);
});

test('pickDot radius boundary', () => {
  const ps = players();
  const c = get(ps, 'C');
  assert.equal(pickDot(ps, c.x + 0.5, c.y, 0.5)?.id, 'C');
  assert.equal(pickDot(ps, c.x + 0.5, c.y, 0.49), null);
});

test('blockSummary presnap: offense has no block, defender has no blockers', () => {
  const play = createPlay(25);
  assert.equal(blockSummary(play, 'C'), 'Block: none');
  assert.equal(blockSummary(play, 'LDT'), 'Blocked by: none');
});

test('blockSummary after snap shows closing block', () => {
  const play = createPlay(25);
  play.snap();
  assert.equal(blockSummary(play, 'C'), 'Block: LDT · straight · closing');
});

test('blockSummary after stepping shows engaged block and blockers', () => {
  const play = createPlay(25);
  play.retargetRule = null;
  play.snap();
  for (let i = 0; i < 90; i++) play.step(1 / 60);
  assert.equal(blockSummary(play, 'C'), 'Block: LDT · straight · engaged');
  assert.equal(blockSummary(play, 'LDT'), 'Blocked by: C, RG');
});

test('numberLabel formats zone numbers', () => {
  assert.equal(numberLabel(0), '0');
  assert.equal(numberLabel(2), '2');
  assert.equal(numberLabel(-1), '-1');
  assert.equal(numberLabel(null), '');
  assert.equal(numberLabel(undefined), '');
});

test('shiftLabel supports the LB group', () => {
  assert.equal(shiftLabel(0, 'LB', '⇧←/→'), 'LB shift: even (⇧←/→)');
  assert.equal(shiftLabel(-2, 'LB', '⇧←/→'), `LB shift: ${(2 * LB_SHIFT_STEP).toFixed(1)} yd L (⇧←/→)`);
  assert.equal(shiftLabel(-6, 'LB', '⇧←/→'), `LB shift: ${(6 * LB_SHIFT_STEP).toFixed(1)} yd L (⇧←/→)`);
});
