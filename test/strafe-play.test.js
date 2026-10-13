// T-112 (F-69 #6, #10): the LB read shuffle and DB pedal face the ball; judged by rule, never yards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { FACE_TOL, angleDiff, bearing } from '../src/dots/facing.js';

const LOS = 25;
const TICKS = Math.round(0.5 / FIXED_DT);
const OPTS = { formation: '11', playside: 'left', tackles: false };

// The ball spot a defender sees this tick (his cue), else the true ball.
const seenBall = (play, id) => {
  const b = play.cuesOf(id)?.ball;
  return b ? { x: b.x, y: b.y } : play.ballPosition();
};
const onBall = (play, p) => Math.abs(angleDiff(p.facing, bearing(p, seenBall(play, p.id)))) <= FACE_TOL;

test('F-69 #6 (a): FS and SS pedal deeper than their alignment, facing the ball (not turned to run)', () => {
  const play = createPlay(LOS, 'insideZone', OPTS);
  assert.ok(play.snap());
  const start = Object.fromEntries(['FS', 'SS'].map((id) => [id, { y: play.player(id).y }]));
  // The deepest y each safety reaches while pedalling in cover (he comes downhill after the commit).
  const deepest = Object.fromEntries(['FS', 'SS'].map((id) => [id, -Infinity]));
  for (let t = 0; t < TICKS && play.ball.phase !== 'dead'; t++) {
    play.step(FIXED_DT);
    for (const id of ['FS', 'SS']) {
      const p = play.player(id);
      if (play.defense.agents[id].state !== 'cover') continue;
      assert.ok(onBall(play, p), `${id} tick ${t}: facing ${p.facing} vs ball bearing ${bearing(p, seenBall(play, id))}`);
      deepest[id] = Math.max(deepest[id], p.y);
    }
  }
  for (const id of ['FS', 'SS']) {
    assert.ok(deepest[id] > start[id].y, `${id} moved deeper than his alignment`);
  }
});

test('F-69 #6 (b): MIK faces the ball spot he sees through his read step', () => {
  const play = createPlay(LOS, 'insideZone', OPTS);
  assert.ok(play.snap());
  let checked = 0;
  for (let t = 0; t < TICKS && play.ball.phase !== 'dead'; t++) {
    play.step(FIXED_DT);
    const p = play.player('MIK');
    if (play.defense.agents.MIK.state !== 'read' || p.block?.engaged) continue;
    assert.ok(onBall(play, p), `MIK tick ${t}: facing ${p.facing} vs ball bearing ${bearing(p, seenBall(play, 'MIK'))}`);
    checked++;
  }
  assert.ok(checked > 0, 'MIK was in his read step on some tick');
});
