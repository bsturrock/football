import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stepBlocking, contactSpot, REENGAGE_DELAY, OPEN_SHRUG, OPEN_BOUNCE, BOUNCE_COOL, blockLevel, contestOdds,
} from '../src/dots/blocking.js';
import { LINE_DEPTH } from '../src/dots/front.js';
import { createPlay } from '../src/dots/play.js';

const DT = 1 / 60;
const LOS = 25;
const blk = (target) => ({ target, angle: 'straight', engaged: false, seq: null });

// One blocker standing on the contact spot of a still defender; one tick.
function setup(dy, dOpts, bOpts, ctxOpts) {
  const d = { id: 'd', team: 'defense', role: 'DT', x: 0, y: LOS + dy, speed: 0, strength: 0.6, block: null, ...dOpts };
  const b = { id: 'a', team: 'offense', role: 'OL', x: 0, y: LOS, speed: 6, strength: 1, block: blk('d'), ...bOpts };
  const ps = [b, d];
  const s = contactSpot(ps, b);
  b.x = s.x; b.y = s.y;
  const ctx = { rule: null, seq: 0, contest: true, los: LOS, seed: 1, fightBlocks: true, ...ctxOpts };
  stepBlocking(ps, { x: 0, y: -50 }, DT, ctx);
  return { b, d };
}
const OPEN = LINE_DEPTH + 1;

test('blockLevel and contestOdds', () => {
  assert.equal(blockLevel({ y: LOS + LINE_DEPTH + 0.1 }, LOS), 'open');
  assert.equal(blockLevel({ y: LOS + LINE_DEPTH }, LOS), 'line');
  assert.equal(blockLevel({ y: 99 }, undefined), 'line');
  assert.deepEqual(contestOdds({}, {}), { shrug: OPEN_SHRUG, bounce: OPEN_BOUNCE });
  assert.deepEqual(contestOdds({ bounce: 0.5 }, { shrug: 0.1 }), { shrug: 0.1, bounce: 0.5 });
});

test('open field, shrug: no lock, defender free', () => {
  const { b, d } = setup(OPEN, { shrug: 1 });
  assert.equal(b.block.engaged, false);
  assert.ok(d.shedFree > 0 && d.shedFree <= REENGAGE_DELAY); // set to REENGAGE_DELAY, then ticked down once
  assert.equal(d.shedHow, 'shrug');
  assert.ok(b.block.cool > 0 && b.block.cool <= REENGAGE_DELAY);
  assert.equal(b.block.contest, 'shrug');
});

test('open field, bounce: no lock, impact on both', () => {
  const { b, d } = setup(OPEN, { shrug: 0 }, { bounce: 1 });
  assert.equal(b.block.engaged, false);
  assert.ok(b.block.cool > 0 && b.block.cool <= BOUNCE_COOL);
  assert.equal(b.block.contest, 'bounce');
  assert.ok(b.impact && d.impact);
});

test('open field, lock', () => {
  const { b } = setup(OPEN, { shrug: 0 }, { bounce: 0 });
  assert.equal(b.block.engaged, true);
  assert.equal(b.block.contest, 'lock');
});

test('line level always locks', () => {
  const { b } = setup(LINE_DEPTH - 0.5, { shrug: 1 });
  assert.equal(b.block.engaged, true);
  assert.equal(b.block.contest, undefined);
});

test('contest off or absent locks in the open', () => {
  assert.equal(setup(OPEN, { shrug: 1 }, {}, { contest: false }).b.block.engaged, true);
  assert.equal(setup(OPEN, { shrug: 1 }, {}, { contest: undefined }).b.block.engaged, true);
});

test('report: insideZone outcomes with contest on', (t) => {
  for (let seed = 1; seed <= 5; seed++) {
    const play = createPlay(25, 'insideZone', { formation: '11', playside: 'left', contest: true, tackles: false, seed });
    play.snap();
    const counts = { lock: 0, shrug: 0, bounce: 0 };
    const last = new Map();
    for (let i = 0; i < 600; i++) {
      play.step(DT);
      for (const p of play.players) {
        const c = p.block?.contest;
        if (c && last.get(p.id) !== c) counts[c]++;
        last.set(p.id, c);
      }
    }
    t.diagnostic(`seed ${seed}: ${JSON.stringify(counts)}`);
    assert.ok(play.players.length > 0);
  }
});
