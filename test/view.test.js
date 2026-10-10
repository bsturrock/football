import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldToWorld, pickDot, blockSummary, reactLabel, shiftLabel, fightLabel, numberLabel, runLabel, formatYards, frontOptions, LABEL_SIZE, speedStep, SPEED_STEP, BALL_DRAW_AHEAD, HASH_HALF, HASH_LEN, YARD_LINE_W, GOAL_LINE_W, BORDER_W, UPRIGHTS_W, RING_INNER, RING_OUTER, drawPos, resultLabel } from '../src/dots/view.js';
import { createPlay, DL_SHIFT_STEP, LB_SHIFT_STEP, SIM_SPEED, SIM_SPEED_MIN, SIM_SPEED_MAX } from '../src/dots/play.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { FRONTS, BALL_LENGTH } from '../src/dots/roster.js';

test('frontOptions has one entry per FRONTS key, in order, with matching names', () => {
  const opts = frontOptions();
  assert.deepEqual(opts.map((o) => o.key), Object.keys(FRONTS));
  assert.deepEqual(opts.map((o) => o.name), Object.values(FRONTS).map((f) => f.name));
  assert.deepEqual(opts[0], { key: 'base', name: '4-3 Base' });
});

const players = () => createPlay(25).players;
const get = (ps, id) => ps.find((p) => p.id === id);

test('shiftLabel formats the pre-snap D-line shift', () => {
  assert.equal(shiftLabel(0), 'DL shift: even (←/→)');
  assert.equal(shiftLabel(2), `DL shift: ${formatYards(2 * DL_SHIFT_STEP)} yd R (←/→)`);
  assert.equal(shiftLabel(-1), `DL shift: ${formatYards(1 * DL_SHIFT_STEP)} yd L (←/→)`);
  assert.equal(shiftLabel(4), `DL shift: ${formatYards(4 * DL_SHIFT_STEP)} yd R (←/→)`);
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
  assert.equal(shiftLabel(-2, 'LB', '⇧←/→'), `LB shift: ${formatYards(2 * LB_SHIFT_STEP)} yd L (⇧←/→)`);
  assert.equal(shiftLabel(-6, 'LB', '⇧←/→'), `LB shift: ${formatYards(6 * LB_SHIFT_STEP)} yd L (⇧←/→)`);
});

test('T-117: fightLabel shows the defense-fights-blocks state and the F key', () => {
  assert.equal(fightLabel(true), 'Defense fights blocks: on (F)');
  assert.equal(fightLabel(false), 'Defense fights blocks: off (F)');
});

test('F-14 #9: formatYards keeps two decimals, drops trailing zeros', () => {
  assert.equal(formatYards(0.35), '0.35');
  assert.equal(formatYards(0.7), '0.7');
  assert.equal(formatYards(3 * 0.35), '1.05');
  assert.equal(formatYards(6 * 0.35), '2.1');
  assert.equal(formatYards(1.2), '1.2');
  assert.equal(formatYards(2), '2');
});

test('F-14 #10: number label sized from BODY_RADIUS', () => {
  assert.equal(LABEL_SIZE, 2 * BODY_RADIUS);
});

test('F-13 #7: runLabel', () => {
  assert.equal(runLabel(null), '');
  assert.equal(runLabel(undefined), '');
  assert.equal(runLabel({ carried: false, locked: false, gap: 'A' }), '');
  assert.equal(runLabel({ carried: true, locked: false, gap: 'A' }), 'Hole: A (reading)');
  assert.equal(runLabel({ carried: true, locked: true, gap: 'B' }), 'Hole: B (locked)');
});

test('F-20 #7: reactLabel', () => {
  assert.equal(reactLabel({ id: 'C', team: 'offense', react: { state: 'anchored', lean: 0.5 } }), '');
  assert.equal(reactLabel({ id: 'LDT', team: 'defense', react: null }), 'Reaction: none');
  assert.equal(reactLabel({ team: 'defense', react: { state: 'anchored', lean: 0.5 } }), 'Reaction: anchored · lean 0.50');
});

test('F-27 #2: speedStep steps, rounds and clamps', () => {
  assert.equal(speedStep(SIM_SPEED, 1), 0.4);
  assert.equal(speedStep(SIM_SPEED, -1), 0.3);
  assert.equal(speedStep(SIM_SPEED_MAX, 1), SIM_SPEED_MAX);
  assert.equal(speedStep(SIM_SPEED_MIN, -1), SIM_SPEED_MIN);
  assert.equal(SPEED_STEP, 0.05);
  let s = SIM_SPEED;
  for (let i = 0; i < 20; i++) s = speedStep(s, 1);
  assert.strictEqual(s, 1.35);
});

test('F-30 #9: field, ball and ring constants', () => {
  assert.equal(HASH_HALF, 18.5 / 6);
  assert.equal(HASH_LEN, 2 / 3);
  assert.equal(YARD_LINE_W, 1 / 9);
  assert.equal(GOAL_LINE_W, 2 / 9);
  assert.equal(BORDER_W, 2);
  assert.equal(UPRIGHTS_W, 18.5 / 3);
  assert.equal(RING_INNER, 2.1 * BODY_RADIUS);
  assert.equal(RING_OUTER, 2.7 * BODY_RADIUS);
  assert.equal(BALL_DRAW_AHEAD, BODY_RADIUS + BALL_LENGTH / 2);
  // Pre-snap the ball's rear tip sits on the LOS.
  const play = createPlay(25, 'insideZone');
  assert.ok(Math.abs(play.ballPosition().y + BALL_DRAW_AHEAD - BALL_LENGTH / 2 - 25) < 1e-9);
});

test('T-89: drawPos interpolates from prev by alpha', () => {
  const play = { prev: { A: { x: 0, y: 0 } }, alpha: 0.25 };
  assert.deepEqual(drawPos(play, { id: 'A', x: 4, y: 8 }), { x: 1, y: 2 });
  assert.deepEqual(drawPos(play, { id: 'B', x: 4, y: 8 }), { x: 4, y: 8 });
  assert.deepEqual(drawPos({ prev: { A: { x: 0, y: 0 } }, alpha: 0 }, { id: 'A', x: 4, y: 8 }), { x: 0, y: 0 });
});

test('T-89: drawPos on a real play lies on the prev-to-current segment', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  play.step(1 / 120);
  for (const p of play.players) {
    const prev = play.prev[p.id];
    const d = drawPos(play, p);
    const a = play.alpha;
    assert.ok(Math.abs(d.x - (prev.x + (p.x - prev.x) * a)) < 1e-9, p.id);
    assert.ok(Math.abs(d.y - (prev.y + (p.y - prev.y) * a)) < 1e-9, p.id);
    assert.ok(a >= 0 && a < 1);
  }
});

test('T-89: resultLabel', () => {
  assert.equal(resultLabel(null), '');
  assert.equal(resultLabel(undefined), '');
  assert.equal(resultLabel({ reason: 'tackle', by: 'MLB', yards: 3.42 }), 'Tackled by MLB, +3.4 yd');
  assert.equal(resultLabel({ reason: 'touchdown', by: null, yards: 75 }), 'Touchdown, +75.0 yd');
  assert.equal(resultLabel({ reason: 'out', by: null, yards: -1.25 }), `Out of bounds, ${(-1.25).toFixed(1)} yd`);
  assert.equal(resultLabel({ reason: 'mystery', by: null, yards: 0 }), 'Play over, +0.0 yd');
});
