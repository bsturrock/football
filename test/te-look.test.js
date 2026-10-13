import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { TE_LOOKS, buildLineup } from '../src/dots/roster.js';

const LOOKS = Object.keys(TE_LOOKS);
const SIDES = ['left', 'right'];
const sgn = (v) => Math.sign(v);
const PLAYSIDE = { left: -1, right: 1 };
const byId = (play, id) => play.players.find((p) => p.id === id);

for (const teLook of LOOKS) {
  for (const playside of SIDES) {
    const s = PLAYSIDE[playside];
    const look = TE_LOOKS[teLook];
    const t = look.align === 'play' ? s : -s; // TE side
    const label = `${teLook} / ${playside}`;

    test(`${label}: TE on the look's side (item 1)`, () => {
      const play = createPlay(25, 'insideZone', { formation: '11', teLook, rbAway: true, playside });
      assert.equal(sgn(byId(play, 'TE').x), t);
    });

    test(`${label}: Z on the TE side, X and H on the other (item 2)`, () => {
      const play = createPlay(25, 'insideZone', { formation: '11', teLook, rbAway: true, playside });
      assert.equal(sgn(byId(play, 'Z').x), t);
      assert.equal(sgn(byId(play, 'X').x), -t);
      assert.equal(sgn(byId(play, 'H').x), -t);
    });

    test(`${label}: nickel back on the slot side, SS on the TE side (item 2)`, () => {
      const play = createPlay(25, 'insideZone', { formation: '11', teLook, rbAway: true, playside });
      assert.equal(sgn(byId(play, 'NB').x), -t);
      assert.equal(sgn(byId(play, 'SS').x), t);
    });

    test(`${label}: OL keep their x and ids (item 2)`, () => {
      const play = createPlay(25, 'insideZone', { formation: '11', teLook, rbAway: true, playside });
      const ref = buildLineup(25, 'insideZone', { formation: '11', defPersonnel: 'nickel' });
      for (const id of ['LT', 'LG', 'C', 'RG', 'RT']) {
        assert.equal(byId(play, id).x, ref.find((p) => p.id === id).x);
      }
      assert.equal(byId(play, 'LT').x, -2.4);
    });

    test(`${label}: RB away from the play side, level with the QB (item 3)`, () => {
      const play = createPlay(25, 'insideZone', { formation: '11', teLook, rbAway: true, playside });
      const rb = byId(play, 'RB');
      assert.equal(sgn(rb.x), -s);
      assert.equal(rb.y, byId(play, 'QB').y);
    });

    test(`${label}: pull and numbering (item 5)`, () => {
      const play = createPlay(25, 'insideZone', { formation: '11', teLook, rbAway: true, playside });
      if (look.pull) {
        assert.ok(play.numbers.TE === undefined || play.numbers.TE === null);
        assert.deepEqual(play.pull, { id: 'TE', side: -t });
      } else {
        assert.equal(typeof play.numbers.TE, 'number');
        assert.equal(play.pull, null);
      }
    });
  }
}

test('createPlay with no teLook or rbAway matches the nickel 11 lineup', () => {
  const play = createPlay(25, 'insideZone', { formation: '11' });
  const ref = buildLineup(25, 'insideZone', { formation: '11', defPersonnel: 'nickel' });
  assert.equal(play.players.length, ref.length);
  play.players.forEach((p, i) => {
    assert.equal(p.id, ref[i].id);
    assert.equal(p.x, ref[i].x);
    assert.equal(p.y, ref[i].y);
  });
  assert.equal(play.pull, null);
  assert.equal(play.teLook, null);
  assert.equal(play.rbAway, false);
});

test('createPlay throws on a bad teLook', () => {
  assert.throws(() => createPlay(25, 'insideZone', { formation: '11', teLook: 'nope' }), /bad teLook/);
});

test('setTeLook refuses a bad key and refuses after the snap (item 4)', () => {
  const play = createPlay(25, 'insideZone', { formation: '11' });
  assert.equal(play.setTeLook('bogus'), false);
  assert.equal(play.teLook, null);
  assert.equal(play.setTeLook('playside'), 'playside');
  assert.equal(play.teLook, 'playside');
  assert.equal(play.setTeLook(null), null);
  assert.equal(play.teLook, null);
  assert.equal(play.setTeLook('backsidePull'), 'backsidePull');
  assert.ok(play.snap());
  assert.equal(play.setTeLook('backside'), false);
  assert.equal(play.teLook, 'backsidePull');
});
