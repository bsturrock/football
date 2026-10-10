import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { buildLineup, FRONTS } from '../src/dots/roster.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import {
  scoreLanes, chooseLane, visionOf, DEFAULT_VISION, LANE_AHEAD, SWITCH_MARGIN, SECOND_LEVEL_DEPTH, LEVEL2_CAP,
  LEVEL2_COST, FLOW_HORIZON, ROOM_CAP, TRACK_COST, CUT_COST, laneWindows,
} from '../src/dots/carrier.js';

const DT = 1 / 60;
const LOS = 25;
const REPORT = process.env.RB_VISION_REPORT === '1';

// Handed-off carrier, every defender parked far away.
function setup() {
  const play = createPlay(LOS, 'insideZone', { tackles: false });
  play.snap();
  for (let i = 0; i < 300 && !play.run.carried; i++) play.step(DT);
  assert.ok(play.run.carried, 'carried');
  const rb = play.player('RB');
  const ds = play.players.filter((p) => p.team === 'defense');
  ds.forEach((d, i) => { d.x = 15 + i; d.y = 45; });
  return { play, rb, ds, run: play.run };
}
const lb = (ds) => ds.find((d) => d.role === 'LB');
const score = (s, flow) => scoreLanes(s.play.players, s.run, s.rb, LOS, undefined, flow);
const pick = (lanes, name, side) => lanes.find((l) => l.name === name && l.side === side);
// The two open lanes used as P and Q.
function pq(s) {
  const base = score(s);
  return [pick(base, 'B', 'play'), pick(base, 'B', 'back')];
}

test('F-48 #1: the RB has vision 0.8, others none, and the helper defaults and clamps', () => {
  const rows = buildLineup(LOS, 'insideZone');
  assert.equal(rows.find((p) => p.id === 'RB').vision, 0.8);
  for (const p of rows.filter((q) => q.id !== 'RB')) assert.ok(!('vision' in p), `${p.id} has no vision key`);
  assert.equal(visionOf({}), DEFAULT_VISION);
  assert.equal(visionOf({ vision: 3 }), 1);
  assert.equal(visionOf({ vision: -1 }), 0);
});

test('F-48 #1: vision 0 scores exactly the formula without the second-level term', () => {
  for (const layout of [0, 1, 2]) {
    const s = setup();
    const [P, Q] = pq(s);
    const d = lb(s.ds);
    if (layout === 1) { d.x = P.x; d.y = LOS + LANE_AHEAD + 1; }
    if (layout === 2) { d.x = Q.x + 0.5; d.y = LOS + LANE_AHEAD + 2; }
    s.rb.vision = 0;
    const trackX = s.play.players.find((p) => p.id === s.run.line.find((l) => l.n === s.run.track).id).x;
    for (const l of score(s, { [d.id]: 2 })) {
      const expect = Math.min(l.room, ROOM_CAP) - TRACK_COST * Math.abs(l.x - trackX) - CUT_COST * Math.abs(l.x - s.rb.x);
      assert.ok(Math.abs(l.score - expect) < 1e-12, `layout ${layout} ${l.side}${l.name} ${l.score} vs ${expect}`);
      assert.equal(l.level2, 0);
    }
  }
});

test('F-48 #2: an LB in the second level over P sends a full-vision back to Q', () => {
  const s = setup();
  const [P, Q] = pq(s);
  assert.ok(P.open && Q.open);
  s.rb.vision = 1;
  const d = lb(s.ds);
  const none = score(s);
  d.x = P.x;
  d.y = LOS + LANE_AHEAD + 2 * BODY_RADIUS;
  const lanes = score(s);
  const p = pick(lanes, 'B', 'play');
  const q = pick(lanes, 'B', 'back');
  if (REPORT) console.log('F-48 #2 insideZone base', JSON.stringify(lanes.map((l) => [l.side + l.name, +l.level2.toFixed(3), +l.score.toFixed(3)])));
  assert.equal(q.level2, 0, 'nobody near Q');
  assert.ok(p.level2 > 0, 'P is penalised');
  assert.ok(q.score - p.score > SWITCH_MARGIN, `Q ${q.score} beats P ${p.score} by more than the margin`);
  assert.equal(chooseLane(lanes, { side: 'play', name: 'B' }).name, 'B');
  assert.equal(chooseLane(lanes, { side: 'play', name: 'B' }).side, 'back', 'the pick moves to Q');
  // Without the LB the two are within the margin, so the pick is not that LB's doing elsewhere.
  assert.ok(Math.abs(pick(none, 'B', 'play').level2) === 0);
});

test('F-48 #2: the penalty grows with vision and never applies out of range', () => {
  const s = setup();
  const [P] = pq(s);
  const d = lb(s.ds);
  d.x = P.x;
  d.y = LOS + LANE_AHEAD + 2 * BODY_RADIUS;
  const pen = [0, 0.5, 1].map((v) => { s.rb.vision = v; return pick(score(s), 'B', 'play').level2; });
  assert.equal(pen[0], 0);
  assert.ok(pen[0] < pen[1] && pen[1] < pen[2], `penalties ${pen}`);
  assert.ok(Math.abs(pen[2] - 2 * pen[1]) < 1e-12, 'linear in vision');
  assert.ok(pen[2] <= LEVEL2_COST * (LEVEL2_CAP + 1));
  // Beyond the second level, or inside the band (freeLane's job), the term adds nothing.
  s.rb.vision = 1;
  d.y = LOS + LANE_AHEAD + SECOND_LEVEL_DEPTH + 0.5;
  assert.equal(pick(score(s), 'B', 'play').level2, 0, 'too deep');
  d.y = LOS + LANE_AHEAD - 0.1;
  assert.equal(pick(score(s), 'B', 'play').level2, 0, 'in the band');
  // Lateral clearance past the cap costs nothing.
  d.y = LOS + LANE_AHEAD + 2 * BODY_RADIUS;
  d.x = P.x + LEVEL2_CAP + 1;
  assert.equal(pick(score(s), 'B', 'play').level2, 0, 'clear laterally');
});

test('F-48 #3: flow toward Q penalises Q, flow off P frees P', () => {
  const s = setup();
  const [P, Q] = pq(s);
  s.rb.vision = 1;
  const d = lb(s.ds);
  d.x = (P.x + Q.x) / 2;
  d.y = LOS + LANE_AHEAD + 2 * BODY_RADIUS;
  const dir = Math.sign(Q.x - P.x);
  const still = score(s);
  const toQ = score(s, { [d.id]: dir * 4 });
  assert.ok(pick(toQ, 'B', 'back').level2 > pick(still, 'B', 'back').level2, 'Q penalised by flow toward it');
  assert.ok(pick(toQ, 'B', 'play').level2 < pick(still, 'B', 'play').level2, 'P freed by flow away from it');
  const toP = score(s, { [d.id]: -dir * 4 });
  assert.ok(pick(toP, 'B', 'play').level2 > pick(still, 'B', 'play').level2);
  // Missing flow reads as zero, and the look-ahead is capped.
  assert.deepEqual(score(s, {}).map((l) => l.score), still.map((l) => l.score));
  // The projection stops at FLOW_HORIZON: the lateral move is bounded by vx * FLOW_HORIZON.
  const a = score(s, { [d.id]: dir * 10 });
  const b = score(s, { [d.id]: dir * 10 + 1e-3 });
  const dx = 1e-3 * FLOW_HORIZON;
  assert.ok(Math.abs(pick(a, 'B', 'back').level2 - pick(b, 'B', 'back').level2) <= LEVEL2_COST * dx + 1e-9);
});

test('F-48 #4: a defender with a blocker engaged adds nothing', () => {
  const s = setup();
  const [P] = pq(s);
  s.rb.vision = 1;
  const d = lb(s.ds);
  d.x = P.x;
  d.y = LOS + LANE_AHEAD + 2 * BODY_RADIUS;
  assert.ok(pick(score(s), 'B', 'play').level2 > 0);
  const ol = s.play.players.find((p) => p.team === 'offense' && p.role === 'OL');
  const saved = ol.block;
  ol.block = { target: d.id, engaged: true };
  const lanes = score(s);
  ol.block = saved;
  assert.ok(lanes.every((l) => l.level2 === 0), 'engaged LB leaves every lane unpenalised');
  assert.ok(laneWindows(s.play.players, s.run.line, s.run.side).length > 0);
});

test('F-48 #11a: no dithering on any front, either personnel', () => {
  for (const front of Object.keys(FRONTS)) {
    for (const personnel of ['noTe', 'te']) {
      const play = createPlay(LOS, 'insideZone', { front, personnel });
      play.snap();
      const run = play.run;
      const seq = [];
      let prev = null;
      for (let n = 1; n <= 300 && !run.locked && play.ball.phase !== 'dead'; n++) {
        play.step(DT);
        if (!(run.carried && !run.locked)) continue;
        const key = run.lane.side + run.lane.name;
        if (key !== prev) { seq.push({ n, key }); prev = key; }
      }
      const ctx = `${front}/${personnel} ${JSON.stringify(seq)}`;
      assert.ok(seq.length - 1 <= 3, `at most 3 pick changes: ${ctx}`);
      for (let i = 2; i < seq.length; i++) {
        if (seq[i].key === seq[i - 2].key) {
          assert.ok((seq[i].n - seq[i - 1].n) * DT >= 0.2, `A-B-A flip within 0.2 s: ${ctx}`);
        }
      }
    }
  }
});
