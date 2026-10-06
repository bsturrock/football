import { autoCarry, burst } from './carrier.js';
import { keys } from './input.js';
import { runRoute, steer, steerVel } from './movement.js';
import { PLAYS } from './playbook.js';
import { C, DEF, DL, LBs, LG, LT, OFF, QB, RB, RG, RT } from './players.js';
import { S, ball } from './state.js';
import { dist } from './util.js';

// what blockers protect: the runner once he has the ball, otherwise the play's hole
export function runRef(){
  const c = ball.state === 'held' ? ball.holder : null, play = PLAYS[S.play];
  if(c && (c !== QB || !play.run)) return c;
  return {x:play.hole || 0, y:S.los + 1};
}
// nearest defender in front of the runner that no teammate is already blocking
function pickBlock(p, ref){
  let best = null, bd = 1e9;
  for(const d of DEF){
    if(d.stun > 0 || dist(d, ref) > 15 || d.y < ref.y - 3 || d.y < p.y - 1.5) continue;
    if(OFF.some(o => o !== p && o.blk === d)) continue;
    const k = dist(d, p); if(k < bd){ bd = k; best = d; }
  }
  return best;
}
// fit up on the defender's offense side, shaded toward the runner, so the drive goes forward and away from the hole
function driveAt(p, d, ref, dt){
  const vx = ref.x - d.x, vy = Math.min(ref.y - d.y, -0.6), l = Math.hypot(vx, vy) || 1;
  if(dist(p, d) < 1.4){ p.eng = 0.15; p.locked = true; }
  p.faceAt = d;
  // a blocker who just got beaten is off balance: he chases his man but usually can't recover
  steer(p, d.x + vx/l*0.85, d.y + vy/l*0.85, p.spd*(p.beatT > 0 ? 0.55 : 1), dt);
}
const claimed = (p, d) => OFF.some(o => o !== p && o.blk === d);
// man / gap: the assignment is kept all play, even after getting beaten. Only a knocked-down
// defender (pancake) frees the blocker to go find someone else.
function block(p, dt){
  const ref = runRef();
  let d = p.blk;
  if(!d || d.stun > 0){ d = p.blk = pickBlock(p, ref); }
  if(!d){ steer(p, ref.x + (p.x > ref.x ? 2.5 : -2.5), ref.y + 3, p.spd*0.85, dt); return; }  // nobody left: lead upfield
  driveAt(p, d, ref, dt);
}
// zone: block whoever is in my lane at the line; if the lane is empty, climb to a linebacker in my area.
// Once engaged, the man is mine for the rest of the play.
function zoneBlock(p, dt){
  const ref = runRef(), lane = p.lane;
  let d = p.blk;
  if(!(d && d.stun <= 0 && (p.locked || Math.abs(d.x - lane) < 3))){
    d = null; p.locked = false; let bd = 1e9;
    for(const e of DEF){
      if(e.stun > 0 || claimed(p, e) || e.y < p.y - 1.5) continue;
      const dx = Math.abs(e.x - lane), dy = e.y - S.los;
      if(!((dy < 3.5 && dx < 1.8) || (p.climbing && dy < 9 && dx < 6))) continue;
      const k = dist(e, p); if(k < bd){ bd = k; d = e; }
    }
    p.blk = d;
  }
  if(!d){ p.climbing = true; steer(p, lane, Math.max(p.y + 2, S.los + 3), p.spd*0.9, dt); return; }
  driveAt(p, d, ref, dt);
}
function runBlock(p, dt){
  const play = PLAYS[S.play];
  if(play.run && p.via && p.via.length){                       // pulling: get through the waypoints first
    const v = p.via[0];
    if(Math.hypot(v.x - p.x, v.y - p.y) < 0.8) p.via.shift();
    else {   // pulling: full speed through the waypoints (no arrive braking), quicker feet than a normal OL
      const dx = v.x - p.x, dy = v.y - p.y, l = Math.hypot(dx, dy), a = p.acc, t = p.turn, s = p.spd*1.3;
      p.acc *= 1.6; p.turn *= 1.8; steerVel(p, dx/l*s, dy/l*s, dt); p.acc = a; p.turn = t;
      p.faceAt = p.blk; return;   // eyes on the kick-out man
    }
  }
  if(play.run && p.lane != null) zoneBlock(p, dt); else block(p, dt);
}
function olAssign(p){
  if(p !== C) return DL[[LT, LG, RG, RT].indexOf(p)];
  const blitzer = LBs.find(b => b.mode === 'rush');
  return blitzer || (dist(DL[1], QB) < dist(DL[2], QB) ? DL[1] : DL[2]);
}
export function offenseAI(p, dt, inp){
  p.faceAt = null;
  if(p.falling) return;                                   // going down: tackleUpdate moves him
  const c = ball.state === 'held' ? ball.holder : null, run = PLAYS[S.play].run;
  if(run){
    if(p === RB && c !== RB){
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
  const r = olAssign(p), qx = QB.x - r.x, qy = QB.y - r.y, ql = Math.hypot(qx, qy) || 1;
  if(dist(p, r) < 1.4) p.eng = 0.15;
  p.faceAt = r;
  steer(p, r.x + qx/ql*0.95, r.y + qy/ql*0.95, p.spd, dt);
}
