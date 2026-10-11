import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { LB_ROLES } from '../src/dots/roster.js';
import { RIDE_MIN } from '../src/dots/technique.js';
import { IMPACT_TIME } from '../src/dots/blocking.js';

// F-49 #7: both bodies keep their momentum through a block. A climbing OL meets a moving linebacker;
// neither velocity jumps, the blocker rides the side opposite the LB's lateral travel, his push turns
// with the LB, the block holds, and nothing wobbles (PRINCIPLES #11).
// Velocity rule (7a): 1.75 yd/s per tick inside the IMPACT_TIME window after the engage, 1.5 elsewhere.
// Lateral rule (7b): a blocker within 0.05 yd of the LB's x is head-up, not crossed.
const FRONTS = ['base', 'odd34', 'over43'];
const MAX_JUMP = 1.5; // yd/s per tick
const HIT_JUMP = 1.75; // yd/s per tick inside the IMPACT_TIME window after the engage (F-49 #7a)
const HEAD_UP = 0.05; // yd; a blocker this close to the LB's x is head-up, not crossed (F-49 #7b)
const WOBBLE_AMP = 1.0; // degrees; a swing back smaller than this from the last extreme is not a reversal (F-55)
const MAX_REVERSALS = 1;
const WINDOW_BEFORE = 3;
const WINDOW_AFTER = 30;
const LB_MIN_SPEED = 2; // yd/s over the tick before the engage

// tackles and fightBlocks are off so neither a tackle (the whistle cuts the window short once the climb comes
// later, after a real double team) nor a legitimate shed (the LB beating the block) ends the block inside the
// window: the test judges the block's momentum, not when the climb happens or how long the play lives.
function record(front) {
  const play = createPlay(25, 'insideZone', { front, tackles: false, fightBlocks: false });
  assert.ok(play.snap());
  const ticks = [];
  const grab = () => ({
    phase: play.ball.phase,
    pos: Object.fromEntries(play.players.map((p) => [p.id, { x: p.x, y: p.y }])),
    block: Object.fromEntries(play.players.filter((p) => p.block).map((p) => [p.id, {
      engaged: p.block.engaged,
      target: p.block.target,
      push: p.block.foot?.push ? { x: p.block.foot.push.x, y: p.block.foot.push.y } : null,
    }])),
  });
  ticks.push(grab());
  const role = Object.fromEntries(play.players.map((p) => [p.id, p.role]));
  for (let i = 0; i < Math.ceil(6 / FIXED_DT); i++) {
    play.step(FIXED_DT);
    ticks.push(grab());
    if (play.ball.phase === 'dead') break;
  }
  const vel = (id, i) => {
    if (i < 1) return { x: 0, y: 0 };
    return {
      x: (ticks[i].pos[id].x - ticks[i - 1].pos[id].x) / FIXED_DT,
      y: (ticks[i].pos[id].y - ticks[i - 1].pos[id].y) / FIXED_DT,
    };
  };
  let hit = null;
  for (let i = 2; i < ticks.length && !hit && i * FIXED_DT <= 2.5 + 1; i++) {
    for (const [id, b] of Object.entries(ticks[i].block)) {
      const was = ticks[i - 1].block[id];
      if (!b.engaged || (was && was.engaged)) continue;
      if (!LB_ROLES.includes(role[b.target])) continue;
      const v = vel(b.target, i - 1);
      if (Math.hypot(v.x, v.y) < LB_MIN_SPEED) continue;
      hit = { i, blocker: id, lb: b.target };
      break;
    }
  }
  if (!hit) return { ticks, vel, hit };
  const lo = Math.max(1, hit.i - WINDOW_BEFORE);
  let hi = Math.min(ticks.length - 1, hit.i + WINDOW_AFTER);
  const dead = ticks.findIndex((t) => t.phase === 'dead');
  if (dead !== -1 && dead <= hi) hi = dead - 1;
  return { ticks, vel, hit, lo, hi };
}

const deg = (r) => (r * 180) / Math.PI;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Direction reversals in a series of angles: a reversal counts only when the angle has swung back by at least
// WOBBLE_AMP degrees from the last extreme in the current direction (a visible swing, F-55). Per-tick twitches and
// a small swing back are not reversals.
function reversals(angles) {
  let dir = 0;
  let ext = angles[0];
  let n = 0;
  for (let i = 1; i < angles.length; i++) {
    const a = angles[i];
    const d = deg(wrap(a - ext));
    if (dir === 0) {
      if (Math.abs(d) >= WOBBLE_AMP) { dir = Math.sign(d); ext = a; }
    } else if (Math.sign(d) === dir || d === 0) {
      ext = a;
    } else if (Math.abs(d) >= WOBBLE_AMP) {
      n++;
      dir = -dir;
      ext = a;
    }
  }
  return n;
}

for (const front of FRONTS) {
  const r = record(front);
  const win = () => {
    assert.ok(r.hit, `${front}: an OL engages a moving LB within 2.5 s`);
    assert.ok(r.hi - r.lo >= 10, `${front}: the window has ticks (${r.lo}..${r.hi})`);
    const idx = [];
    for (let i = r.lo; i <= r.hi; i++) idx.push(i);
    return idx;
  };

  test(`F-49 #7 ${front}: neither body's velocity jumps in one tick through the block`, () => {
    const impactTicks = Math.ceil(IMPACT_TIME / FIXED_DT);
    for (const i of win().slice(1)) { // changes between ticks inside the window
      const limit = r.hit.i <= i && i <= r.hit.i + impactTicks ? HIT_JUMP : MAX_JUMP;
      for (const id of [r.hit.blocker, r.hit.lb]) {
        const a = r.vel(id, i - 1);
        const b = r.vel(id, i);
        const dv = Math.hypot(b.x - a.x, b.y - a.y);
        assert.ok(dv <= limit, `${front} ${id} tick ${i}: velocity change ${dv.toFixed(2)} yd/s (limit ${limit})`);
      }
    }
  });

  test(`F-49 #7 ${front}: the blocker stays on the side opposite the LB's lateral travel`, () => {
    for (const i of win()) {
      const v = r.vel(r.hit.lb, i);
      if (Math.abs(v.x) < RIDE_MIN) continue;
      const dx = r.ticks[i].pos[r.hit.blocker].x - r.ticks[i].pos[r.hit.lb].x;
      if (Math.abs(dx) < HEAD_UP) continue; // head-up, not crossed
      assert.equal(Math.sign(dx), -Math.sign(v.x), `${front} tick ${i}: blocker dx ${dx.toFixed(2)}, LB vx ${v.x.toFixed(2)}`);
    }
  });

  test(`F-49 #7 ${front}: the blocker's push follows the LB's lateral travel and turns over the block`, () => {
    const angles = [];
    for (const i of win()) {
      const push = r.ticks[i].block[r.hit.blocker].push;
      if (!r.ticks[i].block[r.hit.blocker].engaged) continue; // no push before the engage
      assert.ok(push, `${front} tick ${i}: engaged blocker has a push`);
      angles.push(Math.atan2(push.x, push.y));
      const v = r.vel(r.hit.lb, i);
      if (Math.abs(v.x) < RIDE_MIN) continue;
      assert.equal(Math.sign(push.x), Math.sign(v.x), `${front} tick ${i}: push.x ${push.x.toFixed(2)}, LB vx ${v.x.toFixed(2)}`);
    }
    const spread = deg(Math.max(...angles) - Math.min(...angles));
    assert.ok(spread > 10, `${front}: push angle varies ${spread.toFixed(1)} degrees`);
  });

  test(`F-49 #7 ${front}: the block holds to the end of the window (no lost release)`, () => {
    win();
    const b = r.ticks[r.hi].block[r.hit.blocker];
    assert.ok(b.engaged && b.target === r.hit.lb, `${front}: ${r.hit.blocker} still engaged on ${r.hit.lb} at tick ${r.hi}`);
  });

  test(`F-49 #7 ${front}: no wobble in the push angle or the blocker's bearing around the LB`, () => {
    const idx = win();
    const push = idx.filter((i) => r.ticks[i].block[r.hit.blocker].engaged).map((i) => {
      const p = r.ticks[i].block[r.hit.blocker].push;
      return Math.atan2(p.x, p.y);
    });
    // Bearing is judged while engaged (like the push): the approach before the engage is not the block.
    const bearing = idx.filter((i) => r.ticks[i].block[r.hit.blocker].engaged).map((i) => {
      const b = r.ticks[i].pos[r.hit.blocker];
      const l = r.ticks[i].pos[r.hit.lb];
      return Math.atan2(b.x - l.x, b.y - l.y);
    });
    assert.ok(reversals(push) <= MAX_REVERSALS, `${front}: push angle reverses ${reversals(push)} times`);
    assert.ok(reversals(bearing) <= MAX_REVERSALS, `${front}: bearing reverses ${reversals(bearing)} times`);
  });
}
