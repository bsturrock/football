import { resetCam } from './camera.js';
import { toast } from './hud.js';
import { snap } from './input.js';
import { PLAYS } from './playbook.js';
import { newGame } from './rules.js';
import { S, ball, selectPlay } from './state.js';
import { $ } from './util.js';

const playIdx = n => PLAYS.findIndex(p => p.name === n);
// B-007-13: the CPU calls like a play caller, not a flat spread: a base mix (the zone plays carry the game, the gimmicks are spice), then
// down and distance, then the front. Slant sides are strength-relative (Left = weak, Right = strong): run away from the slant.
const BASE = {'Inside Zone':1.6, 'Outside Zone':1.0, 'Duo':1, 'Power':1, 'Iso':0.6, 'Counter':0.7, 'Trap':0.4, 'Toss':0.5, 'Draw':0.35 /* B-007-12: broken, B-018 */};
const SHORT_FORMS = ['22 Heavy', '21 I', '12 Under'], LONG_FORMS = ['11 Gun'];   // formation by situation, filtered to the play's own list
function cpuWeights(){
  const w = {...BASE}, call = S.defCall.name, front = S.front, tg = S.toGo;
  if(tg <= 2){ w['Inside Zone'] += 1.5; w['Power'] += 1.5; w['Duo'] += 1.5; w['Iso'] += 1; w['Trap'] += 1; w['Toss'] = 0.3; w['Draw'] = 0.3; }   // short yardage: downhill
  if(tg >= 7){ w['Outside Zone'] += 0.9; w['Toss'] += 0.6; w['Draw'] += 0.3; w['Power'] -= 0.4; w['Duo'] -= 0.4; w['Iso'] -= 0.2; }   // long: stretch, or a draw against the pass shell
  if(front === 'odd' || front === 'bear'){ w['Power'] *= 0.5; w['Counter'] *= 0.5; w['Outside Zone'] += 0.6; w['Draw'] += 0.25; w['Toss'] += 0.3; }   // no pulling into a stacked middle: get outside or draw it
  if(call === 'Eight in the Box'){ w['Outside Zone'] += 1.2; w['Draw'] += 0.3; w['Power'] *= 0.7; }   // get outside the extra man
  if(call === 'Run Blitz' || call === 'Safety Blitz' || call.includes('Blitz')){ w['Outside Zone'] += 0.6; w['Draw'] += 0.15; w['Counter'] += 0.3; }   // get outside the blitzer, or counter the over-pursuit
  if(call === 'Slant Left'){ w['Outside Zone'] += 1.2; w['Toss'] += 0.6; w['Power'] = Math.max(0.2, w['Power'] - 0.6); w['Counter'] += 0.5; }   // weak slant: strong-side plays
  if(call === 'Slant Right'){ w['Power'] += 1.3; w['Trap'] += 0.6; w['Counter'] += 0.5; w['Outside Zone'] *= 0.6; }   // strong slant: weak-side plays
  for(const n in w) w[n] = Math.max(0.05, w[n]);
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
  const want = S.toGo <= 2 ? SHORT_FORMS : S.toGo >= 7 ? LONG_FORMS : null;
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
