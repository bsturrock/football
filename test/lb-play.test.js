import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { CONTACT_DIST, RELEASE_PAST } from '../src/dots/blocking.js';

const DT = 1 / 60;
const CAP = 8;
const ORBIT_MAX = 1.5; // yd, outer edge of the orbit band
const ORBIT_TIME = 0.5; // s of consecutive ticks
const MOVE_MIN = 0.01; // yd a tick must move to count for heading
const MAX_FLIPS = 3;

for (const front of Object.keys(FRONTS)) {
  test(`F-34 #8: ${front} insideZone ends in a tackle, LBs do not orbit, pin or jitter`, () => {
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
    assert.equal(play.result?.reason, 'tackle', `${front} ended with ${play.result?.reason}`);
  });
}
