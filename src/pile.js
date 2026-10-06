import { isBody, physDown, physDownC, physDrive } from './physics.js';
import { ALL, DEF, OFF } from './players.js';
import { endPlay, heldBallPos } from './rules.js';
import { S } from './state.js';
import { dist } from './util.js';

// ---------- pile push and forward-progress whistle ----------
// A runner held up (a defender latched, not falling, not down) with 2+ bodies within PILE_R is a pile. Free bodies within
// PUSH_JOIN (up to PUSH_MAX a side) drive him: offense toward +y, defense toward -y. Pushing is only a wanted velocity and a
// leg force through physDrive (physics.js); no position is ever set. The whistle applies to any held runner: advancing under
// STALL_D yd over STALL_T s while held ends the play, spotted at the ball's furthest point (S.prog).
// S.pile.state, one runner at a time (pileUpdate runs once per live frame while he holds the ball):
//   dead      not held (free, falling, down, getting up) or no tracked progress (QB on a dropback); timers cleared
//   forming   held, fewer than 2 bodies within PILE_R, or the pile is younger than FORM_T s
//   live      a pile of 2+ bodies for FORM_T s, nobody free to push yet
//   pushing   live with 1+ pusher driving
//   whistle   stalled: endPlay('spot', S.prog, 'FORWARD PROGRESS'); the play is dead, the next setupPlay's pileReset clears it
// Any state: ball dead -> no pileUpdate, and physDrive's drive expires within DRIVE_T s (physics.js), so nothing pushes a dead play.
const PILE_R = 1.3, PUSH_JOIN = 2.0, PUSH_MAX = 3, PUSH_V = 2.0, PUSH_K = 1.5, FORM_T = 0.25, STALL_D = 0.3, STALL_T = 1.0, PUSHER_BAL = 0.5, PILE_BODIES = 2;
export function pileReset(){ const keep = S.pile; S.pile = {state:'dead', t:0, formT:0, ref:null, pushers:0, whistles:0, frames:{dead:0, forming:0, live:0, pushing:0}};   // whistles and frames are session totals for the sim (kept across plays)
  if(keep){ S.pile.whistles = keep.whistles; S.pile.frames = keep.frames; } }
const freeBody = p => p.ph && !p.falling && !p.latch && !p.bt && !(p.stun > 0) && p.ph.bal >= PUSHER_BAL && !physDown(p);
function side(list, c, rate, dir){
  const ps = list.filter(p => p !== c && freeBody(p) && dist(p, c) < PUSH_JOIN).sort((a, b) => dist(a, c) - dist(b, c)).slice(0, PUSH_MAX);
  ps.forEach(p => physDrive(p, 0, dir*PUSH_V, p.acc*PUSH_K*(p[rate]/80)));
  return ps.length;
}
export function pileUpdate(c, dt){
  const P = S.pile || (pileReset(), S.pile);
  const held = S.phase === 'live' && c.ph && !c.falling && DEF.some(d => d.latch === c) && !physDownC(c) && Number.isFinite(S.prog);
  P.frames[P.state === 'whistle' ? 'dead' : P.state]++;
  if(!held){ P.state = 'dead'; P.t = P.formT = P.pushers = 0; P.ref = null; return; }
  // stall: S.prog (furthest ball y while held) must gain STALL_D within STALL_T
  const y = S.prog;
  if(P.ref === null){ P.ref = y; P.t = 0; }
  else if(y - P.ref >= STALL_D){ P.ref = y; P.t = 0; }
  else if((P.t += dt) >= STALL_T){ P.state = 'whistle'; P.whistles++; endPlay('spot', S.prog, 'FORWARD PROGRESS'); return; }
  const bodies = ALL.filter(p => p !== c && isBody(p) && dist(p, c) < PILE_R).length;
  P.formT = bodies >= PILE_BODIES ? P.formT + dt : 0;
  P.pushers = 0;
  if(P.formT < FORM_T){ P.state = 'forming'; return; }
  P.pushers = side(OFF, c, 'rStr', 1) + side(DEF, c, 'rPow', -1);
  P.state = P.pushers ? 'pushing' : 'live';
}
