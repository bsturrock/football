import { setCam, setCpu } from './cpu.js';
import { toast } from './hud.js';
import { fitGroup, routeGroup } from './markers.js';
import { PLAYS } from './playbook.js';
import { C, CBs, DEF, DL, LBs, LG, LT, OFF, OL, QB, RB, RECV, RG, RT, SFs, TE, WRs } from './players.js';
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
  if(k === 'c') setCpu(!S.cpu);
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
  S.phase = 'live'; S.clock = 0; S.runMode = !!run;
  S.ctrl = run && run !== 'keep' ? RB : QB;
  pitch(C, QB, 0.3);
  fitGroup.visible = false;
  if(run === 'keep'){ S.handoffAt = PLAYS[S.play].passSet || 0; QB.auto = true; QB.route = [{x:0.4, y:S.los + 1.5}]; QB.wp = 0; }
  if(run){
    const play = PLAYS[S.play];
    const OK = {LT, LG, C, RG, RT, TE, RB, WR0:WRs[0], WR1:WRs[1], WR2:WRs[2]};
    const lbs = [...LBs].sort((a, b) => a.x - b.x), sfs = [...SFs].sort((a, b) => a.x - b.x);
    const DK = {DL0:DL[0], DL1:DL[1], DL2:DL[2], DL3:DL[3], LB0:lbs[0], LB1:lbs[1], CB0:CBs[0], CB1:CBs[1], CB2:CBs[2], S0:sfs[0], S1:sfs[1]};
    for(const [o, d] of Object.entries(play.blocks || {})){ OK[o].blk = DK[d]; OK[o].scripted = true; }
    if(play.scheme === 'zone') [...OL, TE].forEach(o => { o.lane = o.x + play.shift; o.blk = null; });
    // safety rolled down on the play side: the tight end climbs straight to him instead of zoning
    const boxS = SFs.find(f => f.fit && Math.sign(f.x) === Math.sign(play.shift || 0));
    if(play.scheme === 'zone' && boxS){ TE.blk = boxS; TE.locked = true; OFF.forEach(o => { if(o !== TE && o.blk === boxS) o.blk = null; }); }
    for(const [o, pts] of Object.entries(play.pulls || {})) OK[o].via = pts.map(([x, dy]) => ({x, y:S.los + dy}));
  }
}
// short ball transfer between two players (snap, toss)
export function pitch(from, to, dur){ Object.assign(ball, {state:'pitch', pf:from, pt:to, t:0, pdur:dur, holder:null}); }
export function giveBall(p){
  ball.state = 'held'; ball.holder = p;
  if(p === RB && S.runMode){ RB.auto = true; S.handoffAt = S.clock; }
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
  for(const d of DEF){ if(d.stun > 0) continue; const k = dist(d, L); if(k < dD){ dD = k; dd = d; } }
  const r = Math.random();
  if(dO < 1.7){
    if(dD < 1.3){
      if(r < (dO < dD ? 0.6 : 0.25)) return catchBall(w, 'Contested catch!');
      if(r < 0.85) return endPlay('inc', 0, 'Broken up');
      return endPlay('int');
    }
    return catchBall(w, 'Caught!');
  }
  if(dD < 1.3) return r < 0.4 ? endPlay('int') : endPlay('inc', 0, 'Knocked down');
  endPlay('inc');
}
function catchBall(w, msg){
  S.handoffAt = S.clock;
  ball.state = 'held'; ball.holder = w; S.runMode = true; S.ctrl = w; toast(msg);
}
