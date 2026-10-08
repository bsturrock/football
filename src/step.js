import { faceStep } from './movement.js';
import { physCount, physStep } from './physics.js';
import { ALL } from './players.js';
import { S, ball } from './state.js';

// ---------- the shared simulation step (B-076) ----------
// One render-free step for the game (main.js step; the sim runner calls it too) and the blocking drill (drill.js drillTick). stepWith(dt, update) runs:
//   1. update(dt), the MODE HOOK: only what differs by mode (game: cpuTick and the live/dead phase flow; drill: the rep's presnap/live flow with its few drilled men)
//   2. everything every mode does each step, here once: faceStep per player (B-072-1: facing is sim state, movement.js), then physStep timed into perf
// A new per-step call that every mode needs goes into stepWith; one only a mode needs goes into that mode's update.
export const perf = {phys:0, bodies:0};   // last step's physics ms and body count (read by ?debug and the sim)
export function stepWith(dt, update){
  update(dt);
  ALL.forEach(p => faceStep(p, dt, ball, S));
  const t0 = performance.now();
  physStep(dt);
  perf.phys = performance.now() - t0; perf.bodies = physCount().players;
}
