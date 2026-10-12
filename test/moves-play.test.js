import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';

const TICKS = 240;
const isDL = (p) => p.role === 'DT' || p.role === 'DE';
const rated = (opts, swim, power) => {
  const play = createPlay(25, 'insideZone', opts);
  for (const p of play.players) if (isDL(p)) { p.swim = swim; p.power = power; }
  assert.ok(play.snap());
  return play;
};
const run = (play, each) => {
  for (let t = 0; t < TICKS && play.ball.phase !== 'dead'; t++) { play.step(FIXED_DT); each(play); }
};

test('F-61 #7a: a swim-1 DL wins his move, sheds his blocker and pursues', () => {
  const play = rated({ moves: true }, 1, 0);
  const won = new Set();
  run(play, () => {
    for (const d of play.players) {
      if (!isDL(d) || d.move?.phase !== 'won' || won.has(d.id)) continue;
      won.add(d.id);
      const blocker = play.players.find((p) => p.id === d.move.by);
      assert.equal(blocker.block.released, 'shed', d.id);
      assert.equal(blocker.block.beat, 'swim', d.id);
    }
  });
  assert.ok(won.size > 0, 'some DL won a swim');
  assert.ok([...won].some((id) => play.defense.agents[id].state === 'pursue'), 'a winner pursues');
});

test('F-61 #7b: with swim and power 0 no DL ever has a move', () => {
  const play = rated({ moves: true }, 0, 0);
  run(play, () => { for (const d of play.players) if (isDL(d)) assert.equal(d.move ?? null, null, d.id); });
});

test('F-61 #7c: with moves off no DL ever has a move, even at swim 1', () => {
  for (const opts of [{ moves: false }, {}]) {
    const play = rated(opts, 1, 0);
    run(play, () => { for (const d of play.players) if (isDL(d)) assert.equal(d.move ?? null, null, d.id); });
  }
});
