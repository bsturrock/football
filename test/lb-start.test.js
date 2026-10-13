import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEHAVIORS, GOALS, FIT_LEAD, PACE_NAMES, PURSUE_REACH, FILL_DEPTH, OVER_TOP, LB_PURSUE_EXITS, READ_SPEED, gapSpan, stepDefense, validateBehavior,
} from '../src/dots/defense.js';
import { createPlay } from '../src/dots/play.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';

const LOS = 25;
const by = (pl, id) => pl.find((p) => p.id === id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

// A base-front play with the run carried, the MLB set to fit at his alignment depth, and the ball placed by the caller.
const carriedPlay = () => {
  const play = createPlay(LOS, 'insideZone', { tackles: false });
  play.snap();
  let i = 0;
  while (!play.run.carried && i < 3000) { play.step(1 / 60); i++; }
  assert.ok(play.run.carried, 'the run is carried');
  const mlb = by(play.players, 'MLB');
  const e = play.defense.agents.MLB;
  e.state = 'fit';
  e.st = 0;
  e.why = 'test';
  mlb.y = LOS + 1.0;
  return { play, mlb, e };
};

test('F-72 #2: validateBehavior accepts a burst pace and throws on any other pace', () => {
  const bad = { start: 'a', keys: [], states: { a: { goal: 'hold', speed: 1, pace: 'walk', exits: [] } } };
  assert.throws(() => validateBehavior('bad', { bad }), /defense: behavior "bad" state "a" bad pace "walk"/);
  const ok = { start: 'a', keys: [], states: { a: { goal: 'hold', speed: 1, pace: 'burst', exits: [] } } };
  assert.equal(validateBehavior('ok', { ok }), ok);
  assert.deepEqual(PACE_NAMES, ['burst']);
});

test('F-72 #2: zone fit, scrape, split, takeOn and pursue are burst; read and drop are not', () => {
  const z = BEHAVIORS.zone.states;
  for (const s of ['fit', 'scrape', 'split', 'takeOn', 'pursue']) assert.equal(z[s].pace, 'burst', s);
  for (const s of ['read', 'drop']) assert.equal(z[s].pace, undefined, s);
});

test('F-72 #4: a fitting LB goes to pursue on ballClose and his goal carries pace burst', () => {
  const { play, mlb, e } = carriedPlay();
  // Ball behind the los, 1.2 yd below the LB and 1.0 yd to his side: about 1.56 yd, inside PURSUE_REACH.
  const ballPos = { x: mlb.x + 1.0, y: LOS - 0.2 };
  const out = stepDefense(play.players, play.defense, { run: play.run, ballPos, cues: () => null }, 1 / 60);
  assert.equal(e.state, 'pursue');
  assert.equal(e.why, 'ballClose');
  assert.equal(out.MLB.pace, 'burst');
});

test('F-72 #4: a fitting LB stays in fit when the carried ball is just outside PURSUE_REACH', () => {
  const { play, mlb, e } = carriedPlay();
  const dist = PURSUE_REACH + 0.2;
  // Same 1.2 yd depth below the LB, placed so the distance is exactly PURSUE_REACH + 0.2, still behind the los.
  const ballPos = { x: mlb.x + Math.sqrt(dist * dist - 1.2 * 1.2), y: LOS - 0.2 };
  const out = stepDefense(play.players, play.defense, { run: play.run, ballPos, cues: () => null }, 1 / 60);
  assert.equal(e.state, 'fit');
  assert.equal(out.MLB.pace, 'burst', 'fit is a burst state');
});

test('F-72 #8: fitGap aims where the seen ball will be FIT_LEAD s on, and stays put when the ball is still', () => {
  const play = createPlay(LOS, 'insideZone', { tackles: false });
  play.snap();
  // Widen the play-side A gap (LG to the left) so the span does not clamp the aim.
  by(play.players, 'LG').x = -6;
  const e = { ...play.defense.agents.MLB, fit: { side: 'play', name: 'A' } };
  const span = gapSpan(play.players, play.defense, e.fit);
  const x = (span.lo + span.hi) / 2;
  assert.ok(x + 2 * FIT_LEAD >= span.lo + BODY_RADIUS && x + 2 * FIT_LEAD <= span.hi - BODY_RADIUS, 'the lead aim is not clamped');
  const env = (vx) => ({
    players: play.players, defense: play.defense, los: LOS,
    cues: () => ({ ball: { x, y: LOS, vx, vy: 0 } }),
  });
  const mlb = by(play.players, 'MLB');
  near(GOALS.fitGap(mlb, e, env(2)).x, x + 2 * FIT_LEAD);
  near(GOALS.fitGap(mlb, e, env(0)).x, x);
  near(GOALS.fitGap(mlb, e, env(2)).y, LOS + FILL_DEPTH);
});

test('F-72 #8: scrapeGoal leads the seen ball by FIT_LEAD s, one OVER_TOP behind the flow', () => {
  const play = createPlay(LOS, 'insideZone', { tackles: false });
  play.snap();
  const mlb = by(play.players, 'MLB');
  const e = { ...play.defense.agents.MLB, assign: null };
  const x = -3;
  const env = (vx) => ({
    players: play.players, defense: play.defense, los: LOS,
    cues: () => ({ ball: { x, y: LOS, vx, vy: 0 }, flow: { dir: 1 } }),
  });
  near(GOALS.scrapeGoal(mlb, e, env(2)).x, x + 2 * FIT_LEAD - OVER_TOP);
  near(GOALS.scrapeGoal(mlb, e, env(0)).x, x - OVER_TOP);
});

test('F-72 #3: LB_PURSUE_EXITS has the ballClose row after the existing three', () => {
  assert.deepEqual(LB_PURSUE_EXITS.map((x) => x.when), ['shed', 'carrierPast', 'ballCommitted', 'ballClose']);
  assert.ok(READ_SPEED > 0.5);
});
