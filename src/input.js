import { setCam, setCpu } from './cpu.js';
import { toast } from './hud.js';
import { blockGroup, routeGroup } from './markers.js';
import { resolveBlocks } from './blockrules.js';
import { PLAYS } from './playbook.js';
import { BODY_W, C, DEF, DL, EXTRA, LG, LT, OL, QB, RB, RECV, RG, RT, TE } from './players.js';
import { endPlay, newGame } from './rules.js';
import { cvs } from './scene.js';
import { S, ball, selectPlay } from './state.js';
import { dist } from './util.js';

// ---------- input ----------
export const keys = new Set();
const MOVE_KEYS = ['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' '];
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if(MOVE_KEYS.includes(k)) e.preventDefault();
  keys.add(k);
  if(k === 'c' && !S.drill) setCpu(!S.cpu);   // drill (B-019): the drill owns the snap and the CPU flag
  if(k === 'v') setCam(S.cam === 'tv' ? 'behind' : 'tv');
  if(S.phase === 'presnap' && !S.cpu && k >= '1' && k <= String(PLAYS.length)) selectPlay(+k - 1);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
export function inputVec(){
  let x = 0, y = 0;
  if(keys.has('w') || keys.has('arrowup')) y++;
  if(keys.has('s') || keys.has('arrowdown')) y--;
  if(keys.has('a') || keys.has('arrowleft')) x--;
  if(keys.has('d') || keys.has('arrowright')) x++;
  const l = Math.hypot(x, y);
  return l ? {x:x/l, y:y/l, on:true} : {x:0, y:0, on:false};
}
export const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(0, 0), ground = new THREE.Plane(new THREE.Vector3(0,1,0), 0), hit = new THREE.Vector3();
export const aim = {x:0, y:50};
cvs.addEventListener('pointermove', e => {
  const r = cvs.getBoundingClientRect();
  ndc.set(((e.clientX - r.left)/r.width)*2 - 1, -((e.clientY - r.top)/r.height)*2 + 1);
});
cvs.addEventListener('contextmenu', e => e.preventDefault());
cvs.addEventListener('pointerdown', e => {
  cvs.focus();
  if(e.button !== 0) return;
  if(S.drill) return;   // drill (B-019): no click-to-snap or new game
  if(S.phase === 'over'){ newGame(); return; }
  if(S.cpu) return;
  if(S.phase === 'presnap'){ snap(); return; }
  if(canThrow()){ S.charging = true; S.chargeT = 0; }
});
addEventListener('pointerup', () => { if(S.charging) throwBall(); });
export const canThrow = () => S.phase === 'live' && ball.state === 'held' && ball.holder === QB && !S.runMode;
export const charge = () => Math.min(1, S.chargeT/0.9);
export function snap(){
  const run = PLAYS[S.play].run;
  S.phase = 'live'; S.clock = 0; S.runMode = !!run; S.runSeen = !!run && !PLAYS[S.play].delay;   // B-097: the line fires out at the snap on a run; a delayed run (Draw) shows a pass set until the handoff
  // linemen fire out on the snap; the defensive line reacts to the ball a beat later (better awareness, quicker)
  [...OL, TE, ...EXTRA.filter(e => e.pos === 'TE')].forEach(o => o.fire = 0.35);
  DL.forEach(d => { d.fire = 0.35; d.fireDelay = 0.15 - d.rAwr/1000; });
  S.ctrl = run ? RB : QB;
  pitch(C, QB, PLAYS[S.play].under ? 0.15 : 0.3);   // under center: hand-to-hand snap
  blockGroup.visible = false;
  if(run){
    const play = PLAYS[S.play];
    if(play.scheme === 'zone') [...OL, TE].forEach(o => { o.lane = o.x + play.shift; });
    resolveBlocks(play, S.flip);   // every blocker's target, read against the front (blockrules.js); a receiver slot empty in this personnel has no blocker
    for(const [o, pts] of Object.entries(play.pulls || {})) if(!({LT, LG, C, RG, RT, TE})[o].via) ({LT, LG, C, RG, RT, TE})[o].via = pts.map(([x, dy]) => ({x, y:S.los + dy}));
  }
}
// short ball transfer between two players (snap, toss)
export function pitch(from, to, dur){ Object.assign(ball, {state:'pitch', pf:from, pt:to, t:0, pdur:dur, holder:null}); }
export function giveBall(p){
  ball.state = 'held'; ball.holder = p;
  if(p === RB && S.runMode){ RB.auto = true; S.handoffAt = S.clock; S.runSeen = true; resolveBlocks(PLAYS[S.play], S.flip, true); }   // the blockers read the defense once more after the exchange
}
export function throwArc(c, d){ return {speed: 30 - c*13, apex: 0.6 + c*5 + d*0.04}; }
export function throwTarget(){
  let tx = aim.x, ty = aim.y; const dx = tx - QB.x, dy = ty - QB.y, d = Math.hypot(dx, dy);
  if(d > 60){ tx = QB.x + dx/d*60; ty = QB.y + dy/d*60; }
  return {tx, ty, d:Math.min(d, 60)};
}
function throwBall(){
  S.charging = false;
  if(!canThrow()) return;
  const c = charge(), {tx, ty, d} = throwTarget(), arc = throwArc(c, d);
  Object.assign(ball, {state:'air', holder:null, fx:QB.x, fy:QB.y, tx, ty, t:0,
    dur:Math.max(0.3, d/arc.speed), apex:arc.apex, thrownAt:S.clock});
  ball.target = RECV.reduce((a, b) => dist(b, {x:tx, y:ty}) < dist(a, {x:tx, y:ty}) ? b : a);
  S.ctrl = ball.target; routeGroup.visible = false;
  QB.act = 'throw'; QB.actT = 0.35;
}
export function ballPos(t){
  return {x: ball.fx + (ball.tx - ball.fx)*t, y: ball.fy + (ball.ty - ball.fy)*t,
          h: 2.0 + (1.4 - 2.0)*t + 4*ball.apex*t*(1-t)};
}
export function resolvePass(){
  const L = {x:ball.tx, y:ball.ty};
  const w = ball.target, dO = dist(w, L);
  let dd = null, dD = 1e9;
  if(!S.defOff) for(const d of DEF){ if(d.stun > 0) continue; const k = dist(d, L); if(k < dD){ dD = k; dd = d; } }   // B-066 (def-off): nobody contests the pass
  const r = Math.random();
  if(dO < 1.7*BODY_W){   // B-021: catch and contest radii are body size, x0.7 (1.7 -> 1.19, 1.3 -> 0.91)
    if(dD < 1.3*BODY_W){
      if(r < (dO < dD ? 0.6 : 0.25)) return catchBall(w, 'Contested catch!');
      if(r < 0.85) return endPlay('inc', 0, 'Broken up');
      return endPlay('int');
    }
    return catchBall(w, 'Caught!');
  }
  if(dD < 1.3*BODY_W) return r < 0.4 ? endPlay('int') : endPlay('inc', 0, 'Knocked down');
  endPlay('inc');
}
function catchBall(w, msg){
  S.handoffAt = S.clock;
  ball.state = 'held'; ball.holder = w; S.runMode = true; S.ctrl = w; toast(msg);
}
