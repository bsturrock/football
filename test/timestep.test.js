import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT, MAX_SUBSTEP, MAX_TICKS_PER_STEP } from '../src/dots/play.js';

const TICKS = 240;

const record = (play) => ({
  players: play.players.map((p) => [p.id, p.x, p.y]),
  ball: { ...play.ball },
});

const run = (front, dt, timeScale) => {
  const play = createPlay(25, 'insideZone', { front, timeScale });
  play.snap();
  while (play.ticks < TICKS) play.step(dt);
  assert.equal(play.ticks, TICKS);
  return record(play);
};

test('constants: MAX_SUBSTEP equals FIXED_DT', () => {
  assert.equal(FIXED_DT, 1 / 60);
  assert.equal(MAX_SUBSTEP, FIXED_DT);
  assert.equal(MAX_TICKS_PER_STEP, 30);
});

for (const front of ['base', 'odd34']) {
  const ref = run(front, 1 / 60, 1);
  for (const [dt, scale] of [[1 / 30, 1], [1 / 60, 1], [1 / 120, 1], [1 / 144, 1], [1 / 60, 0.35], [1 / 60, 2]]) {
    test(`${front}: dt ${dt.toFixed(5)} timeScale ${scale} matches the reference exactly`, () => {
      assert.deepEqual(run(front, dt, scale), ref);
    });
  }
}

test('alpha and prev track the partial tick', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  play.step(FIXED_DT / 2);
  assert.equal(play.ticks, 0);
  assert.ok(Math.abs(play.alpha - 0.5) < 1e-9);
  for (const p of play.players) assert.deepEqual(play.prev[p.id], { x: p.x, y: p.y });
  play.step(FIXED_DT / 2);
  assert.equal(play.ticks, 1);
  assert.ok(play.alpha < 1e-9);
});

test('presnap step does nothing', () => {
  const play = createPlay(25, 'insideZone');
  play.step(1);
  assert.equal(play.ticks, 0);
  assert.equal(play.alpha, 0);
});

test('a runaway frame runs at most MAX_TICKS_PER_STEP ticks and drops the rest', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  play.step(10);
  assert.equal(play.ticks, MAX_TICKS_PER_STEP);
  assert.ok(play.alpha >= 0 && play.alpha < 1);
});

test('reset zeroes ticks, alpha and the accumulator', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  play.step(FIXED_DT * 3.5);
  play.reset();
  assert.equal(play.ticks, 0);
  assert.equal(play.alpha, 0);
  for (const p of play.players) assert.deepEqual(play.prev[p.id], { x: p.x, y: p.y });
  play.snap();
  play.step(FIXED_DT / 2);
  assert.equal(play.ticks, 0);
});
