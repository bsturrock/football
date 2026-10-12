// T-57 (F-58 #5, #6, #7, #12): play scenarios judged by rule, never yards or time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { GOALS, gapSpan, intercept, LEVER_V } from '../src/dots/defense.js';

const LOS = 25;
const TICKS = 240;
const SCENARIOS = [];
for (const front of Object.keys(FRONTS)) for (const playside of ['left', 'right']) SCENARIOS.push({ name: `${front} ${playside}`, opts: { front, playside, tackles: false } });
SCENARIOS.push({ name: '11', opts: { formation: '11', tackles: false } });
SCENARIOS.push({ name: 'twoGap call', opts: { call: 'twoGap', tackles: false } });

const envOf = (play) => ({ players: play.players, defense: play.defense, run: play.run, ballPos: play.ballPosition(), los: LOS, behavior: null, cues: (id) => play.cuesOf(id) });
const engagers = (play, id) => play.players.filter((p) => p.block?.target === id && p.block.engaged);
const gapCentreSide = (play, e, b) => {
  const span = e.fit ? gapSpan(play.players, play.defense, e.fit) : null;
  return span ? Math.sign((span.lo + span.hi) / 2 - b.x) : 0;
};

// Walks each scenario; fn(play, tick) runs after every step.
function run(fn) {
  let n = 0;
  for (const { name, opts } of SCENARIOS) {
    const play = createPlay(LOS, 'insideZone', opts);
    assert.ok(play.snap(), name);
    for (let t = 0; t < TICKS && play.ball.phase !== 'dead'; t++) {
      play.step(FIXED_DT);
      n += fn(play, t, name) ?? 0;
    }
  }
  return n;
}
const zoneIds = (play) => Object.keys(play.defense.agents).filter((id) => play.defense.agents[id].behavior === 'zone');

test('T-57 (a): an unengaged LB in takeOn aims at his gap side of the climber', () => {
  const n = run((play, t, name) => {
    let k = 0;
    for (const id of zoneIds(play)) {
      const e = play.defense.agents[id];
      if (e.state !== 'takeOn' || engagers(play, id).length) continue;
      const g = GOALS.takeOn(play.player(id), e, envOf(play)); // sets e.climber to the player he now takes on
      const b = play.players.find((p) => p.id === e.climber);
      const side = gapCentreSide(play, e, b);
      if (side !== 0) assert.equal(Math.sign(g.x - b.x), side, `${name} ${id} tick ${t}`);
      k++;
    }
    return k;
  });
  assert.ok(n >= 0);
});

test('T-57 (b): an engaged LB in takeOn aims at his gap side of his blocker', () => {
  run((play, t, name) => {
    for (const id of zoneIds(play)) {
      const e = play.defense.agents[id];
      const bs = engagers(play, id);
      if (e.state !== 'takeOn' || bs.length === 0) continue;
      const g = GOALS.takeOn(play.player(id), e, envOf(play));
      const b = bs.find((p) => p.id === e.climber) ?? bs[0];
      const side = gapCentreSide(play, e, b);
      if (side !== 0) assert.equal(Math.sign(g.x - b.x), side, `${name} ${id} tick ${t}`);
    }
  });
});

test('T-57 (c): one tick after the ball commits, every LB and one-gap DL is in pursue and every two-gap DL in twoGapFit or pursue', () => {
  let committedSeen = 0;
  for (const { name, opts } of SCENARIOS) {
    const play = createPlay(LOS, 'insideZone', opts);
    assert.ok(play.snap(), name);
    let pending = [];
    for (let t = 0; t < TICKS && play.ball.phase !== 'dead'; t++) {
      play.step(FIXED_DT);
      for (const id of pending) {
        const e = play.defense.agents[id];
        const ok = e.behavior === 'twoGap' ? ['twoGapFit', 'pursue'].includes(e.state) : e.state === 'pursue';
        assert.ok(ok, `${name} ${id} (${e.behavior}) is ${e.state} one tick after the ball committed, tick ${t}`);
      }
      pending = Object.keys(play.defense.agents).filter((id) => {
        const e = play.defense.agents[id];
        return !e.script && ['zone', 'attack', 'twoGap'].includes(e.behavior) && play.cuesOf(id)?.ball?.committed === true;
      });
      committedSeen += pending.length;
    }
  }
  assert.ok(committedSeen > 0);
});

test('T-57 (d): a pursuer inside of a sideways-moving ball aims inside the ball\'s intercept point', () => {
  const n = run((play, t, name) => {
    let k = 0;
    for (const [id, e] of Object.entries(play.defense.agents)) {
      if (e.state !== 'pursue') continue;
      const d = play.player(id);
      const c = play.cuesOf(id)?.ball;
      if (!c || Math.abs(c.vx) < LEVER_V) continue;
      const s = Math.sign(c.vx);
      if (!(s * (d.x - c.x) < 0)) continue;
      const g = GOALS.pursue(d, e, envOf(play));
      const p = intercept(d, { x: c.x, y: c.y }, { x: c.vx, y: c.vy }, d.speed);
      assert.ok(s * (g.x - p.x) <= 1e-9, `${name} ${id} tick ${t}`);
      k++;
    }
    return k;
  });
  assert.ok(n > 0);
});
