import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { readFront } from '../src/dots/front.js';
import { CONTAIN_DEPTH, CONTAIN_WIDTH, CONTAIN_SPEED } from '../src/dots/defense.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';

const DT = 1 / 60;
const CAP = 4; // s
const LOS = 25;
const LOOK_KEYS = ['te', 'noTe'];
const PLAY_FRONTS = ['base', 'over43', 'walkedUp', 'odd34'];
const WORK_EPS = 0.01; // yd: a squeeze move toward the playside under this is noise
const CONTAIN_STATES = ['read', 'squeeze'];

// Runs one insideZone play from snap to dead or the cap, one tick per step, and records the backside edge each tick.
function runPlay(front, personnel) {
  const play = createPlay(LOS, 'insideZone', { front, personnel });
  assert.ok(play.snap());
  const edge = readFront(play.players, play.numbers, LOS).edge;
  const side = play.defense.side;
  const centerX = play.defense.centerX;
  const lastLine = play.defense.lineIds[play.defense.lineIds.length - 1].id;
  const ticks = [];
  if (edge == null) return { play, edge, side, centerX, ticks, skipped: true };
  const start = play.player(edge);
  const startPos = { x: start.x, y: start.y };
  for (let t = 0; t < Math.round(CAP / DT) && play.ball.phase !== 'dead'; t++) {
    play.step(DT);
    const e = play.player(edge);
    const carrier = play.player(play.run.carrier);
    ticks.push({
      t,
      state: play.defense.agents[edge].state,
      x: e.x,
      y: e.y,
      engaged: play.blockersOf(edge).length > 0,
      locked: play.run.locked,
      runX: play.run.x,
      containX: play.player(lastLine).x - side * CONTAIN_WIDTH,
      carrierY: carrier.y,
      dead: play.ball.phase === 'dead',
    });
  }
  return { play, edge, side, centerX, ticks, startPos, skipped: false };
}

for (const front of Object.keys(FRONTS)) {
  test(`F-38 #7: ${front} backside edge reads on snap for both looks`, () => {
    for (const personnel of LOOK_KEYS) {
      const play = createPlay(LOS, 'insideZone', { front, personnel });
      assert.ok(play.snap());
      const edge = readFront(play.players, play.numbers, LOS).edge;
      if (edge == null) {
        assert.notEqual(front, 'base', `base ${personnel} has no backside edge`);
        continue;
      }
      const agent = play.defense.agents[edge];
      assert.equal(agent.behavior, 'contain', `${front} ${personnel} edge ${edge} behaviour`);
      assert.equal(agent.state, 'read', `${front} ${personnel} edge ${edge} state`);
    }
  });
}

for (const front of PLAY_FRONTS) {
  for (const personnel of LOOK_KEYS) {
    test(`F-38 #8: ${front} ${personnel}: backside edge reads, squeezes and pursues on the commit`, () => {
      const { play, edge, side, centerX, ticks, startPos, skipped } = runPlay(front, personnel);
      if (skipped) {
        console.log(`${front} ${personnel}: no backside edge, case skipped`);
        return;
      }
      const label = `${front} ${personnel} edge ${edge}`;
      const engagedEver = ticks.some((k) => k.engaged);
      const last = ticks[ticks.length - 1];

      // (a) the edge never tackles the RB in the backfield before the commit
      if (play.result?.reason === 'tackle' && play.result.by === edge) {
        assert.ok(
          last.locked || last.carrierY > LOS,
          `${label} tackled the RB behind the LOS before the commit at t=${play.result.time}`,
        );
      }

      // (b) the edge holds at or above the contain depth floor while reading or squeezing
      ticks.forEach((k, i) => {
        if (!CONTAIN_STATES.includes(k.state)) return;
        assert.ok(
          k.y >= LOS - CONTAIN_DEPTH - BODY_RADIUS,
          `${label} at tick ${i} (${k.state}) y=${k.y} below depth floor ${LOS - CONTAIN_DEPTH - BODY_RADIUS}`,
        );
      });

      // (c) a squeeze never works inside the contain point
      for (let i = 1; i < ticks.length; i++) {
        const prev = ticks[i - 1];
        const cur = ticks[i];
        if (prev.state !== 'squeeze' || cur.state !== 'squeeze') continue;
        if (prev.engaged || cur.engaged) continue;
        if (side * (cur.x - prev.x) > WORK_EPS) {
          assert.ok(
            side * (prev.x - prev.containX) < 0,
            `${label} squeezed inside its contain x at tick ${i}: prev x=${prev.x} containX=${prev.containX} now x=${cur.x}`,
          );
        }
      }

      // (d) mean speed over unengaged read and squeeze ticks stays at the controlled rate
      let path = 0;
      let time = 0;
      let prevPos = startPos;
      for (const k of ticks) {
        if (CONTAIN_STATES.includes(k.state) && !k.engaged) {
          path += Math.hypot(k.x - prevPos.x, k.y - prevPos.y);
          time += DT;
        }
        prevPos = { x: k.x, y: k.y };
      }
      if (time > 0) {
        const mean = path / time;
        const max = CONTAIN_SPEED * play.player(edge).speed * 1.05;
        assert.ok(mean <= max, `${label} mean contain speed ${mean.toFixed(3)} yd/s above ${max.toFixed(3)}`);
      }

      // (e) the edge pursues by the end of the tick after the RB commits playside of center
      const commitIdx = ticks.findIndex((k) => k.locked && side * (k.runX - centerX) > 0);
      if (commitIdx === -1) {
        assert.notEqual(front, 'base', `${label}: RB never committed playside of center`);
      } else if (!ticks[commitIdx].dead && commitIdx + 1 < ticks.length) {
        const next = ticks[commitIdx + 1];
        assert.equal(next.state, 'pursue', `${label} at tick ${commitIdx + 1} is ${next.state} one tick after the commit`);
      }

      console.log(
        `F-38 #8 ${front} ${personnel}: tackler=${play.result?.by ?? null} reason=${play.result?.reason ?? null} ` +
          `yards=${play.result?.yards?.toFixed(2) ?? null} time=${play.result?.time?.toFixed(2) ?? null} ` +
          `commitBy=${play.run.commitBy ?? null} edgeFinal=${last?.state ?? null} engagedEver=${engagedEver}`,
      );
    });
  }
}
