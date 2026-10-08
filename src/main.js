import { runSim } from './sim.js';   // first: seeds Math.random under ?sim before other modules load
import { pairCheck, pairReport, setFrameClock, syncScene } from './animation.js';
import { separate } from './blocking.js';
import { updateCamera } from './camera.js';
import { cpuTick, setCam, setCpu } from './cpu.js';
import { defenseAI } from './defense.js';
import { drillCamera, drillError, drillStart, drillTick } from './drill.js';
import { debugTick, toast, updateCallouts, warn } from './hud.js';
import { aim, giveBall, ground, hit, inputVec, ndc, pitch, ray, resolvePass } from './input.js';
import { routeGroup } from './markers.js';
import { steer } from './movement.js';
import { offenseAI } from './offense.js';
import { pileUpdate } from './pile.js';
import { physBall, physCount, physDown, physInit, physPose, physSpeed, physRender, physStep } from './physics.js';
import { DEF_CALLS, PLAYS } from './playbook.js';
import { ALL, DEF, OFF, QB, RB } from './players.js';
import { heldBallPos, endPlay, newGame, nextPlay, trackProgress } from './rules.js';
import { camera, cvs, renderer, scene } from './scene.js';
import { S, ball, selectPlay, setupPlay } from './state.js';
import { tackleUpdate } from './tackling.js';
import { $, HW, clamp, dist } from './util.js';

// ---------- loop ----------
function liveUpdate(dt){
  S.clock += dt;
  if(S.charging) S.chargeT += dt;
  const inp = S.cpu ? {x:0, y:0, on:false} : inputVec();
  OFF.forEach(p => offenseAI(p, dt, inp));
  DEF.forEach(d => defenseAI(d, dt));
  separate();

  const run = PLAYS[S.play].run;
  if(PLAYS[S.play].delay && S.handoffAt === Infinity) S.runMode = false;   // B-007-12 Draw: a pass until the handoff (the line pass-sets, the defense rushes and drops)
  if(ball.state === 'pitch'){
    ball.t += dt/ball.pdur;
    if(ball.t >= 1){
      giveBall(ball.pt);
      if(run === 'toss' && ball.holder === QB) pitch(QB, RB, 0.35);
    }
  }
  else if(ball.state === 'air'){ ball.t += dt/ball.dur; if(ball.t >= 1){ resolvePass(); return; } }

  if(ball.state !== 'held') return;
  if(run === 'hand' && ball.holder === QB && S.clock >= (PLAYS[S.play].delay || 0) && dist(QB, RB) < (PLAYS[S.play].mesh ? 1.9 : 1.3)){ S.runMode = true; giveBall(RB); }   // under center the QB extends the ball into the back's pocket; B-007-12: a delayed handoff (Draw) waits for play.delay
  const c = ball.holder;
  if(c === QB && !S.runMode && QB.y > S.los + 0.3){ S.runMode = true; S.handoffAt = S.clock; S.charging = false; routeGroup.visible = false; toast('Scramble!'); }
  trackProgress(c);
  const bp = heldBallPos(c);   // a body runner scores and goes out by the ball, not his hips
  if(bp.y >= 100){ c.act = 'celebrate'; c.actT = 99; endPlay('td'); return; }
  if(Math.abs(bp.x) > HW){ endPlay('spot', bp.y, 'OUT OF BOUNDS'); return; }
  const k = Math.min(1, dt*6); c.svx += (c.vx - c.svx)*k; c.svy += (c.vy - c.svy)*k;   // smoothed for pursuit
  if(!(c === QB && run === 'hand')){
    tackleUpdate(c, dt);   // the exchange happens: nobody tackles the QB at the mesh
    if(S.phase === 'live'){ trackProgress(c); pileUpdate(c, dt); }   // progress again after the tackle (no first-frame spot lag), then the pile push and stall whistle
  }
}
const perf = {phys:0, bodies:0};   // last step's physics ms and body count (read by ?debug and the sim)
// one render-free simulation step (the sim runner calls this too)
export function step(dt){
  cpuTick(dt);
  if(S.phase === 'live') liveUpdate(dt);
  else if(S.phase === 'dead'){
    ALL.forEach(p => steer(p, p.x, p.y, 0, dt));
    S.deadT -= dt; if(S.deadT <= 0) nextPlay();
  }
  const t0 = performance.now();
  physStep(dt);
  perf.phys = performance.now() - t0; perf.bodies = physCount().players;
}
let last = performance.now(), tick = step, camStep = updateCamera;   // ?drill swaps both (src/drill.js)
function frame(now){
  const raw = now - last, dt = clamp(raw/1000, 0, 0.05); last = now;
  if(dt === 0){ requestAnimationFrame(frame); return; }
  ray.setFromCamera(ndc, camera);
  if(ray.ray.intersectPlane(ground, hit)){ aim.x = hit.x; aim.y = 50 - hit.z; }
  tick(dt);
  camStep(dt); syncScene(dt); physRender(); updateCallouts(dt);
  renderer.render(scene, camera);
  debugTick(raw, perf.phys, perf.bodies);
  requestAnimationFrame(frame);
}
// ---------- frame check (B-031) ----------
// ?drill=1v1|line&frames=N&sim=1&seed=S: steps the drill and the scene sync N frames of 1/60 s synchronously (no rendering, no rAF: headless Chrome barely runs rAF under
// virtual time), then writes one JSON line into <pre id="checkout">: animation.js pairReport (the overlap measures of the engaged pose; its header comment lists the fields).
// `sim=1` only seeds Math.random (sim.js seeds when ?sim is present; frames wins in start()), so the same seed gives the same line. N=3600 (one minute of play) wants alarm 90 or so.
// The fight wiggle runs on the frame index (setFrameClock) so the line repeats exactly. Without ?drill the line is {"error":"frames needs drill"}. A normal page load is unchanged.
function runFrames(n){
  for(let i = 0; i < n; i++){ setFrameClock(i*1000/60); tick(1/60); syncScene(1/60); pairCheck(); }
  setFrameClock(null);
  const show = () => { camStep(1/60); renderer.render(scene, camera); requestAnimationFrame(show); }; show();   // B-042 (axis-glide): the canvas shows the pose at frame N (a screenshot reads it); render only, the sim is untouched
  const el = document.createElement('pre'); el.id = 'checkout'; el.textContent = JSON.stringify(Object.assign({frames_run:n}, pairReport())); document.body.appendChild(el);
}
function start(data){
  $('cpuBtn').addEventListener('click', () => { setCpu(!S.cpu); cvs.focus(); });
  $('camBtn').addEventListener('click', () => { setCam(S.cam === 'tv' ? 'behind' : 'tv'); cvs.focus(); });
  setCam(S.cam);
  if(data && typeof data.score === 'number') Object.assign(S, {score:data.score, tds:data.tds||0, drive:data.drive||1, los:data.los||25, down:data.down||1, toGo:data.toGo||10});
  const q = new URLSearchParams(location.search);
  selectPlay(0); setupPlay();
  if(q.has('frames') && !q.has('drill')){ const el = document.createElement('pre'); el.id = 'checkout'; el.textContent = JSON.stringify({error:'frames needs drill'}); document.body.appendChild(el); return; }
  if(q.has('sim') && !q.has('frames')){ runSim(Math.max(1, Number(q.get('sim')) || 100), step, {physBall, physCount, physDown, physPose, physSpeed, perf, ALL, OFF, DEF, RB, PLAYS, DEF_CALLS, nextPlay, newGame, setupPlay, S, ball}); return; }   // headless: no frame loop
  if(q.has('drill')){ document.body.classList.add('drill'); tick = drillTick; camStep = drillCamera; drillStart();
    if(q.has('frames') && drillError){ const el = document.createElement('pre'); el.id = 'checkout'; el.textContent = JSON.stringify({error:drillError}); document.body.appendChild(el); return; }   // B-042 (axis-glide)
    if(q.has('frames')){ runFrames(Number(q.get('frames')) || 600); return; } }   // B-019: the blocking drill, no game flow
  requestAnimationFrame(frame);
}
try { window.claude?.hot?.snapshot?.(() => ({score:S.score, tds:S.tds, drive:S.drive, los:S.los, down:S.down, toGo:S.toGo})); } catch(e){}
const boot = () => window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
(window.CANNON ? Promise.resolve(window.CANNON) : import('https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js'))
  .then(m => { window.CANNON = m; physInit(); }, err => {
    console.error('physics failed to load', err);
    warn('Physics failed to load: no ragdolls');
  }).then(boot);
