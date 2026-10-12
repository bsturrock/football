import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { steerStep } from '../src/dots/steering.js';
import { separateBodies, BODY_RADIUS } from '../src/dots/blocking.js';

// F-55 #9 (PRINCIPLES #11): a body passing between two engaged bodies keeps his lateral momentum. His
// velocity never changes by more than 1.5 yd/s in one tick, whether the change comes from his own step
// or from a contact push-out.
// Measured (T-44): on the RG repro the jumps carried no push-out at all (the separation pass moved him
// 0 yd). Each came from steerStep: the plain-hit detour around the touching DT switches on and off as
// the DT's lateral offset crosses the corridor edge, and each switch swung the step by 2-4 yd/s.
const MAX_JUMP = 1.5; // yd/s per tick
const SPAN = 2.0; // seconds

test('F-55 #9: RG climbing between two engaged DTs never jumps lateral velocity by more than 1.5 yd/s a tick', () => {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front: 'under43', personnel: 'te', playside: 'left' });
  assert.ok(play.snap());
  const rg = play.player('RG');
  const first = rg.block.target;
  let climbing = false;
  let prev = null;
  let checked = 0;
  for (let i = 0; i < Math.round(SPAN / FIXED_DT); i++) {
    play.step(FIXED_DT);
    if (!climbing && rg.block && rg.block.target !== first) climbing = true;
    if (climbing && rg.block?.engaged) break;
    if (climbing && prev) {
      const touched = play.players
        .filter((o) => o !== rg && Math.hypot(o.x - rg.x, o.y - rg.y) < 1)
        .map((o) => `${o.id}${o.block?.engaged ? '(engaged)' : ''}`);
      const dv = Math.abs(rg.vel.x - prev.x);
      assert.ok(dv <= MAX_JUMP + 1e-9, `tick ${play.ticks}: RG vel.x ${prev.x.toFixed(2)} -> ${rg.vel.x.toFixed(2)} (jump ${dv.toFixed(2)}), near ${touched.join(', ')}`);
      checked++;
    }
    if (climbing) prev = { x: rg.vel.x, y: rg.vel.y };
  }
  assert.ok(checked > 20, `RG climbed for ${checked} ticks`);
});

test('F-55 #9: a mover with accel squeezing up a gap between two anchored bodies changes lateral velocity <= 1.5 yd/s a tick and gets through', () => {
  const dt = FIXED_DT;
  // two engaged pairs, one each side, leave a gap between the nearest bodies narrower than 2 * BODY_RADIUS
  // + H, so the mover is in the soft zone of both while he passes
  const mk = (id, x, y, extra = {}) => ({ id, x, y, ...extra });
  const l = mk('L', -0.5, 0, { block: { engaged: true, target: 'LT' } });
  const lt = mk('LT', -0.5, -0.6, { block: null });
  const r = mk('R', 0.5, 0, { block: { engaged: true, target: 'RT' } });
  const rt = mk('RT', 0.5, -0.6, { block: null });
  const p = mk('P', 0.06, -3, { v: 0, speed: 6 });
  const players = [l, lt, r, rt, p];
  const goal = { x: 0.06, y: 6, key: 'up', ignore: null };
  let vx = 0;
  let worst = 0;
  for (let i = 0; i < 240 && p.y < 3; i++) {
    const x0 = p.x, y0 = p.y;
    steerStep(p, { ...goal }, players, 6 * dt, dt, BODY_RADIUS);
    separateBodies(players, dt);
    p.vel = { x: (p.x - x0) / dt, y: (p.y - y0) / dt };
    p.v = Math.min(p.speed, Math.hypot(p.vel.x, p.vel.y));
    const dv = Math.abs(p.vel.x - vx);
    worst = Math.max(worst, dv);
    assert.ok(dv <= MAX_JUMP + 1e-9, `tick ${i}: vel.x ${vx.toFixed(2)} -> ${p.vel.x.toFixed(2)} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}), touching ${players.filter((o) => o !== p && Math.hypot(o.x - p.x, o.y - p.y) < 0.6).map((o) => o.id).join(', ')}`);
    vx = p.vel.x;
  }
  assert.ok(p.y >= 3, `got through the gap (y ${p.y.toFixed(2)}, worst jump ${worst.toFixed(2)})`);
});
