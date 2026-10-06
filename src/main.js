import { syncScene } from './animation.js';
import { separate } from './blocking.js';
import { updateCamera } from './camera.js';
import { cpuTick, setCam, setCpu } from './cpu.js';
import { defenseAI } from './defense.js';
import { toast, updateCallouts, warn } from './hud.js';
import { aim, giveBall, ground, hit, inputVec, ndc, pitch, ray, resolvePass } from './input.js';
import { routeGroup } from './markers.js';
import { steer } from './movement.js';
import { offenseAI } from './offense.js';
import { physInit, physRender, physStep } from './physics.js';
import { PLAYS } from './playbook.js';
import { ALL, DEF, OFF, QB, RB } from './players.js';
import { endPlay, nextPlay } from './rules.js';
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
  if(ball.state === 'pitch'){
    ball.t += dt/ball.pdur;
    if(ball.t >= 1){
      giveBall(ball.pt);
      if(run === 'toss' && ball.holder === QB) pitch(QB, RB, 0.35);
    }
  }
  else if(ball.state === 'air'){ ball.t += dt/ball.dur; if(ball.t >= 1){ resolvePass(); return; } }

  if(ball.state !== 'held') return;
  if(run === 'hand' && ball.holder === QB && dist(QB, RB) < (PLAYS[S.play].mesh ? 1.9 : 1.3)) giveBall(RB);   // under center the QB extends the ball into the back's pocket
  const c = ball.holder;
  if(c === QB && !S.runMode && QB.y > S.los + 0.3){ S.runMode = true; S.handoffAt = S.clock; S.charging = false; routeGroup.visible = false; toast('Scramble!'); }
  if(c.y >= 100){ c.act = 'celebrate'; c.actT = 99; endPlay('td'); return; }
  if(Math.abs(c.x) > HW){ endPlay('spot', c.y, 'OUT OF BOUNDS'); return; }
  const k = Math.min(1, dt*6); c.svx += (c.vx - c.svx)*k; c.svy += (c.vy - c.svy)*k;   // smoothed for pursuit
  if(!(c === QB && run === 'hand')) tackleUpdate(c, dt);   // the exchange happens: nobody tackles the QB at the mesh
}
let last = performance.now();
function frame(now){
  const dt = clamp((now - last)/1000, 0, 0.05); last = now;
  if(dt === 0){ requestAnimationFrame(frame); return; }
  ray.setFromCamera(ndc, camera);
  if(ray.ray.intersectPlane(ground, hit)){ aim.x = hit.x; aim.y = 50 - hit.z; }
  cpuTick(dt);
  if(S.phase === 'live') liveUpdate(dt);
  else if(S.phase === 'dead'){
    ALL.forEach(p => steer(p, p.x, p.y, 0, dt));
    S.deadT -= dt; if(S.deadT <= 0) nextPlay();
  }
  physStep(dt);
  updateCamera(dt); syncScene(dt); physRender(); updateCallouts(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function start(data){
  $('cpuBtn').addEventListener('click', () => { setCpu(!S.cpu); cvs.focus(); });
  $('camBtn').addEventListener('click', () => { setCam(S.cam === 'tv' ? 'behind' : 'tv'); cvs.focus(); });
  setCam(S.cam);
  if(data && typeof data.score === 'number') Object.assign(S, {score:data.score, tds:data.tds||0, drive:data.drive||1, los:data.los||25, down:data.down||1, toGo:data.toGo||10});
  selectPlay(0); setupPlay(); requestAnimationFrame(frame);
}
try { window.claude?.hot?.snapshot?.(() => ({score:S.score, tds:S.tds, drive:S.drive, los:S.los, down:S.down, toGo:S.toGo})); } catch(e){}
const boot = () => window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
(window.CANNON ? Promise.resolve(window.CANNON) : import('https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js'))
  .then(m => { window.CANNON = m; physInit(); }, err => {
    console.error('physics failed to load', err);
    warn('Physics failed to load: no ragdolls');
  }).then(boot);
