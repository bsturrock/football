import { isBody, physDown, physDownC, physDrive, physSpeed } from './physics.js';
import { ALL, DEF, OFF } from './players.js';
import { endPlay, heldBallPos } from './rules.js';
import { S } from './state.js';
import { BODY_W, PILE_R, dist } from './util.js';

// ---------- pile push and forward-progress whistle ----------
// A runner held up (a defender latched, not falling, not down) with 2+ bodies within PILE_R is a pile. Free bodies within
// PUSH_JOIN (up to PUSH_MAX a side) drive him: offense bodies behind him (p.y < his y) toward him and +y, defense bodies in front (p.y > his y) toward him and -y. Pushing is only a wanted velocity and a
// leg force through physDrive (physics.js); no position is ever set. The whistle applies to any held runner: advancing under
// STALL_D yd over STALL_T s while held ends the play, spotted at the ball's furthest point (S.prog); so does PUSH_MAX_T s of pushing in one play (never a long scrum).
// S.pile.state, one runner at a time (pileUpdate runs once per live frame while he holds the ball):
//   dead      not held (free, down, getting up; held = a latched tackler, or B-008 an unlatched runner in contact (S.prog is finite only for PROG_TOUCH_T 0.15 s after a touch or grip, rules.js) and slower than STALL_V, which only run the stall clock and read 'forming'; a runner already falling but not yet down, held up by latched tacklers off the turf, runs the stall clock the same way: seed 7 showed 90% of the stuck runners were falling and latched) or no tracked progress (QB on a dropback); timers cleared
//   forming   held, fewer than 2 bodies within PILE_R, or the pile is younger than FORM_T 0.1 s; also an unlatched contact runner or a falling runner (B-008): only the stall clock runs, no pushers
//   live      a pile of 2+ bodies for FORM_T s, nobody free to push yet
//   pushing   live with 1+ pusher driving
//   whistle   stalled (STALL_T) or pushing for PUSH_MAX_T total: endPlay('spot', S.prog, 'FORWARD PROGRESS'); the play is dead, the next setupPlay's pileReset clears it
// Any state: ball dead -> no pileUpdate, and physDrive's drive expires within DRIVE_T s (physics.js), so nothing pushes a dead play.
// Tuned from the card's values (card: PUSH_JOIN 1.5, PUSH_V 2.0, PUSH_K 1.2, FORM_T 0.25 s): the card values gave 0 push gain in the sim (the runner fell in 0.2 s, pushes lasted 0.15 s), so join radius, speed, force and forming time were raised, with the downP and plant easing in tackling.js / physics.js (feature pile-push). STALL_T 1.0 -> 0.6 and PUSH_MAX_T 1.5 -> 1.0 (B-006-7: stalled piles end sooner, user L-1006-116).
// B-021: PILE_R (util.js) and PUSH_JOIN are body-size radii, x0.7 (1.3 -> 0.91, 2.0 -> 1.4)
const PUSH_JOIN = 2.0*BODY_W, PUSH_MAX = 3, PUSH_V = 4.0, PUSH_K = 2.5, FORM_T = 0.1, PUSH_MAX_T = 1.0, STALL_D = 0.3, STALL_T = 0.6, STALL_V = 0.5, PUSHER_BAL = 0.5, PILE_BODIES = 2;
// whistles, frames and pushes are session totals for the sim (kept across plays); a play that reached pushing adds {gain, dur} (ball yd from the first pushing frame to the last, s pushing)
export function pileReset(){
  const keep = S.pile; S.pile = {state:'dead', t:0, formT:0, ref:null, pushers:0, pushersO:0, pushersD:0, whistles:0, frames:{dead:0, forming:0, live:0, pushing:0}, pushes:[], cur:null};
  if(keep){ S.pile.whistles = keep.whistles; S.pile.frames = keep.frames; S.pile.pushes = keep.pushes; if(keep.cur) S.pile.pushes.push({gain:keep.cur.gain, dur:keep.cur.dur}); }
}
const freeBody = p => p.ph && !p.falling && !p.latch && !p.bt && !(p.stun > 0) && p.ph.bal >= PUSHER_BAL && !physDown(p);
function side(list, c, rate, dir){
  // only the side doing the pushing: offense behind him, defense in front
  const ps = list.filter(p => p !== c && freeBody(p) && (c.y - p.y)*dir > 0 && dist(p, c) < PUSH_JOIN).sort((a, b) => dist(a, c) - dist(b, c)).slice(0, PUSH_MAX);
  ps.forEach(p => {   // wanted velocity: toward the runner plus up (or down) the field
    const dx = c.x - p.x, dy = c.y - p.y, l = Math.hypot(dx, dy) || 1, vx = dx/l, vy = dy/l + dir, vl = Math.hypot(vx, vy) || 1;
    physDrive(p, PUSH_V*vx/vl, PUSH_V*vy/vl, p.leg*PUSH_K*(p[rate]/80));   // B-034 (speed-scale)
  });
  return ps.length;
}
export function pileUpdate(c, dt){
  const P = S.pile || (pileReset(), S.pile);
  // B-008: the stall whistle also covers a falling runner and a runner in contact with nobody latched on him and slower than STALL_V (a sweep rubbing bodies along the line keeps moving), e.g. propped up by still bodies; contact is S.prog being finite (it clears PROG_TOUCH_T 0.15 s after a touch, rules.js); push and pile states stay for the latched case only
  const latched = DEF.some(d => d.latch === c), held = S.phase === 'live' && c.ph && (latched || physSpeed(c) < STALL_V) && !physDownC(c) && Number.isFinite(S.prog);
  P.frames[P.state === 'whistle' ? 'dead' : P.state]++;
  if(!held){ P.state = 'dead'; P.t = P.formT = P.pushers = P.pushersO = P.pushersD = 0; P.ref = null; return; }
  // stall: S.prog (furthest ball y while held) must gain STALL_D within STALL_T
  const y = S.prog;
  if(P.ref === null){ P.ref = y; P.t = 0; }
  else if(y - P.ref >= STALL_D){ P.ref = y; P.t = 0; }
  else if((P.t += dt) >= STALL_T){ P.state = 'whistle'; P.whistles++; endPlay('spot', S.prog, 'FORWARD PROGRESS'); return; }
  if(!latched || c.falling){ P.state = 'forming'; P.formT = P.pushers = P.pushersO = P.pushersD = 0; return; }   // B-008: unlatched contact or a falling runner only runs the stall clock
  const bodies = ALL.filter(p => p !== c && isBody(p) && dist(p, c) < PILE_R).length;
  P.formT = bodies >= PILE_BODIES ? P.formT + dt : 0;
  P.pushers = P.pushersO = P.pushersD = 0;
  if(P.formT < FORM_T){ P.state = 'forming'; return; }
  P.pushersO = side(OFF, c, 'rStr', 1); P.pushersD = side(DEF, c, 'rPow', -1); P.pushers = P.pushersO + P.pushersD;   // pushersO: tackling.js slows the fall for these
  P.state = P.pushers ? 'pushing' : 'live';
  if(P.pushers){ const by = heldBallPos(c).y; P.cur = P.cur || {y0:by, gain:0, dur:0}; P.cur.gain = by - P.cur.y0; P.cur.dur += dt; }
  if(P.cur && P.cur.dur >= PUSH_MAX_T){ P.state = 'whistle'; P.whistles++; endPlay('spot', S.prog, 'FORWARD PROGRESS'); }
}
