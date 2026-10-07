import { resetCam } from './camera.js';
import { toast } from './hud.js';
import { snap } from './input.js';
import { PLAYS } from './playbook.js';
import { newGame } from './rules.js';
import { S, ball, selectPlay } from './state.js';
import { $ } from './util.js';

const playIdx = n => PLAYS.findIndex(p => p.name === n);
// B-007-10: marked edit, weights for the new run plays
function cpuCall(){
  if(S.force && S.force.play) return playIdx(S.force.play);   // feature (sim-force)
  const w = {'Inside Zone':1, 'Power':1, 'Outside Zone':1, 'Duo':1, 'Iso':1, 'Counter':1, 'Trap':1, 'Toss':1, 'Draw':0.5 /* B-007-12 */}, call = S.defCall.name;
  if(S.toGo <= 2){ w['Inside Zone'] += 1.5; w['Power'] += 1.5; w['Duo'] += 1.5; w['Iso'] += 1; w['Trap'] += 1; }   // B-007-11
  if(call === 'Slant Left') w['Counter'] += 1; if(call === 'Slant Right') w['Trap'] += 0.5;   // B-007-11: counter against the over-pursuit
  if(S.toGo >= 7){ w['Outside Zone'] += 1.6; }
  if(call === 'Slant Left'){ w['Outside Zone'] += 2.5; w['Power'] = Math.max(0.2, w['Power'] - 0.6); }   // run away from the slant
  if(call === 'Slant Right') w['Power'] += 1.5;
  if(call === 'Run Blitz'){ w['Outside Zone'] += 1.3; }   // get outside the blitzer
  if(call === 'Eight in the Box'){ w['Outside Zone'] += 2.5; }                                                       // get outside the extra man
  if(S.toGo >= 7){ w['Toss'] += 0.8; w['Draw'] += 0.8; }   // B-007-12
  if(call === 'Eight in the Box' || call === 'Bear'){ w['Draw'] += 1; }   // B-007-12: a draw against a defense sitting down
  if(S.toGo <= 2){ w['Toss'] = 0.3; w['Draw'] = 0.3; }   // B-007-12
  const names = Object.keys(w).filter(n => playIdx(n) >= 0), tot = names.reduce((a, n) => a + w[n], 0);
  let r = Math.random()*tot; for(const n of names){ r -= w[n]; if(r <= 0) return playIdx(n); }
  return playIdx(names[0]);
}
export function cpuTick(dt){
  if(!S.cpu) return;
  if(S.phase === 'presnap'){
    S.preT += dt;
    if(S.preT > 1.0 && !S.called){ S.called = true; selectPlay(cpuCall()); toast('CPU: ' + PLAYS[S.play].name); }
    if(S.preT > 2.4){ S.called = false; snap(); }
  } else if(S.phase === 'over'){ S.overT += dt; if(S.overT > 5){ S.overT = 0; newGame(); } }
}
export function setCpu(on){
  S.cpu = on; $('cpuBtn').setAttribute('aria-pressed', String(on));
  if(on && ball.holder){ ball.holder.auto = true; }
}
export function setCam(m){ S.cam = m; $('camBtn').setAttribute('aria-pressed', String(m === 'tv')); resetCam(); }
