import { banner, downText, updateHUD } from './hud.js';
import { rate } from './players.js';
import { S, setupPlay } from './state.js';
import { MAX_DRIVES, clamp } from './util.js';

// ---------- downs ----------
export function endPlay(kind, y, note){
  S.phase = 'dead'; S.deadT = 2.2; S.charging = false;
  if(kind === 'td'){ S.score += 7; S.tds++; banner('TOUCHDOWN', '+7 points'); newDrive(); return; }
  if(kind === 'int'){ banner('INTERCEPTED', 'Drive over'); newDrive(); return; }
  if(kind === 'inc'){ S.down++; if(!checkDowns()) banner('INCOMPLETE', (note ? note + ' · ' : '') + downText()); updateHUD(); return; }
  if(y <= 0){ banner('SAFETY', 'Drive over'); newDrive(); return; }
  const spot = clamp(Math.round(y), 1, 99), gain = spot - S.los;
  S.los = spot;
  const head = note || (gain > 0 ? `+${gain} YARDS` : gain < 0 ? `LOSS OF ${-gain}` : 'NO GAIN');
  if(gain >= S.toGo){ S.down = 1; S.toGo = Math.min(10, 100 - spot); banner(head, 'First down · ' + downText()); }
  else { S.down++; S.toGo -= gain; if(!checkDowns()) banner(head, downText()); }
  updateHUD();
}
function checkDowns(){
  if(S.down <= 4) return false;
  banner('TURNOVER ON DOWNS', 'Drive over'); newDrive(); return true;
}
function newDrive(){
  S.drive++; S.los = 25; S.down = 1; S.toGo = 10;
  if(S.drive > MAX_DRIVES) S.over = true;
  updateHUD();
}
export function nextPlay(){
  if(S.over){
    S.phase = 'over';
    banner('FINAL', `${S.score} points · ${S.tds} touchdown${S.tds===1?'':'s'} in ${MAX_DRIVES} drives · Click to play again`);
    return;
  }
  setupPlay();
}
export function newGame(){ Object.assign(S, {score:0, tds:0, drive:1, los:25, down:1, toGo:10, over:false}); rate(); setupPlay(); }
