import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { TE_LOOKS } from '../src/dots/roster.js';
import { LINE_DEPTH } from '../src/dots/front.js';

const PLAYSIDE = { left: -1, right: 1 };
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
const make = (teLook, playside) => createPlay(25, 'insideZone', { formation: '11', teLook, rbAway: true, playside });

// outermost line-level box defender on the pull side, from positions
function expectedMan(play) {
  const cx = play.players.find((p) => p.id === 'C').x;
  const pool = play.players.filter((p) => play.box.ids.includes(p.id) && Math.sign(p.x - cx) === play.pull.side && p.y - 25 <= LINE_DEPTH);
  pool.sort((a, b) => Math.abs(b.x - cx) - Math.abs(a.x - cx));
  return pool[0].id;
}

for (const teLook of ['backsidePull', 'playsidePull']) {
  for (const playside of ['left', 'right']) {
    const s = PLAYSIDE[playside];
    const label = `${teLook} / ${playside}`;

    test(`${label}: TE gets the pull-side end man, no OL has him`, () => {
      const play = make(teLook, playside);
      const man = expectedMan(play);
      play.snap();
      assert.equal(play.plan.blocks.TE, man);
      assert.deepEqual(play.plan.techs.TE, { tech: 'pull', shade: 'none', pull: play.pull.side });
      for (const id of OL) assert.notEqual(play.plan.blocks[id], man);
      assert.deepEqual(play.plan.accounted[man], { how: 'block', by: ['TE'] });
    });

    test(`${label}: TE keeps his man for 1.0 s`, () => {
      const play = make(teLook, playside);
      const man = expectedMan(play);
      play.snap();
      for (let i = 0; i < Math.round(1 / FIXED_DT); i++) play.step(FIXED_DT);
      assert.equal(play.players.find((p) => p.id === 'TE').block.target, man);
    });

    if (teLook === 'playsidePull') {
      test(`${label}: backside end lineman does not block the backside end man`, () => {
        const play = make(teLook, playside);
        const man = expectedMan(play);
        play.snap();
        const backEnd = s === 1 ? 'LT' : 'RT';
        assert.notEqual(play.plan.blocks[backEnd], man);
      });
    }
  }
}

for (const teLook of Object.keys(TE_LOOKS).filter((k) => !TE_LOOKS[k].pull)) {
  for (const playside of ['left', 'right']) {
    test(`${teLook} / ${playside}: TE is a normal zone lineman`, () => {
      const play = make(teLook, playside);
      play.snap();
      assert.equal(play.pull, null);
      assert.notEqual(play.plan.techs.TE?.tech, 'pull');
    });
  }
}
