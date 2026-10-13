import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { moveLabel, PAGE_MATCHUP } from '../src/dots/view.js';

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

test('F-61 #7c: with moves off no defender ever has a move, even at swim 1', () => {
  for (const opts of [{ moves: false }, {}]) {
    const play = rated(opts, 1, 0);
    run(play, () => { for (const d of play.players) if (d.team === 'defense') assert.equal(d.move ?? null, null, d.id); });
  }
});

// F-68 #5, #6: record each tick a defender's move enters phase 'try' (from null or another phase).
const PAGE_SEEDS = [1, 2, 3, 4, 5];
const moveStarts = () => {
  const starts = [];
  for (const seed of PAGE_SEEDS) {
    const play = createPlay(25, 'insideZone', { moves: true, seed, ...PAGE_MATCHUP });
    assert.ok(play.snap());
    const prev = new Map();
    for (let t = 0; t < 400 && play.ball.phase !== 'dead'; t++) {
      play.step(FIXED_DT);
      for (const d of play.players) {
        if (d.team !== 'defense') continue;
        if (d.move?.phase === 'try' && prev.get(d.id)?.phase !== 'try') {
          starts.push({
            seed,
            id: d.id,
            role: d.role,
            state: play.defense.agents[d.id]?.state,
            engaged: play.players.filter((p) => p.team === 'offense' && p.block?.target === d.id && p.block.engaged).length,
          });
        }
        prev.set(d.id, d.move ?? null);
      }
    }
  }
  return starts;
};

test('F-68 #5: a blocked LB tries a move', () => {
  const starts = moveStarts();
  assert.ok(starts.some((s) => s.role === 'LB' && s.engaged === 1), `starts: ${JSON.stringify(starts.filter((s) => s.role === 'LB'))}`);
});

test('F-68 #5: moves start outside the old move states', () => {
  const starts = moveStarts();
  const old = ['hold', 'outsideArm', 'rush', 'squeeze'];
  assert.ok(starts.some((s) => !old.includes(s.state)), `states: ${[...new Set(starts.map((s) => s.state))].join(', ')}`);
});

test('F-68 #1: every move start is on a single-blocked defender', () => {
  const starts = moveStarts();
  assert.ok(starts.length > 0, 'some move started');
  for (const s of starts) assert.equal(s.engaged, 1, `seed ${s.seed} ${s.id}`);
});

test('F-62 #3: a played snap with moves on shows a resolved won/lost label', () => {
  const labels = new Set();
  for (let seed = 1; seed <= 5; seed++) {
    const play = createPlay(25, 'insideZone', { trace: true, moves: true, seed });
    assert.ok(play.snap());
    for (let t = 0; t < 400 && play.ball.phase !== 'dead'; t++) {
      play.step(FIXED_DT);
      for (const d of play.players) if (isDL(d)) labels.add(moveLabel(d));
    }
  }
  assert.ok([...labels].some((l) => /^(swim|power) (won|lost)$/.test(l)), `labels seen: ${[...labels].join(', ')}`);
});
