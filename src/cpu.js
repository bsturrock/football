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
  const w = {'Inside Zone':1, 'Power Left':1, 'Outside Zone':1, 'Duo':1, 'Iso':1}, call = S.defCall.name;
  if(S.toGo <= 2){ w['Inside Zone'] += 1.5; w['Power Left'] += 1.5; w['Duo'] += 1.5; w['Iso'] += 1; }
  if(S.toGo >= 7){ w['Outside Zone'] += 1.6; }
  if(call === 'Slant Left'){ w['Outside Zone'] += 2.5; w['Power Left'] = Math.max(0.2, w['Power Left'] - 0.6); }   // run away from the slant
  if(call === 'Slant Right') w['Power Left'] += 1.5;
  if(call === 'Run Blitz'){ w['Outside Zone'] += 1.3; }   // get outside the blitzer
  if(call === 'Eight in the Box'){ w['Outside Zone'] += 2.5; }                                                       // get outside the extra man
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
