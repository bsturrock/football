import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { BODY_RADIUS, CONTACT_DIST, RELEASE_PAST } from '../src/dots/blocking.js';
import { LANE_AHEAD } from '../src/dots/carrier.js';

const DT = 1 / 60;
const CAP = 8;
const ORBIT_MAX = 1.5; // yd, outer edge of the orbit band
const ORBIT_TIME = 0.5; // s of consecutive ticks
// yd a tick must move to count for heading. The jitter check targets visible heading flips (R-39: an SLB
// flipping 5+ times stuck in traffic). A 0.01 yd sample also counts sub-inch corrections: an LB mirrors a
// gap edge set by an engaged DL's x, and that edge wobbles 1-2 cm, so measured reversals there are noise.
const MOVE_MIN = BODY_RADIUS / 8;
const MAX_FLIPS = 3;
// A breakaway: the carrier is past the second level and past every defender.
const brokeAway = (play, los) => {
  const c = play.player(play.ball.holder ?? play.run.carrier);
  return c.y >= los + LANE_AHEAD && play.players.every((d) => d.team !== 'defense' || d.y < c.y);
};
for (const front of Object.keys(FRONTS)) {
  test(`F-34 #8: ${front} insideZone ends in a tackle or a breakaway, LBs do not orbit, pin or jitter`, () => {
    const play = createPlay(25, 'insideZone', { front });
    assert.ok(play.snap());
    const lbs = Object.keys(play.defense.agents).filter((id) => play.defense.agents[id].behavior === 'zone');
    assert.ok(lbs.length > 0);
    const orbit = Object.fromEntries(lbs.map((id) => [id, 0]));
    const flips = Object.fromEntries(lbs.map((id) => [id, 0]));
    const prevPos = Object.fromEntries(lbs.map((id) => [id, { x: play.player(id).x, y: play.player(id).y }]));
    const prevHead = Object.fromEntries(lbs.map((id) => [id, null]));
    for (let t = 0; t < CAP / DT && play.ball.phase !== 'dead'; t++) {
      play.step(DT);
      const carrier = play.player(play.ball.holder ?? play.run.carrier);
      for (const id of lbs) {
        const lb = play.player(id);
        const engaged = play.blockersOf(id).length > 0;
        const dist = Math.hypot(lb.x - carrier.x, lb.y - carrier.y);
        const orbiting = play.defense.agents[id].state === 'pursue' && !engaged && dist > CONTACT_DIST && dist <= ORBIT_MAX;
        orbit[id] = orbiting ? orbit[id] + DT : 0;
        assert.ok(orbit[id] <= ORBIT_TIME + 1e-9, `${front} ${id} orbits the carrier at tick ${t}`);
        assert.ok(!(engaged && play.ballPosition().y >= lb.y + RELEASE_PAST), `${front} ${id} pinned past the ball at tick ${t}`);
        const dx = lb.x - prevPos[id].x;
        const dy = lb.y - prevPos[id].y;
        if (Math.hypot(dx, dy) >= MOVE_MIN) {
          const h = prevHead[id];
          if (h && h.x * dx + h.y * dy < 0) flips[id]++;
          prevHead[id] = { x: dx, y: dy };
          prevPos[id] = { x: lb.x, y: lb.y };
        }
      }
    }
    for (const id of lbs) assert.ok(flips[id] <= MAX_FLIPS, `${front} ${id} flipped heading ${flips[id]} times`);
    const carrierY = play.player(play.ball.holder ?? play.run.carrier).y;
    assert.ok(play.result?.reason === 'tackle' || brokeAway(play, 25), `${front} ended with ${play.result?.reason}, carrier y ${carrierY}`);
  });
}
