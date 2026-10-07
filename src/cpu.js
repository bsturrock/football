import { resetCam } from './camera.js';
import { toast } from './hud.js';
import { snap } from './input.js';
import { PLAYS } from './playbook.js';
import { newGame } from './rules.js';
import { S, ball, selectPlay } from './state.js';
import { $ } from './util.js';

const playIdx = n => PLAYS.findIndex(p => p.name === n);
// B-007-13: the CPU calls like a play caller, not a flat spread: a base mix (the zone plays carry the game, the gimmicks are spice), then
// down and distance, then the front. Each situation is a table of {set, add, mul} on the weights, applied in that order, in the order below.
const BASE = {'Inside Zone':1.6, 'Outside Zone':1.0, 'Duo':1, 'Power':1, 'Iso':0.6, 'Counter':0.7, 'Trap':0.4, 'Toss':0.5, 'Draw':0.35 /* B-007-12: broken, B-018 */};
const SHORT_TG = 2, LONG_TG = 7;   // yards to go: at most SHORT_TG is short yardage, at least LONG_TG is long
const SHORT_FORMS = ['22 Heavy', '21 I', '12 Under'], LONG_FORMS = ['11 Gun'];   // formation by situation, filtered to the play's own list
const SHORT = {add:{'Inside Zone':1.5, Power:1.5, Duo:1.5, Iso:1, Trap:1}, set:{Toss:0.3, Draw:0.3}};   // short yardage: downhill
const LONG = {add:{'Outside Zone':0.9, Toss:0.6, Draw:0.3, Power:-0.4, Duo:-0.4, Iso:-0.2}};   // long: stretch, or a draw against the pass shell
const STACKED = {add:{'Outside Zone':0.6, Draw:0.25, Toss:0.3}, mul:{Power:0.5, Counter:0.5}};   // odd and bear fronts: no pulling into a stacked middle, get outside or draw it
const EIGHT = {add:{'Outside Zone':1.2, Draw:0.3}, mul:{Power:0.7}};   // Eight in the Box: get outside the extra man
const BLITZ = {add:{'Outside Zone':0.6, Draw:0.15, Counter:0.3}};   // any blitz: get outside the blitzer, or counter the over-pursuit
// Slant sides are strength-relative (Left = weak, Right = strong): run away from the slant. Counter (against Slant Left) and Trap (against
// Slant Right) are the exceptions on purpose: a line slanting hard gives up the cutback, so a misdirection or trap play is a real answer.
const SLANT_L = {add:{'Outside Zone':1.2, Toss:0.6, Power:-0.6, Counter:0.5}};   // weak slant: strong-side plays
const SLANT_R = {add:{Power:1.3, Trap:0.6, Counter:0.5}, mul:{'Outside Zone':0.6}};   // strong slant: weak-side plays
const WEIGHT_MIN = 0.05;
function apply(w, t){
  if(!t) return;
  for(const n in t.set) w[n] = t.set[n];
  for(const n in t.add) w[n] += t.add[n];
  for(const n in t.mul) w[n] *= t.mul[n];
}
function cpuWeights(){
  const w = {...BASE}, call = S.defCall.name;
  if(S.toGo <= SHORT_TG) apply(w, SHORT);
  if(S.toGo >= LONG_TG) apply(w, LONG);
  if(S.front === 'odd' || S.front === 'bear') apply(w, STACKED);
  if(call === 'Eight in the Box') apply(w, EIGHT);
  if(call.includes('Blitz')) apply(w, BLITZ);
  if(call === 'Slant Left') apply(w, SLANT_L);
  if(call === 'Slant Right') apply(w, SLANT_R);
  for(const n in w) w[n] = Math.max(WEIGHT_MIN, w[n]);
  return w;
}
function cpuCall(){
  if(S.force && S.force.play) return playIdx(S.force.play);   // feature (sim-force)
  const w = cpuWeights(), names = Object.keys(w).filter(n => playIdx(n) >= 0), tot = names.reduce((a, n) => a + w[n], 0);
  let r = Math.random()*tot; for(const n of names){ r -= w[n]; if(r <= 0) return playIdx(n); }
  return playIdx(names[0]);
}
// the formation from the play's own list: heavy sets in short yardage, the gun to throw-shaped downs, else the list's choice stays
function cpuForm(play){
  if(!play.forms) return null;
  const want = S.toGo <= SHORT_TG ? SHORT_FORMS : S.toGo >= LONG_TG ? LONG_FORMS : null;
  const ok = want && want.filter(f => play.forms.includes(f));
  return ok && ok.length ? ok[Math.floor(Math.random()*ok.length)] : null;
}
// B-007-13: the call carries the CPU's formation choice
export function cpuTick(dt){
  if(!S.cpu) return;
  if(S.phase === 'presnap'){
    S.preT += dt;
    if(S.preT > 1.0 && !S.called){ S.called = true; const i = cpuCall(); S.formHint = cpuForm(PLAYS[i]); selectPlay(i); S.formHint = null; toast('CPU: ' + PLAYS[S.play].name); }
    if(S.preT > 2.4){ S.called = false; snap(); }
  } else if(S.phase === 'over'){ S.overT += dt; if(S.overT > 5){ S.overT = 0; newGame(); } }
}
export function setCpu(on){
  S.cpu = on; $('cpuBtn').setAttribute('aria-pressed', String(on));
  if(on && ball.holder){ ball.holder.auto = true; }
}
export function setCam(m){ S.cam = m; $('camBtn').setAttribute('aria-pressed', String(m === 'tv')); resetCam(); }
