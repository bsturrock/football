// Accel stalls seen with `accel: true` (F-25), absent with accel off. Fixed by T-73.
//
// Mechanisms (instrumented by T-72):
//  - Shared ratchet. play.step set p.v to the distance moved in the substep, and
//    steerStep capped the next step by a ramp from that p.v. A substep clipped by
//    contact (slide projection, ray clamp, separateBodies push-back) therefore
//    lowered the next cap, converging on ~0.04 yd/s (A: RB in the RDE/RDT lane,
//    B: MLB wedged between LDT and C with retargetRule = null).
//  - Stuck release judged progress against the ramp-capped maxStep, so a mover
//    crawling at his own tiny cap never counted as stuck.
//
// Fix. (1) steerStep judges stuck progress against the caller's uncapped maxStep.
// (2) play.step gives p.v inertia: measured speed may fall no faster than
// exp(-dt / ACCEL_TAU) per substep (the ramp's own time constant), so a clipped
// substep no longer collapses the cap. Measured: RB crosses y >= 25 + GAP_DEPTH
// at about 1.7 s; MLB and WLB reach the QB within CONTACT_DIST + 0.05.
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

test('F-25 #3: RB does not crawl in the hole with accel on', () => {
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

test('F-25 #4: MLB and WLB reach the QB without wedging with accel on', () => {
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
