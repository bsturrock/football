import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { GOALS, DL_RESPONSES, gapSpan } from '../src/dots/defense.js';

const TICKS = 180;
const SIDES = ['left', 'right'];
const cases = [];
for (const front of Object.keys(FRONTS)) for (const playside of SIDES) cases.push({ front, playside });

const attackers = (play) => Object.keys(play.defense.agents).filter((id) => play.defense.agents[id].behavior === 'attack' && !play.defense.agents[id].script);
const envOf = (play) => ({ players: play.players, defense: play.defense, run: play.run, ballPos: play.ballPosition(), los: play.defense.los, cues: play.cuesOf });

test('F-56 #5: after the first step every one-gap DL with a blocker is in getoff, aimed at his gap-side shoulder', () => {
  let n = 0;
  for (const { front, playside } of cases) {
    const play = createPlay(25, 'insideZone', { front, playside });
    assert.ok(play.snap());
    play.step(FIXED_DT);
    for (const id of attackers(play)) {
      const e = play.defense.agents[id];
      if (e.blocker == null) continue;
      n++;
      assert.equal(e.state, 'getoff', `${front} ${playside} ${id}`);
      const b = play.player(e.blocker);
      const span = gapSpan(play.players, play.defense, e.fit);
      const gs = span ? Math.sign((span.lo + span.hi) / 2 - b.x) : Math.sign(e.x0 - b.x);
      const g = GOALS.getoff(play.player(id), e, envOf(play));
      assert.ok(Math.abs(g.x - (b.x + gs * BODY_RADIUS)) < 1e-9, `${front} ${playside} ${id}: getoff x ${g.x} vs shoulder`);
    }
  }
  assert.ok(n > 0);
});

test('F-56 #6: a DL\'s state follows what he felt', () => {
  let n = 0;
  for (const { front, playside } of cases) {
    const play = createPlay(25, 'insideZone', { front, playside });
    assert.ok(play.snap());
    const ids = attackers(play);
    for (let t = 0; t < TICKS && play.ball.phase !== 'dead'; t++) {
      const felt = Object.fromEntries(ids.map((id) => [id, play.cuesOf(id)?.felt]));
      play.step(FIXED_DT);
      for (const id of ids) {
        const e = play.defense.agents[id];
        if (e.state === 'pursue' || !Object.hasOwn(DL_RESPONSES, felt[id])) continue;
        n++;
        assert.equal(e.state, DL_RESPONSES[felt[id]], `${front} ${playside} ${id} tick ${t} felt ${felt[id]}`);
      }
    }
  }
  assert.ok(n > 0);
});

test('F-56 #7: a double-teamed DL anchors', () => {
  let seen = 0;
  for (const { front, playside } of cases) {
    const play = createPlay(25, 'insideZone', { front, playside });
    assert.ok(play.snap());
    const ids = attackers(play);
    for (let t = 0; t < TICKS && play.ball.phase !== 'dead'; t++) {
      play.step(FIXED_DT);
      for (const id of ids) {
        if (play.defense.agents[id].state === 'anchor' && play.blockersOf(id).length >= 2) seen++;
      }
    }
  }
  assert.ok(seen > 0, 'no DL anchored under a double team');
});

test('F-56 #8: a two-gap DL controls his blocker until the ball commits', () => {
  let n = 0;
  for (const { front, playside } of cases) {
    const play = createPlay(25, 'insideZone', { front, playside, call: 'twoGap' });
    assert.ok(play.snap());
    const ids = Object.keys(play.defense.agents).filter((id) => play.defense.agents[id].behavior === 'twoGap');
    assert.ok(ids.length > 0, `${front} ${playside}`);
    for (const id of Object.keys(play.defense.agents)) {
      const e = play.defense.agents[id];
      if (e.assign?.type === 'attack' && !e.script) assert.equal(e.behavior, 'twoGap', `${front} ${playside} ${id}`);
    }
    const ever = Object.fromEntries(ids.map((id) => [id, false]));
    for (let t = 0; t < TICKS && play.ball.phase !== 'dead'; t++) {
      for (const id of ids) ever[id] ||= play.cuesOf(id)?.ball?.committed === true;
      play.step(FIXED_DT);
      for (const id of ids) {
        ever[id] ||= play.cuesOf(id)?.ball?.committed === true;
        const e = play.defense.agents[id];
        if (e.state === 'pursue') continue;
        n++;
        if (!ever[id]) assert.equal(e.state, 'control', `${front} ${playside} ${id} tick ${t}`);
        else assert.ok(['control', 'twoGapFit'].includes(e.state), `${front} ${playside} ${id} tick ${t}: ${e.state}`);
      }
    }
  }
  assert.ok(n > 0);
});
