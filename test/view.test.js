import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldToWorld, pickDot, blockSummary, reactLabel, shiftLabel, fightLabel, movesLabel, seedLabel, moveLabel, numberLabel, runLabel, formatYards, frontOptions, personnelOptions, callOptions, LABEL_SIZE, speedStep, SPEED_STEP, BALL_DRAW_AHEAD, HASH_HALF, HASH_LEN, YARD_LINE_W, GOAL_LINE_W, BORDER_W, UPRIGHTS_W, RING_INNER, RING_OUTER, drawPos, resultLabel, drawFacing, noseTriangle, NOSE_HALF_W, versionLabel, PAGE_MATCHUP, MATCHUP_LOCKED, SETUP_FIELDS, playSetup, applySetup, REVIEW_PLAYS, reviewOptions, stepOneTick, tickLabel, recogLabel } from '../src/dots/view.js';
import { createPlay, DL_SHIFT_STEP, LB_SHIFT_STEP, SIM_SPEED, SIM_SPEED_MIN, SIM_SPEED_MAX, FIXED_DT } from '../src/dots/play.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { angleDiff } from '../src/dots/facing.js';
import { FRONTS, PERSONNEL, BALL_LENGTH } from '../src/dots/roster.js';
import { CALLS, recogTime } from '../src/dots/defense.js';

test('frontOptions has one entry per FRONTS key, in order, with matching names', () => {
  const opts = frontOptions();
  assert.deepEqual(opts.map((o) => o.key), Object.keys(FRONTS));
  assert.deepEqual(opts.map((o) => o.name), Object.values(FRONTS).map((f) => f.name));
  assert.deepEqual(opts[0], { key: 'base', name: '4-3 Base' });
});

test('personnelOptions has one entry per PERSONNEL key, in order, with matching names', () => {
  const opts = personnelOptions();
  assert.deepEqual(opts.map((o) => o.key), Object.keys(PERSONNEL));
  assert.deepEqual(opts.map((o) => o.name), Object.values(PERSONNEL).map((p) => p.name));
});

test('callOptions has a by-personnel entry, then one entry per CALLS key, in order, with matching names', () => {
  const opts = callOptions();
  assert.deepEqual(opts[0], { key: '', name: 'Call: by personnel' });
  assert.deepEqual(opts.slice(1).map((o) => o.key), Object.keys(CALLS));
  assert.deepEqual(opts.slice(1).map((o) => o.name), Object.values(CALLS).map((c) => c.name));
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

test('T-84: movesLabel shows the DL moves state and the M key', () => {
  assert.equal(movesLabel(true), 'Moves: on (M)');
  assert.equal(movesLabel(false), 'Moves: off (M)');
});

test('T-84: seedLabel shows the play seed', () => {
  assert.equal(seedLabel(1), 'Seed 1');
  assert.equal(seedLabel(42), 'Seed 42');
});

test('T-84: moveLabel is empty without a move or at rest, and names each phase', () => {
  assert.equal(moveLabel({ id: 'DL1' }), '');
  assert.equal(moveLabel({ id: 'DL1', move: null }), '');
  assert.equal(moveLabel({ id: 'DL1', move: { kind: 'swim', phase: 'rest' } }), '');
  assert.equal(moveLabel({ id: 'DL1', move: { kind: 'power', phase: 'rest' } }), '');
  assert.equal(moveLabel({ id: 'DL1', move: { kind: 'swim', phase: 'try' } }), 'swim');
  assert.equal(moveLabel({ id: 'DL1', move: { kind: 'swim', phase: 'won' } }), 'swim won');
  assert.equal(moveLabel({ id: 'DL1', move: { kind: 'swim', phase: 'lost' } }), 'swim lost');
  assert.equal(moveLabel({ id: 'DL1', move: { kind: 'power', phase: 'try' } }), 'power');
  assert.equal(moveLabel({ id: 'DL1', move: { kind: 'power', phase: 'won' } }), 'power won');
  assert.equal(moveLabel({ id: 'DL1', move: { kind: 'power', phase: 'lost' } }), 'power lost');
});

test('T-101: moveLabel shows shed for a leverage shed still counting down', () => {
  assert.equal(moveLabel({ id: 'DL1', shedFree: 0.3, shedHow: 'leverage' }), 'shed');
  assert.equal(moveLabel({ id: 'DL1', shedFree: 0, shedHow: 'leverage' }), '');
  assert.equal(moveLabel({ id: 'DL1', shedHow: 'leverage' }), '');
  assert.equal(moveLabel({ id: 'DL1', shedFree: 0.3, shedHow: 'swim' }), '');
  assert.equal(moveLabel({ id: 'DL1', shedFree: 0.3, shedHow: 'swim', move: { kind: 'swim', phase: 'won' } }), 'swim won');
  assert.equal(moveLabel({ id: 'DL1', shedFree: 0.3, shedHow: 'leverage', move: { kind: 'power', phase: 'try' } }), 'power');
  assert.equal(moveLabel({ id: 'DL1', shedFree: 0.3, shedHow: 'leverage', move: { kind: 'swim', phase: 'rest' } }), 'shed');
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
  assert.equal(runLabel({ carried: true, locked: false, gap: 'A', lane: { side: 'back', name: 'A' } }), 'Hole: A back (reading)');
  assert.equal(runLabel({ carried: true, locked: true, gap: 'A', lane: { side: 'back', name: 'A' } }), 'Hole: A back (locked)');
  assert.equal(runLabel({ carried: true, locked: true, gap: 'B', lane: { side: 'play', name: 'B' } }), 'Hole: B (locked)');
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

test('T-111: drawFacing interpolates the shortest arc from prev facing by alpha', () => {
  const p = { id: 'A', facing: 0.5 };
  assert.equal(drawFacing({ prev: {} , alpha: 0.5 }, p), 0.5);
  assert.equal(drawFacing({ prev: { B: { facing: 1 } }, alpha: 0.5 }, p), 0.5);
  assert.ok(Math.abs(drawFacing({ prev: { A: { facing: 0.2 } }, alpha: 0 }, p) - 0.2) < 1e-9);
  assert.ok(Math.abs(drawFacing({ prev: { A: { facing: 0.2 } }, alpha: 1 }, p) - 0.5) < 1e-9);
  const wrapped = drawFacing({ prev: { A: { facing: 3.0 } }, alpha: 0.5 }, { id: 'A', facing: -3.0 });
  assert.ok(Math.abs(angleDiff(wrapped, Math.PI)) < 1e-9);
});

test('T-111: noseTriangle points along facing with the base across it', () => {
  const tri = noseTriangle({ x: 0, y: 25 }, 0);
  assert.ok(Math.abs(tri[0].x - 0) < 1e-9 && Math.abs(tri[0].y - (25 + BODY_RADIUS)) < 1e-9);
  const corners = [tri[1], tri[2]];
  const want = [{ x: NOSE_HALF_W, y: 25 }, { x: -NOSE_HALF_W, y: 25 }];
  for (const w of want) {
    assert.ok(corners.some((c) => Math.abs(c.x - w.x) < 1e-9 && Math.abs(c.y - w.y) < 1e-9), JSON.stringify(w));
  }
  const side = noseTriangle({ x: 0, y: 25 }, Math.PI / 2);
  assert.ok(Math.abs(side[0].x - BODY_RADIUS) < 1e-9 && Math.abs(side[0].y - 25) < 1e-9);
});

test('T-89: resultLabel', () => {
  assert.equal(resultLabel(null), '');
  assert.equal(resultLabel(undefined), '');
  assert.equal(resultLabel({ reason: 'tackle', by: 'MLB', yards: 3.42 }), 'Tackled by MLB, +3.4 yd');
  assert.equal(resultLabel({ reason: 'touchdown', by: null, yards: 75 }), 'Touchdown, +75.0 yd');
  assert.equal(resultLabel({ reason: 'out', by: null, yards: -1.25 }), `Out of bounds, ${(-1.25).toFixed(1)} yd`);
  assert.equal(resultLabel({ reason: 'mystery', by: null, yards: 0 }), 'Play over, +0.0 yd');
});

test('versionLabel reads the last changelog entry', () => {
  const text = [
    '# Changelog',
    '',
    '- 2026-10-10 F-3 Roster and formations (R-6) 1a2b3c4',
    '- 2026-10-11 F-4 Perception layer, read trace and scenario harness (R-7) 6fe1145',
    '',
  ].join('\n');
  assert.equal(versionLabel(text), 'F-4 · 2026-10-11 · 6fe1145');
});

test('versionLabel handles CRLF line endings and trailing blank lines', () => {
  const text = '# Changelog\r\n- 2026-10-10 F-3 Roster and formations (R-6) 1a2b3c4\r\n- 2026-10-11 F-4 Perception layer (R-7) 6fe1145  \r\n\r\n';
  assert.equal(versionLabel(text), 'F-4 · 2026-10-11 · 6fe1145');
});

test('versionLabel returns version unknown without a matching entry', () => {
  assert.equal(versionLabel('# Changelog'), 'version unknown');
  assert.equal(versionLabel(''), 'version unknown');
  assert.equal(versionLabel(undefined), 'version unknown');
  assert.equal(versionLabel(42), 'version unknown');
});

// F-64 #1, #2: dots.html opens on one fixed matchup (11 personnel, nickel, inside zone left), pickers locked.
test('F-64 #1: PAGE_MATCHUP builds 11 personnel against the nickel 4-2-5', () => {
  const play = createPlay(25, 'insideZone', { ...PAGE_MATCHUP });
  const off = play.players.filter((p) => p.team === 'offense');
  const def = play.players.filter((p) => p.team !== 'offense');
  const offIds = off.map((p) => p.id);
  for (const id of ['LT', 'LG', 'C', 'RG', 'RT', 'QB', 'RB', 'TE', 'X', 'H', 'Z']) {
    assert.ok(offIds.includes(id), `offense has ${id}`);
  }
  assert.equal(off.length, 11);
  assert.equal(def.length, 11);
  assert.equal(def.filter((p) => p.role === 'DE' || p.role === 'DT').length, 4);
  assert.equal(def.filter((p) => p.role === 'LB').length, 2);
  assert.equal(def.filter((p) => p.role === 'CB' || p.role === 'S').length, 5);
  assert.equal(play.defPersonnel, 'nickel');
  assert.equal(play.playside, 'left');
  assert.equal(play.script, null);
  assert.equal(play.currentCall(), 'nickel');
});

test('F-64 #2: the matchup is locked on the page', () => {
  assert.equal(MATCHUP_LOCKED, true);
});

test('F-75 #6: recogLabel shows roster for null or undefined, else the rating and its read time', () => {
  assert.equal(recogLabel(null), 'Recognition: roster');
  assert.equal(recogLabel(undefined), 'Recognition: roster');
  assert.equal(recogLabel(1), 'Recognition: 1 (read 1.20 s)');
  assert.equal(recogLabel(99), 'Recognition: 99 (read 0.10 s)');
  assert.equal(recogLabel(50), `Recognition: 50 (read ${recogTime(50).toFixed(2)} s)`);
});

test('F-75 #6: the page play starts with roster recognition', () => {
  assert.equal(createPlay(25, 'insideZone', { ...PAGE_MATCHUP }).recog, null);
});

// F-63 #14: the review picker's setups, the one-tick step and the tick label.
// The page play is built exactly as initDotsView builds it.
const pagePlay = () => createPlay(25, 'insideZone', { timeScale: SIM_SPEED, trace: true, moves: true, ...PAGE_MATCHUP });
const positions = (play) => play.players.map((p) => ({ id: p.id, x: p.x, y: p.y }));

// Each review entry's own test, built from the literal options its test file uses.
const REVIEW_TESTS = {
  'climb-under43': () => createPlay(25, 'insideZone', { accel: true, tackles: false, front: 'under43', personnel: 'te', playside: 'right' }),
  'steer-dlMinus4': () => {
    const play = createPlay(25, 'insideZone', {});
    for (let i = 0; i < 4; i++) play.shiftDL(-1);
    return play;
  },
  'stall-bear': () => createPlay(25, 'insideZone', { accel: true, tackles: false, personnel: 'noTe', front: 'bear' }),
  'slip-noTe': () => createPlay(25, 'insideZone', { accel: true, tackles: false, personnel: 'noTe' }),
  'slip-te': () => createPlay(25, 'insideZone', { accel: true, tackles: false }),
  'stall-over43': () => createPlay(25, 'insideZone', { accel: true, tackles: false, personnel: 'noTe', front: 'over43' }),
  'shed-backedOff': () => createPlay(25, 'insideZone', { front: 'backedOff', tackles: false }),
  'squeeze-walkedUp': () => createPlay(25, 'insideZone', { front: 'walkedUp', personnel: 'noTe' }),
  'cutoff-safety': () => createPlay(25, 'insideZone', { formation: '11', playside: 'left' }),
  'chase-backside': () => createPlay(25, 'insideZone', { formation: '11', playside: 'left', tackles: false }),
  'pedal-lb-db': () => createPlay(25, 'insideZone', { formation: '11', playside: 'right', tackles: false }),
};

test('F-63 #14: every review entry has a literal test build, and its setup has exactly the setup fields', () => {
  assert.equal(SETUP_FIELDS.length, 14);
  assert.deepEqual([...REVIEW_PLAYS.map((e) => e.key)].sort(), Object.keys(REVIEW_TESTS).sort());
  for (const entry of REVIEW_PLAYS) {
    assert.deepEqual(Object.keys(entry.setup).sort(), [...SETUP_FIELDS].sort(), entry.key);
  }
});

test('F-63 #14: reviewOptions starts with the page matchup, then one entry per review play', () => {
  const opts = reviewOptions();
  assert.deepEqual(opts[0], { key: '', name: 'Page matchup' });
  assert.deepEqual(opts.slice(1), REVIEW_PLAYS.map(({ key, name }) => ({ key, name })));
});

test('F-63 #14: tickLabel shows the tick and its time in seconds', () => {
  assert.equal(tickLabel(102), 'Tick 102 · 1.70 s');
  assert.equal(tickLabel(0), 'Tick 0 · 0.00 s');
});

for (const entry of REVIEW_PLAYS) {
  test(`F-63 #14: review ${entry.key} replays its test's exact positions, tick by tick`, () => {
    const page = pagePlay();
    applySetup(page, entry.setup);
    page.snap();
    const own = REVIEW_TESTS[entry.key]();
    own.snap();
    for (let i = 1; i <= 150; i++) {
      stepOneTick(page);
      own.step(FIXED_DT);
      assert.equal(page.ticks, own.ticks, `${entry.key} ticks at step ${i}`);
      assert.deepEqual(positions(page), positions(own), `${entry.key} positions at tick ${i}`);
      assert.equal(page.ball.phase, own.ball.phase, `${entry.key} phase at tick ${i}`);
      if (own.ball.phase === 'dead') break;
    }
  });
}

test('F-63 #14: stepOneTick advances exactly one tick per call, after a partial accumulator, at each time scale', () => {
  for (const ts of [0.1, SIM_SPEED, 2]) {
    const play = createPlay(25, 'insideZone', { timeScale: ts, tackles: false });
    play.snap();
    play.step(0.013);
    for (let i = 0; i < 200; i++) {
      const before = play.ticks;
      stepOneTick(play);
      assert.equal(play.ticks - before, 1, `timeScale ${ts}, call ${i}`);
    }
  }
});

test('F-63 #14: stepOneTick does nothing before the snap', () => {
  const play = createPlay(25, 'insideZone', { timeScale: 1 });
  stepOneTick(play);
  assert.equal(play.ticks, 0);
  assert.equal(play.ball.phase, 'presnap');
});

test('F-63 #14: a review setup then home restores the page matchup', () => {
  const play = pagePlay();
  applySetup(play, REVIEW_PLAYS[0].setup);
  applySetup(play, playSetup(pagePlay()));
  const fresh = pagePlay();
  assert.deepEqual(playSetup(play), playSetup(fresh));
  play.snap();
  fresh.snap();
  for (let i = 0; i < 60; i++) {
    stepOneTick(play);
    stepOneTick(fresh);
  }
  assert.deepEqual(positions(play), positions(fresh));
});
