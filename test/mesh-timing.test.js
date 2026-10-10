import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, SNAP_DURATION } from '../src/dots/play.js';
import { SECURE_TIME } from '../src/dots/carrier.js';

const DT = 1 / 60;

test('F-21 #6: QB secures the snap before the handoff', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  let t = 0;
  let heldAt = null;
  while (t < 2 && play.ball.phase !== 'carried') {
    const before = play.run.heldTime;
    play.step(DT);
    t += DT;
    if (play.ball.phase === 'held' && heldAt === null) heldAt = t;
    if (play.ball.phase === 'held') {
      assert.ok(Math.abs(play.run.heldTime - before - DT) < 1e-9, 'heldTime grows by dt');
    }
    if (play.ball.phase === 'carried') {
      assert.ok(heldAt !== null);
      assert.ok(t - heldAt >= SECURE_TIME - DT - 1e-9, `handoff too early: ${t - heldAt}`);
    }
  }
  assert.equal(play.ball.phase, 'carried');
  assert.ok(SNAP_DURATION > 0);
});

test('F-21 #7: RB meets the QB at the mesh about 0.6 s after the snap, still running', () => {
  const play = createPlay(25, 'insideZone', { accel: true });
  play.snap();
  const rb = play.player('RB');
  let t = 0;
  let handoffAt = null;
  let moving = false;
  let waited = 0;
  while (t < 1.5 - 1e-9) {
    play.step(DT);
    t += DT;
    if (rb.v > 0.5) moving = true;
    else if (moving === false) { /* still starting */ }
    if (play.ball.phase === 'carried') {
      handoffAt = t;
      break;
    }
    if (moving && rb.v < 0.5) waited += DT;
  }
  assert.ok(handoffAt !== null, 'handoff happened');
  assert.ok(handoffAt >= 0.5 && handoffAt <= 0.9, `handoff at ${handoffAt}`);
  assert.ok(rb.v >= 0.5 * rb.speed, `rb v ${rb.v} at handoff ${handoffAt}`);
  assert.ok(waited <= 0.05, `waited ${waited}`);
});
