// Accel stalls seen with `accel: true` (F-25), absent with accel off. Both tests are
// `todo` until T-73 fixes them. Mechanisms, confirmed by instrumenting steerStep:
//
// Shared ratchet. play.step (src/dots/play.js ~line 198) sets p.v to the distance
// actually moved this substep (after the slide projection, ray-cast clamp and
// separateBodies push-back), and steerStep (src/dots/steering.js line 40) caps the
// next step by a ramp that starts from that p.v. So any substep that moves a
// fraction eta < 1 of its cap lowers the next cap, and the ramp only adds
// about (1 - exp(-dt / ACCEL_TAU)) * (p.speed - v) per substep (~0.17 yd/s at 60 Hz).
// The fixed point is v* = eta * a / (1 - eta * (1 - a)): with eta ~ 0.2 that is
// ~0.04 yd/s. Without accel the cap is the constant top-speed step, so a blocked
// mover still makes the same fraction of a large step and squeezes through.
//
// (A) RB crawling in the hole. Entering the RB's lane [RDE, RDT] (steerStep lane
// branch, lines ~99-115), the hard-core ray clamp (lines ~152-168) and slide
// projection (lines ~140-150) cut his step against the two bodies, and the
// separateBodies push in the same substep undoes more of it; the lower measured
// p.v shrinks the ramp cap (line 40) for the next substep (v drops 7.2 -> 0.2 in
// 3 substeps). The stuck release (line 177) compares progress with the already
// ramp-capped maxStep, so a mover crawling at his own tiny cap makes ~cap of
// progress, never < 0.25 * cap, and stuck never accumulates until it drifts down
// to 0.3 s at ~3.7 s.
//
// (B) MLB wedged short of the QB. Same ratchet, but the loss is in the slide
// projection alone (steerStep lines ~140-150), not separation push-back (measuring
// p.v from the steer step only does not help). Pressed into LDT (distance ~0.52)
// and C (~0.70) with the goal straight at the QB, the two contact normals
// project away ~80% of the step: cap 0.0036 yd, post-slide step 0.0007 yd
// (eta ~ 0.2), v ~ 0.04. Flips are already spent (MAX_FLIPS, line 22), and the
// stuck test (line 177) is again judged against the ramp-capped maxStep with a
// two-step progress average that alternates, so it cycles 0..0.27 s and never fires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { GAP_DEPTH } from '../src/dots/carrier.js';
import { CONTACT_DIST } from '../src/dots/blocking.js';

const DT = 1 / 60;

// Longest run, in seconds, of consecutive substeps where the sampled condition held.
// samples: array of booleans, one per DT substep.
function stallTime(samples) {
  let best = 0, run = 0;
  for (const s of samples) {
    run = s ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best * DT;
}

test('F-25 #3: RB does not crawl in the hole with accel on', { todo: 'accel stall, fixed by T-73' }, () => {
  const play = createPlay(25, 'insideZone', { accel: true });
  play.snap();
  const rb = play.player(play.run.carrier);
  const slow = [];
  let crossed = null;
  for (let i = 1; i <= 600 && crossed === null; i++) {
    play.step(DT);
    if (play.ball.phase === 'carried') slow.push(rb.v < 1);
    if (rb.y >= 25 + GAP_DEPTH) crossed = i * DT;
  }
  const stall = stallTime(slow);
  assert.ok(stall <= 0.5, `RB crawled (v < 1) for ${stall.toFixed(2)}s`);
  assert.ok(crossed !== null && crossed <= 2.5, `RB reached y >= ${25 + GAP_DEPTH} at ${crossed}s (want <= 2.5)`);
});

test('F-25 #4: MLB and WLB reach the QB without wedging with accel on', { todo: 'accel stall, fixed by T-73' }, () => {
  const play = createPlay(25, 'base', { accel: true });
  play.snap();
  play.retargetRule = null;
  const qb = play.player('QB');
  const ids = ['MLB', 'WLB'];
  const samples = { MLB: [], WLB: [] };
  const dist = (p) => Math.hypot(p.x - qb.x, p.y - qb.y);
  for (let i = 0; i < 300; i++) {
    play.step(DT);
    for (const id of ids) {
      const p = play.player(id);
      samples[id].push(p.v < 1 && p.react === null && dist(p) > CONTACT_DIST + 0.05);
    }
  }
  for (const id of ids) {
    const stall = stallTime(samples[id]);
    assert.ok(stall <= 0.5, `${id} stalled for ${stall.toFixed(2)}s`);
    assert.ok(dist(play.player(id)) <= CONTACT_DIST + 0.05, `${id} at ${dist(play.player(id)).toFixed(2)} from QB at 5s`);
  }
});
