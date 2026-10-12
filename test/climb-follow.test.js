import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { steerStep, MAX_AVOID_DV, MAX_FLIPS } from '../src/dots/steering.js';

// T-59: an offensive lineman climbing to a linebacker who comes downhill or turns to pursue moves on a
// smooth path. Same span and reversal rule as test/zone-play.test.js 'F-55 #6d: a climber's path does
// not wobble' and the 'F-55 #9' lateral jump bound (test/squeeze-momentum.test.js).
const DT = 1 / 60;
const MAX_JUMP = 1.5; // yd/s per tick (F-55 #9)
const DEAD = 0.3; // yd/s: |vel.x| at or under this is no direction (F-55 #6d)
const SCRIPTS_RUN = [undefined, 'lbFills', 'lbFillsLate', 'lbBlitz'];

// Climb spans: per combo member that retargets off the combo's DL, from the climb tick until he engages, his target changes or the window ends.
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
          const sp = { key, climber: id, front, personnel, playside, script, lbId: m.block.target, ticks: [] };
          open.set(key, sp);
          spans.push(sp);
        }
        const sp = open.get(key);
        if (!sp) continue;
        if (m.block?.engaged || m.block?.target == null || m.block.target !== sp.lbId) { open.delete(key); continue; }
        const lb = play.player(sp.lbId);
        sp.ticks.push({ i, y: m.y, vx: m.vel.x, lb: lb.id, lby: lb.y });
      }
    }
  }
  return spans;
}
const climbCases = () => {
  const out = [];
  for (const script of SCRIPTS_RUN) for (const front of Object.keys(FRONTS)) for (const personnel of ['noTe', 'te']) for (const playside of ['left', 'right']) out.push([front, personnel, playside, script]);
  return out;
};

const judgeSpan = (sp) => {
  let sign = 0, flips = 0, maxdvx = 0, at = null, prev = null;
  for (const k of sp.ticks) {
    if (prev !== null) {
      const dv = Math.abs(k.vx - prev.vx);
      if (dv > maxdvx) { maxdvx = dv; at = k.i; }
    }
    prev = k;
    if (Math.abs(k.vx) <= DEAD) continue;
    const s = Math.sign(k.vx);
    if (sign !== 0 && s !== sign) flips++;
    sign = s;
  }
  return { flips, maxdvx, at };
};

test('T-59: climbers follow a downhill or pursuing LB smoothly', (t) => {
  let spans = 0;
  const bad = [];
  for (const [front, personnel, playside, script] of climbCases()) {
    for (const sp of climbSpans(front, personnel, playside, script)) {
      spans++;
      const { flips, maxdvx, at } = judgeSpan(sp);
      const name = `${front} ${personnel} ${playside} ${script ?? 'none'} ${sp.climber} -> ${sp.lbId}`;
      t.diagnostic(`${name}: ${sp.ticks.length} ticks, ${flips} x-reversals, max |dvx| ${maxdvx.toFixed(2)}`);
      if (flips > 1 || maxdvx > MAX_JUMP + 1e-9) bad.push(`${name}: vel.x reversed ${flips} times, max |dvx| ${maxdvx.toFixed(2)} at tick ${at}`);
    }
  }
  assert.ok(spans > 0);
  assert.equal(bad.length, 0, bad.join('\n'));
});

test('T-59: a mover coming off a detour at speed changes velocity by at most MAX_AVOID_DV a step while a body was in play', () => {
  // Mechanism (3): a held pass side sends the plain-hit detour back against the goal (a body level with
  // him on the far side, as T-12 pins for a goal without `forward`); the cap brakes his run upfield to
  // under MAX_AVOID_DV, and the next steered step used to snap freely to the backward tangent.
  // Mechanism (4): once round, the body leaves the wider corridor (release A: side and lane drop, no hit)
  // and the plain goal step used to swing him at once from his sideways slide to the goal.
  const dt = FIXED_DT;
  const body = { id: 'o', x: -0.51, y: 0.09 };
  const p = { id: 'p', x: 0, y: 0, vel: { x: 0, y: 3 }, steer: { key: 'k', side: 1, stuck: 0, flips: MAX_FLIPS, lane: null } };
  const goal = { x: 0, y: 10, key: 'k', ignore: null };
  let inPlay = true, checked = 0, released = 0, backward = 0;
  for (let i = 0; i < 60; i++) {
    const v0 = { ...p.vel };
    const x0 = p.x, y0 = p.y;
    steerStep(p, goal, [p, body], 6 * dt, dt, BODY_RADIUS);
    p.vel = { x: (p.x - x0) / dt, y: (p.y - y0) / dt };
    if (p.vel.y < -MAX_AVOID_DV) backward++;
    if (inPlay) {
      const dv = Math.hypot(p.vel.x - v0.x, p.vel.y - v0.y);
      assert.ok(dv <= MAX_AVOID_DV + 1e-9, `step ${i}: vel (${v0.x.toFixed(2)}, ${v0.y.toFixed(2)}) -> (${p.vel.x.toFixed(2)}, ${p.vel.y.toFixed(2)}) dv ${dv.toFixed(3)} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) steer ${JSON.stringify({ side: p.steer?.side, lane: p.steer?.lane })}`);
      checked++;
      if (p.steer && p.steer.side === 0) released++;
    }
    // a body was in play on this step: he holds a pass side or a lane
    inPlay = !!(p.steer && (p.steer.side !== 0 || p.steer.lane));
  }
  assert.ok(backward > 0, 'the held side sent him back against the goal (the rig reaches mechanism 3)');
  assert.ok(checked > 25 && released > 0, `checked ${checked} steps with a body in play, ${released} at the release`);
});
