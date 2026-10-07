import { BEHIND_Y, CLIMB_LANE_DX, ENGAGE_R, LANE_DX, ZONE_KEEP, PULL_V, PULL_VIA_R, climbCheck, pullCheck, rereadCheck } from './blockrules.js';
import { autoCarry, burst } from './carrier.js';
import { GRID_K } from './formations.js';
import { keys } from './input.js';
import { runRoute, steer, steerVel } from './movement.js';
import { PLAYS } from './playbook.js';
import { C, DEF, DL, LBs, LG, LT, OFF, QB, RB, RG, RT } from './players.js';
import { S, ball } from './state.js';
import { dist } from './util.js';

const DRAW_LEAD = 0.6;   // B-007-12: the back leaves his hold this long before the handoff time so he is at the QB's hip then
const DRAW_SET = 1.8;    // B-007-12: the line sets this much deeper than a pass set, so the rush runs upfield into it
const LEAD_X = 2.5*GRID_K;   // B-021: a blocker with nobody left leads upfield this far off the ball side (was 2.5, old line grid)
const FIT_UP = 0.6;   // B-021: a blocker aims this far in front of his man's centre (was 0.85, x0.7 body width)
const DBL_SHOULDER = 0.32;   // B-021: was 0.45, x0.7   // two blockers on one defender: each takes a shoulder this far off his centre
// what blockers protect: the runner once he has the ball, otherwise the play's hole
export function runRef(){
  const c = ball.state === 'held' ? ball.holder : null, play = PLAYS[S.play];
  if(c && (c !== QB || !play.run)) return c;
  return {x:S.hole || 0, y:S.los + 1};
}
// nearest defender in front of the runner that no teammate is already blocking
function pickBlock(p, ref){
  let best = null, bd = 1e9;
  for(const d of DEF){
    if(d.stun > 0 || dist(d, ref) > 15 || d.y < ref.y - 3 || d.y < p.y - BEHIND_Y) continue;
    if(OFF.some(o => o !== p && o.blk === d)) continue;
    const k = dist(d, p); if(k < bd){ bd = k; best = d; }
  }
  return best;
}
// fit up on the defender's offense side, shaded toward the runner, so the drive goes forward and away from the hole
function driveAt(p, d, ref, dt){
  const vx = ref.x - d.x, vy = Math.min(ref.y - d.y, -0.6), l = Math.hypot(vx, vy) || 1;
  if(dist(p, d) < ENGAGE_R){ p.eng = 0.15; p.locked = true; }
  p.faceAt = d;
  const side = p.dbl && p.dbl.state === 'double' && p.dbl.d === d ? (Math.sign(p.x - d.x) || 1)*DBL_SHOULDER : 0;   // two men on one defender take a shoulder each
  // a blocker who just got beaten is off balance: he chases his man but usually can't recover
  steer(p, d.x + side + vx/l*FIT_UP, d.y + vy/l*FIT_UP, p.spd*(p.beatT > 0 ? 0.55 : 1), dt);
}
const claimed = (p, d) => OFF.some(o => o !== p && o.blk === d);
// man / gap: the assignment is kept all play, even after getting beaten. Only a knocked-down
// defender (pancake) frees the blocker to go find someone else.
function block(p, dt){
  const ref = runRef();
  let d = p.blk;
  if(!d || d.stun > 0){ d = p.blk = pickBlock(p, ref); }
  if(!d){ steer(p, ref.x + (p.x > ref.x ? LEAD_X : -LEAD_X), ref.y + 3, p.spd*0.85, dt); return; }  // nobody left: lead upfield
  driveAt(p, d, ref, dt);
}
// zone: block whoever is in my lane at the line; if the lane is empty, climb to a linebacker in my area.
// Once engaged, the man is mine for the rest of the play.
function zoneBlock(p, dt){
  const ref = runRef(), lane = p.lane;
  let d = p.blk;
  if(!(d && d.stun <= 0 && (p.locked || p.ruled || Math.abs(d.x - lane) < ZONE_KEEP))){
    d = null; p.locked = false; p.ruled = false; let bd = 1e9;
    for(const e of DEF){
      if(e.stun > 0 || claimed(p, e) || e.y < p.y - BEHIND_Y) continue;
      const dx = Math.abs(e.x - lane), dy = e.y - S.los;
      if(!((dy < 3.5 && dx < LANE_DX) || (p.climbing && dy < 9 && dx < CLIMB_LANE_DX))) continue;
      const k = dist(e, p); if(k < bd){ bd = k; d = e; }
    }
    p.blk = d;
  }
  if(!d){ p.climbing = true; steer(p, lane, Math.max(p.y + 2, S.los + 3), p.spd*0.9, dt); return; }
  driveAt(p, d, ref, dt);
}
function runBlock(p, dt){
  const play = PLAYS[S.play];
  if(p.pull) pullCheck(p, dt);
  if(p.pull && p.pull.late && p.pull.t < p.pull.late && p.via && p.via.length){ steer(p, p.x, p.y, 0, dt); p.faceAt = p.blk; return; }   // B-032-3: a busting puller leaves late
  if(play.run && p.via && p.via.length){                       // pulling: get through the waypoints first
    const v = p.via[0];
    if(Math.hypot(v.x - p.x, v.y - p.y) < PULL_VIA_R) p.via.shift();
    else {   // pulling: full speed through the waypoints (no arrive braking), quicker feet than a normal OL
      const dx = v.x - p.x, dy = v.y - p.y, l = Math.hypot(dx, dy), a = p.acc, t = p.turn, s = p.spd*PULL_V;
      p.acc *= 1.6; p.turn *= 1.8; steerVel(p, dx/l*s, dy/l*s, dt); p.acc = a; p.turn = t;
      p.faceAt = p.blk; return;   // eyes on the kick-out man
    }
  }
  if(p.dbl) climbCheck(p, dt);
  if(p.rr) rereadCheck(p, dt);   // B-007-9: a stunt moved my man; re-read every 0.1 s
  if(play.run && p.lane != null) zoneBlock(p, dt); else block(p, dt);
}
function olAssign(p){
  if(p !== C) return DL[[LT, LG, RG, RT].indexOf(p)] || DL.reduce((a, b) => dist(b, p) < dist(a, p) ? b : a);   // 3-man front: the fourth blocker takes the nearest lineman
  const blitzer = LBs.find(b => b.mode === 'rush');
  return blitzer || (dist(DL[1], QB) < dist(DL[2], QB) ? DL[1] : DL[2]);
}
// B-007-12 Draw: main.js keeps S.runMode false until the handoff, so the line, tight end and extra backs take the pass-set branch at the bottom (olAssign) and
// the defense plays pass; the handoff's re-read then gives them the man on them. States (S.handoffAt === Infinity while in drop):
//   drop     clock < delay: QB drops, RB holds, OL pass set, defense pass read -> handoff at clock >= delay and the RB at the QB (runMode on, blockers re-resolve)
//   drop     a throw in the delay (known, accepted): ball in the air, runMode stays false until the catch (no handoff)
//   drop     a scramble (QB past the line): handoffAt set, drawHold ends, the play runs as a scramble
//   handoff  giveBall(RB) -> run: normal run fit after the defenders' read delay
const drawHold = () => { const d = PLAYS[S.play].delay; return d && S.handoffAt === Infinity ? d : 0; };
export function offenseAI(p, dt, inp){
  p.faceAt = null;
  if(p.falling) return;                                   // going down: tackleUpdate moves him
  const c = ball.state === 'held' ? ball.holder : null, run = PLAYS[S.play].run;
  if(run){
    const hold = drawHold();
    if(p === RB && c !== RB){
      if(hold && S.clock < hold - DRAW_LEAD){ steer(p, p.x, p.y, 0, dt); return; }   // Draw: the back stays in the backfield until it is time
      // last few yards to the mesh: the back finds the QB (runs just past his near hip) so the exchange always happens
      if(run === 'hand' && c === QB && dist(p, QB) < 3){
        const side = Math.sign(p.x - QB.x) || 1, tx = QB.x + side*0.7, ty = QB.y - 0.2, l = Math.hypot(tx - p.x, ty - p.y) || 1;
        steerVel(p, (tx - p.x)/l*p.spd, (ty - p.y)/l*p.spd, dt); return;
      }
      runRoute(p, dt); return;
    }            // RB runs his path until he has the ball
    if(p === QB && c === QB && run === 'hand'){                      // handoff: open to the mesh, then extend to the back
      const m = PLAYS[S.play].mesh;
      const mx = m && m[0] - p.x, my = m && S.los + m[1] - p.y, ml = m && Math.hypot(mx, my);
      if(m && ml > 0.4) steerVel(p, mx/ml*6, my/ml*6, dt);   // open hard to the spot
      else if(hold && S.clock < hold - DRAW_LEAD) steer(p, p.x, p.y, 0, dt);   // Draw: dropped, waiting for the back
      else steer(p, RB.x, RB.y, m ? 6 : 4, dt);
      return;
    }
  }
  if(p === c && p.auto){                                              // runner follows the path until you take over
    if(inp.on) p.auto = false;
    else {
      autoCarry(p, dt);
      return;
    }
  }
  if(p === S.ctrl && (p === c || inp.on)){
    const sp = p.spd*(p === c ? burst(p, keys.has('shift'), dt) : 1);
    steerVel(p, inp.x*sp, inp.y*sp, dt); return;
  }
  if(p.role === 'QB'){ steer(p, p.x, p.y, 0, dt); return; }
  if(p.role === 'WR'){
    if(ball.state === 'air' && p === ball.target){ steer(p, ball.tx, ball.ty, p.spd, dt); return; }
    if(S.runMode && c !== p){ runBlock(p, dt); return; }
    runRoute(p, dt); return;
  }
  if(S.runMode){ runBlock(p, dt); return; }
  if(drawHold()){ p.blk = null; p.ruled = false; p.dbl = null; p.rr = null; }   // Draw: no run target in the pass set; the handoff re-read picks the man on him
  const r = olAssign(p), qx = QB.x - r.x, qy = QB.y - r.y, ql = Math.hypot(qx, qy) || 1;
  if(dist(p, r) < ENGAGE_R) p.eng = 0.15;
  p.faceAt = r;
  const k = 0.95 + (drawHold() ? DRAW_SET : 0);
  steer(p, r.x + qx/ql*k, r.y + qy/ql*k, p.spd, dt);
}
