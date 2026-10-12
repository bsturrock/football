import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { BODY_RADIUS, RELEASE_PAST } from '../src/dots/blocking.js';
import { SCRIPTS } from '../src/dots/defense.js';
import { footGoal, levelCeiling, LEVEL_LEAD, TECHNIQUES } from '../src/dots/technique.js';
import { steerStep } from '../src/dots/steering.js';

const DT = 1 / 60;
const foot = (tech, phase = 'aim') => ({ tech, shade: 'none', watch: null, phase, ox: 0, oy: 0, ride: 0, push: null });

test('F-57 #11b: the climb aim carries a level ceiling at the LB\'s projected depth; other rows carry none', () => {
  assert.equal(TECHNIQUES.climb.level, true);
  const blocker = { x: 0, y: 25, speed: 5 };
  const downhill = { id: 'LB', x: -1, y: 27, vel: { x: 0, y: -5 } };
  const g = footGoal(foot('climb'), blocker, { x: -1, y: 26.44 }, 1, BODY_RADIUS, { target: downhill }).goal;
  assert.ok(Math.abs(g.ceiling - (27 - 5 * LEVEL_LEAD)) < 1e-12, JSON.stringify(g));
  // selfVel (his own step) wins over vel, as in the intercept
  assert.equal(levelCeiling({ y: 27, vel: { x: 0, y: -5 }, selfVel: { x: 0, y: -2 } }), 27 - 2 * LEVEL_LEAD);
  // no projection while he holds or drops: the ceiling is his depth
  assert.equal(levelCeiling({ y: 27, vel: { x: 3, y: 1 } }), 27);
  assert.equal(levelCeiling({ y: 27 }), 27);
  for (const tech of ['zone', 'combo', 'cutoff']) {
    const r = footGoal(foot(tech, TECHNIQUES[tech].retarget), blocker, { x: -1, y: 26.44 }, 1, BODY_RADIUS, { target: downhill }).goal;
    assert.equal(r.ceiling, undefined, tech);
  }
});

test('F-57 #11b: steerStep never ends a step upfield of goal.ceiling; above it he gives ground and keeps closing across', () => {
  const R = BODY_RADIUS;
  const max = 4 * DT;
  // a held lane between two bodies upfield pulls him upfield; the ceiling at his own depth stops the climb
  const lane = () => [{ id: 'a', x: -0.6, y: 1.5 }, { id: 'b', x: 0.6, y: 1.5 }];
  const free = { id: 'p', x: 0, y: 0 };
  steerStep(free, { x: 0, y: 4, key: 'k' }, [free, ...lane()], max, DT, R);
  assert.ok(free.y > 0, `without a ceiling he climbs: ${free.y}`);
  const held = { id: 'p', x: 0, y: 0 };
  steerStep(held, { x: 0, y: 4, key: 'k', ceiling: 0.01 }, [held, ...lane()], max, DT, R);
  assert.ok(held.y <= 0.01 + 1e-12, `ceiling holds: ${held.y}`);
  // already upfield of the ceiling (the LB came downhill under him): he gives ground, still closing across on his man
  const over = { id: 'p', x: 0, y: 0 };
  steerStep(over, { x: 2, y: 0, key: 'k', ceiling: -1 }, [over], max, DT, R);
  assert.ok(over.y < 0 && over.x > 0, JSON.stringify(over));
  assert.ok(Math.hypot(over.x, over.y) <= max + 1e-12);
  assert.ok(Math.abs(over.x - max / Math.SQRT2) < 1e-12 && Math.abs(over.y + max / Math.SQRT2) < 1e-12, JSON.stringify(over));
  // opt-in: a ceiling the step does not reach changes nothing (bit for bit)
  const a = { id: 'p', x: 0, y: 0 };
  const b = { id: 'p', x: 0, y: 0 };
  steerStep(a, { x: 0.5, y: 4, key: 'k' }, [a, ...lane()], max, DT, R);
  steerStep(b, { x: 0.5, y: 4, key: 'k', ceiling: 10 }, [b, ...lane()], max, DT, R);
  assert.equal(a.x, b.x);
  assert.equal(a.y, b.y);
});

// Climb spans (copied from the 'F-55 #6d' climbSpans in test/zone-play.test.js, with a script): per combo member
// that retargets off the combo's DL, from the climb tick until he engages, his target changes or the window ends.
function climbSpans(front, personnel, playside, script) {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, personnel, playside, script });
  play.snap();
  const combos = play.combos.map((c) => ({ ...c }));
  const spans = [];
  const open = new Map();
  for (let i = 0; i * DT < 2.0 && play.ball.phase !== 'dead'; i++) {
    play.step(DT);
    for (const c of combos) {
      for (const id of [c.owner, c.partner]) {
        const m = play.player(id);
        const key = c.owner + '/' + id;
        const sp0 = open.get(key);
        if (!sp0 && !spans.some((s) => s.key === key) && m.block && !m.block.engaged && m.block.target != null && m.block.target !== c.target) {
          const sp = { key, climber: id, front, personnel, playside, lbId: m.block.target, ticks: [] };
          open.set(key, sp);
          spans.push(sp);
        }
        const sp = open.get(key);
        if (!sp) continue;
        if (m.block?.engaged || m.block?.target == null || m.block.target !== sp.lbId) { open.delete(key); continue; }
        const lb = play.player(sp.lbId);
        // the ball is past the LB (blocking.js canEngage forbids engaging him from here): the climb is over
        if (play.ballPosition().y >= lb.y + RELEASE_PAST) { open.delete(key); continue; }
        sp.ticks.push({ i, y: m.y, vx: m.vel.x, lb: lb.id, lby: lb.y });
      }
    }
  }
  return spans;
}

test('F-57 #11b: a climber never climbs past his linebacker\'s level, every script', (t) => {
  const bad = [];
  for (const script of [null, ...Object.keys(SCRIPTS)]) {
    let spans = 0;
    let n = 0;
    let worst = -Infinity;
    for (const front of Object.keys(FRONTS)) for (const personnel of ['noTe', 'te']) for (const playside of ['left', 'right']) {
      for (const sp of climbSpans(front, personnel, playside, script)) {
        spans++;
        const k0 = sp.ticks[0];
        if (k0 && !(k0.y <= k0.lby + BODY_RADIUS + 1e-9)) {
          // the double drove his DL past the LB before he took a climb step: he cannot be held to the level
          // he already started past; he must not climb any further
          t.diagnostic(`already past: ${front} ${personnel} ${playside} script ${script}: ${sp.climber}>${sp.lbId} tick ${k0.i}, start margin ${(k0.y - (k0.lby + BODY_RADIUS)).toFixed(3)} yd`);
          const up = sp.ticks.find((k) => !(k.y <= k0.y + 1e-9));
          n += sp.ticks.length;
          if (up) {
            bad.push(`${front} ${personnel} ${playside} script ${script}: ${sp.climber} started past ${sp.lbId} at tick ${k0.i} (y ${k0.y.toFixed(3)}) and climbed further at tick ${up.i}: y ${up.y.toFixed(3)}`);
          }
          continue;
        }
        let first = null;
        let past = 0;
        for (const k of sp.ticks) {
          n++;
          worst = Math.max(worst, k.y - (k.lby + BODY_RADIUS));
          if (!(k.y <= k.lby + BODY_RADIUS + 1e-9)) {
            past++;
            first ??= k;
          }
        }
        if (first) {
          bad.push(`${front} ${personnel} ${playside} script ${script}: ${sp.climber} past ${first.lb} at tick ${first.i} (${past} ticks): y ${first.y.toFixed(3)} > ${first.lby.toFixed(3)} + ${BODY_RADIUS}`);
        }
      }
    }
    t.diagnostic(`script ${script}: ${spans} spans, ${n} climb ticks, worst margin ${worst.toFixed(3)} yd`);
    assert.ok(spans > 0, `script ${script}: no climb spans`);
  }
  assert.equal(bad.length, 0, bad.join('\n'));
});
