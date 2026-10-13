import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { BEHAVIORS, GOALS, DL_WIDEN_MAX, ARM_FREE, validateBehavior, stepDefense, widenClamp } from '../src/dots/defense.js';

const NO_WIDEN_ROWS = ['getoff', 'hold', 'outsideArm', 'anchor', 'close', 'rush', 'squeeze'];

test('F-73 (a): noWiden is validated and sits on the attack rows', () => {
  assert.equal(DL_WIDEN_MAX, BODY_RADIUS);
  const copy = (v) => {
    const b = structuredClone(BEHAVIORS.attack);
    b.states.hold.noWiden = v;
    return { attack: b };
  };
  validateBehavior('attack', copy(true));
  assert.throws(() => validateBehavior('attack', copy('yes')), /bad noWiden "yes"/);
  for (const n of NO_WIDEN_ROWS) assert.equal(BEHAVIORS.attack.states[n].noWiden, true, n);
  assert.equal(BEHAVIORS.attack.states.pursue.noWiden, undefined);
  assert.equal(BEHAVIORS.attack.states.getoff.pace, 'burst');
  for (const [name, b] of Object.entries(BEHAVIORS)) {
    if (name === 'attack') continue;
    for (const row of Object.values(b.states)) assert.equal(row.noWiden, undefined, name);
  }
});

test('F-73 (b): the emitted goal is clamped to DL_WIDEN_MAX outside the snap x; inside goals pass through', () => {
  const play = createPlay(25, 'insideZone', { formation: '11', playside: 'left', tackles: false });
  assert.ok(play.snap());
  play.step(FIXED_DT);
  const id = 'PE';
  const e = play.defense.agents[id];
  const o = Math.sign(e.x0 - play.defense.centerX);
  assert.notEqual(o, 0);
  const b = play.player(e.blocker);
  const cues = () => ({ felt: 'reach', tech: { blocker: e.blocker } });
  const run = (target) => {
    b.x = target - play.defense.side * ARM_FREE;
    e.state = 'outsideArm';
    e.st = 0;
    const goal = GOALS.outsideArm(play.player(id), e, { players: play.players, defense: play.defense, run: play.run, ballPos: play.ballPosition(), los: play.defense.los, cues });
    assert.ok(Math.abs(goal.x - target) < 1e-9);
    const out = stepDefense(play.players, play.defense, { run: play.run, ballPos: play.ballPosition(), cues }, 0);
    assert.equal(e.state, 'outsideArm');
    return out[id];
  };
  const wide = run(e.x0 + o * (DL_WIDEN_MAX + 1));
  assert.ok(Math.abs(wide.x - (e.x0 + o * DL_WIDEN_MAX)) < 1e-9);
  const inside = run(e.x0 - o * 1);
  assert.ok(Math.abs(inside.x - (e.x0 - o * 1)) < 1e-9);
});

test('F-73 (c): the playside end never has a goal wider than DL_WIDEN_MAX before pursuit', (t) => {
  const play = createPlay(25, 'insideZone', { formation: '11', playside: 'left', tackles: false });
  assert.ok(play.snap());
  const id = 'PE';
  const e = play.defense.agents[id];
  const o = Math.sign(e.x0 - play.defense.centerX);
  assert.notEqual(o, 0);
  let widest = 0;
  let checked = 0;
  for (let i = 0; i < 240; i++) {
    play.step(FIXED_DT);
    const d = play.player(id);
    widest = Math.max(widest, o * (d.x - e.x0));
    const behavior = BEHAVIORS[e.behavior];
    const row = behavior.states[e.state];
    if (e.state === 'pursue' || !row.noWiden) continue;
    const env = { players: play.players, defense: play.defense, run: play.run, ballPos: play.ballPosition(), los: play.defense.los, behavior, cues: play.cuesOf };
    const g = GOALS[row.goal](d, e, env);
    if (!g) continue;
    checked++;
    const x = widenClamp(e, play.defense, g.x);
    assert.ok(o * (x - e.x0) <= DL_WIDEN_MAX + 1e-9, `tick ${i} ${e.state}: goal ${x} vs x0 ${e.x0}`);
  }
  assert.ok(checked > 0);
  t.diagnostic(`PE widest actual x outside snap x: ${widest.toFixed(2)} yd`);
  assert.ok(widest < 3, `PE drifted ${widest} yd wide`); // clearly broken (PRINCIPLES #7)
});
