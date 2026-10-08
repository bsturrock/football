import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, SNAP_DURATION } from '../src/dots/play.js';
import { buildLineup } from '../src/dots/roster.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

test('new play: ball held by C pre-snap', () => {
  const play = createPlay(25);
  assert.equal(play.ball.holder, 'C');
  assert.equal(play.ball.phase, 'presnap');
  const c = play.player('C');
  assert.deepEqual(play.ballPosition(), { x: c.x, y: c.y });
});

test('snap() moves to snapping; second snap() is refused', () => {
  const play = createPlay(25);
  assert.equal(play.snap(), true);
  assert.equal(play.ball.phase, 'snapping');
  assert.equal(play.ball.holder, null);
  assert.equal(play.snap(), false);
});

test('mid-snap ballPosition is the midpoint of C and QB', () => {
  const play = createPlay(25);
  play.snap();
  play.step(SNAP_DURATION / 2);
  const c = play.player('C');
  const qb = play.player('QB');
  const p = play.ballPosition();
  near(p.x, (c.x + qb.x) / 2);
  near(p.y, (c.y + qb.y) / 2);
});

test('step past the end hands ball to QB and then does nothing', () => {
  const play = createPlay(25);
  play.snap();
  play.step(SNAP_DURATION * 2);
  assert.equal(play.ball.phase, 'held');
  assert.equal(play.ball.holder, 'QB');
  assert.equal(play.ball.t, 1);
  const qb = play.player('QB');
  assert.deepEqual(play.ballPosition(), { x: qb.x, y: qb.y });
  play.step(1);
  assert.equal(play.ball.t, 1);
  assert.equal(play.ball.holder, 'QB');
  assert.equal(play.ball.phase, 'held');
});

test('snap() while held returns false', () => {
  const play = createPlay(25);
  play.snap();
  play.step(SNAP_DURATION);
  assert.equal(play.snap(), false);
});

test('reset() mid-snap after mutation restores the pre-snap state', () => {
  const play = createPlay(25);
  play.snap();
  play.step(SNAP_DURATION / 3);
  play.player('LT').x = 99;
  play.reset();
  const fresh = buildLineup(25);
  assert.deepEqual(
    play.players.map((p) => [p.id, p.x, p.y]),
    fresh.map((p) => [p.id, p.x, p.y]),
  );
  assert.equal(play.ball.holder, 'C');
  assert.equal(play.ball.phase, 'presnap');
  assert.equal(play.snap(), true);
});

test('reset() from presnap is harmless', () => {
  const play = createPlay(25);
  play.reset();
  assert.equal(play.ball.holder, 'C');
  assert.equal(play.ball.phase, 'presnap');
  assert.equal(play.ball.t, 0);
});
