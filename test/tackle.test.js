import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { GOAL_LINE_Y } from '../src/dots/carrier.js';
import { TACKLE_DIST, canTackle, findTackler, playEnd } from '../src/dots/tackle.js';
import { HW } from '../src/util.js';

const DT = 1 / 60;
const car = (x = 0, y = 0) => ({ id: 'C', team: 'offense', x, y });
const def = (id, dx, dy = 0) => ({ id, team: 'defense', x: dx, y: dy });

test('tackle: in-reach unblocked defender tackles', () => {
  const players = [car(), def('D', TACKLE_DIST, 0)];
  assert.equal(canTackle(players[1], players[0], players), true);
  assert.deepEqual(playEnd(players, 'C'), { reason: 'tackle', by: 'D' });
});

test('tackle: just beyond TACKLE_DIST does not', () => {
  const players = [car(), def('D', TACKLE_DIST + BODY_RADIUS / 100, 0)];
  assert.equal(playEnd(players, 'C'), null);
});

test('tackle: defender with an engaged blocker on him does not', () => {
  const players = [
    car(),
    def('D', BODY_RADIUS, 0),
    { id: 'B', team: 'offense', x: 3 * BODY_RADIUS, y: 0, block: { engaged: true, target: 'D' } },
  ];
  assert.equal(findTackler(players, players[0]), null);
  assert.equal(playEnd(players, 'C'), null);
});

test('tackle: nearest of two wins', () => {
  const players = [car(), def('far', TACKLE_DIST, 0), def('near', 0, 2 * BODY_RADIUS)];
  assert.equal(findTackler(players, players[0]), 'near');
});

test('tackle: offense player in reach never tackles', () => {
  const players = [car(), { id: 'O', team: 'offense', x: BODY_RADIUS, y: 0 }];
  assert.equal(canTackle(players[1], players[0], players), false);
  assert.equal(playEnd(players, 'C'), null);
});

test('tackle: touchdown, out, and touchdown beats tackle', () => {
  assert.deepEqual(playEnd([car(0, GOAL_LINE_Y)], 'C'), { reason: 'touchdown', by: null });
  assert.deepEqual(playEnd([car(HW + BODY_RADIUS, 0)], 'C'), { reason: 'out', by: null });
  const players = [car(0, GOAL_LINE_Y), def('D', BODY_RADIUS, GOAL_LINE_Y)];
  assert.equal(playEnd(players, 'C').reason, 'touchdown');
});

function runUntilDead(play, limit) {
  for (let t = 0; t < limit && play.ball.phase !== 'dead'; t += DT) play.step(DT);
}

test('tackle scenario: odd34 inside zone ends in a tackle', () => {
  const play = createPlay(25, 'insideZone', { front: 'odd34' });
  play.snap();
  runUntilDead(play, 4);
  console.log('odd34 result', JSON.stringify(play.result));
  assert.equal(play.ball.phase, 'dead');
  assert.equal(play.result.reason, 'tackle');
  const tackler = play.player(play.result.by);
  assert.ok(tackler && tackler.team === 'defense');
  const c = play.player(play.run.carrier);
  assert.ok(Math.hypot(tackler.x - c.x, tackler.y - c.y) <= TACKLE_DIST);
  assert.equal(play.result.yards, c.y - 25);
});

test('tackle scenario: base front ends', () => {
  const play = createPlay(25, 'insideZone', { front: 'base' });
  play.snap();
  runUntilDead(play, 12);
  console.log('base result', JSON.stringify(play.result));
  assert.equal(play.ball.phase, 'dead');
  assert.ok(['tackle', 'touchdown', 'out'].includes(play.result.reason));
  assert.equal(play.result.yards, play.player(play.run.carrier).y - 25);
});

test('tackle: dead play freezes; reset clears result', () => {
  const play = createPlay(25, 'insideZone', { front: 'odd34' });
  play.snap();
  runUntilDead(play, 4);
  assert.equal(play.ball.phase, 'dead');
  const pos = () => play.players.map((p) => [p.id, p.x, p.y]);
  const before = pos();
  const ball = play.ballPosition();
  play.step(1);
  assert.deepEqual(pos(), before);
  assert.deepEqual(play.ballPosition(), ball);
  play.reset();
  assert.equal(play.result, null);
  assert.equal(play.ball.phase, 'presnap');
});

test('tackle: nothing is tackled before the handoff', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  for (let i = 0; i < 600 && play.ball.phase !== 'held'; i++) play.step(DT);
  assert.equal(play.ball.phase, 'held');
  const qb = play.player(play.ball.holder);
  const d = play.players.find((p) => p.team === 'defense');
  d.x = qb.x;
  d.y = qb.y;
  play.step(DT);
  assert.notEqual(play.ball.phase, 'dead');
});

test('tackle: tackles option off never ends the play', () => {
  const play = createPlay(25, 'insideZone', { front: 'odd34', tackles: false });
  play.snap();
  for (let i = 0; i < 240; i++) {
    play.step(DT);
    assert.notEqual(play.ball.phase, 'dead');
  }
  assert.equal(play.result, null);
});
