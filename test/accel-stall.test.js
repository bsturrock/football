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
// F-25 #3 (T-163) judges measured net displacement on every front; the 2.4 s crossing cap was dropped because it
// measured which way a pile breaks (outcome), not crawling.
//
// Fix. (1) steerStep judges stuck progress against the caller's uncapped maxStep.
// (2) play.step gives p.v inertia: measured speed may fall no faster than
// exp(-dt / ACCEL_TAU) per substep (the ramp's own time constant), so a clipped
// substep no longer collapses the cap. Measured (F-40 read, no-TE look): RB crosses y >= 25 + GAP_DEPTH
// at 1.92 s; MLB and WLB reach the QB (or crowd up behind a defender who has) within CONTACT_DIST + 0.05.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { GAP_DEPTH } from '../src/dots/carrier.js';
import { CONTACT_DIST, engagedOn } from '../src/dots/blocking.js';
import { FRONTS } from '../src/dots/roster.js';

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
  // Tackles off so a tackle before the hole cannot hide a crawl. Every front, both personnel.
  // Net speed is displacement over 6 substeps (0.1 s), so back-and-forth jitter reads as slow.
  // Window: committed and carried, ending at the hole (y >= los + GAP_DEPTH) or when a free defender is
  // within contact (an unblocked defender is a tackle in the real game, not a crawl).
  for (const front of Object.keys(FRONTS)) {
    for (const personnel of ['noTe', 'te']) {
      const tag = `front ${front}, personnel ${personnel}`;
      const play = createPlay(25, 'insideZone', { accel: true, tackles: false, personnel, front });
      play.snap();
      const rb = play.player(play.run.carrier);
      const hist = [];
      const slow = [];
      let peak = 0;
      let ended = false;
      for (let i = 1; i <= 600 && !ended; i++) {
        play.step(DT);
        hist.push({ x: rb.x, y: rb.y });
        if (play.ball.phase === 'carried' && play.run.locked && hist.length > 6) {
          const o = hist[hist.length - 7];
          const v = Math.hypot(rb.x - o.x, rb.y - o.y) / (6 * DT);
          slow.push(v < 1);
          if (v > peak) peak = v;
        }
        const met = play.players.some((d) => d.team === 'defense'
          && engagedOn(play.players, d.id).length === 0
          && Math.hypot(d.x - rb.x, d.y - rb.y) <= CONTACT_DIST + 0.05);
        if (rb.y >= 25 + GAP_DEPTH || met) ended = true;
      }
      assert.ok(ended, `${tag}: window did not end within 600 ticks`);
      const stall = stallTime(slow);
      assert.ok(stall <= 0.2, `${tag}: RB net speed < 1 yd/s for ${stall.toFixed(2)}s (want <= 0.2)`);
      assert.ok(peak >= 0.85 * rb.speed, `${tag}: peak net speed ${peak.toFixed(2)} < ${(0.85 * rb.speed).toFixed(2)}`);
    }
  }
});

test('F-25 #4: MLB and WLB reach the QB without wedging with accel on', () => {
  const play = createPlay(25, 'base', { accel: true });
  play.snap();
  play.retargetRule = null;
  const qb = play.player('QB');
  const ids = ['MLB', 'WLB'];
  const samples = { MLB: [], WLB: [] };
  const dist = (p) => Math.hypot(p.x - qb.x, p.y - qb.y);
  // Arrived: within contact of the QB, or of another defender who is (crowding at the QB).
  const arrived = (p) => {
    const seen = new Set([p.id]);
    const queue = [p];
    while (queue.length) {
      const q = queue.pop();
      if (dist(q) <= CONTACT_DIST + 0.05) return true;
      for (const o of play.players) {
        if (o.team !== 'defense' || seen.has(o.id)) continue;
        if (Math.hypot(o.x - q.x, o.y - q.y) <= CONTACT_DIST + 0.05) {
          seen.add(o.id);
          queue.push(o);
        }
      }
    }
    return false;
  };
  for (let i = 0; i < 300; i++) {
    play.step(DT);
    for (const id of ids) {
      const p = play.player(id);
      samples[id].push(p.v < 1 && p.react === null && !arrived(p));
    }
  }
  for (const id of ids) {
    const stall = stallTime(samples[id]);
    assert.ok(stall <= 0.5, `${id} stalled for ${stall.toFixed(2)}s`);
    assert.ok(arrived(play.player(id)), `${id} at ${dist(play.player(id)).toFixed(2)} from QB at 5s`);
  }
});
