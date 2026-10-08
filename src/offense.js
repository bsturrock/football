import { BEHIND_Y, CLIMB_LANE_DX, ENGAGE_R, LANE_DX, ZONE_KEEP, PULL_V, PULL_ACC, PULL_TURN, PULL_VIA_R, climbCheck, pullCheck, rereadCheck } from './blockrules.js';
import { autoCarry, burst, cutEnd } from './carrier.js';   // B-072-3 (carrier-cuts): cutEnd
import { GRID_K } from './formations.js';
import { keys } from './input.js';
import { runRoute, steer, steerVel } from './movement.js';
import { PLAYS } from './playbook.js';
import { C, DEF, DL, LBs, LG, LT, OFF, QB, RB, RG, RT } from './players.js';
import { S, ball } from './state.js';
import { BODY_W, dist } from './util.js';

// B-060-2: situational speeds, fractions of p.spd (top speed only in a dead sprint); scale the speed passed to steer/steerVel only, never p.acc or p.leg
const RUN_BLOCK_F = 0.45, BEATEN_F = 0.3, PASS_SET_F = 0.3, CLIMB_F = 1.0, LEAD_F = 0.7, STEM_F = 0.8;
export function logSpeed(p, top){   // B-060-2 readout: S.speedRole[role] = {n, sum} of speed/top while the play is live (ball held or in the air)
  if(S.phase === 'presnap' || (ball.state !== 'held' && ball.state !== 'air')) return;
  const r = S.speedRole || (S.speedRole = {}), k = p.role, e = r[k] || (r[k] = {n:0, sum:0});
  e.n++; e.sum += Math.hypot(p.vx, p.vy)/top;
}
// a pass route at stem speed (full once past the first waypoint or with the ball in the air); only the RB's pre-handoff path stays plain runRoute (on run plays the WRs go to runBlock: runMode is set at the snap)
const route = (p, dt) => runRoute(p, dt, ball.state === 'air' || p.wp > 0 ? 1 : STEM_F);
const PULL_LEAD_T = 1.0, PULL_LEAD_V = 4;   // B-061: the puller aims where the target will be: his own time to reach him (distance / his speed, at least PULL_LEAD_V yd/s so a standing start does not over-lead), at most PULL_LEAD_T s
const DRAW_LEAD = 0.6;   // B-007-12: the back leaves his hold this long before the handoff time so he is at the QB's hip then
const DRAW_SET = 1.8;    // B-007-12: the line sets this much deeper than a pass set, so the rush runs upfield into it
const LEAD_X = 2.5*GRID_K;   // B-021: a blocker with nobody left leads upfield this far off the ball side (was 2.5, old line grid)
const CLIMB_LEAD_T = 0.6;   // B-012 (climb-timing): the climber aims this many seconds of the linebacker's velocity ahead of him, at most (his own time to arrive when shorter)
const NM_DEPTH = 2.5, NM_HELP_R = 4, NM_SHADE = 0.3, NM_SHADE_MAX = 1.5;   // B-073: a blocker with no man holds within NM_DEPTH of the line (fixed target), helps an engaged lineman within NM_HELP_R, shades NM_SHADE of the way to the hole (at most NM_SHADE_MAX)
const BEATEN_T = 0.9;   // = blocking.js beatT (set at :98 there)
const BEAT_BRAKE_T = 0.5, BEAT_STOP_V = 1.2;   // B-073: a beaten blocker plants (brakes hard) for up to this long (or until under this speed) before he chases his man's hip
// B-073 readout (sim.js can add S.olDepth): one record per OL/TE/WR blocker per play, {id, noMax (deepest past the line with no man, yd), over (farthest from the spot he was beaten, yd), face (s from beaten to within ENGAGE_R of his man, -1 never)}
export function noteBlocker(p){
  const r = p.olRec || (p.olRec = {id:p.role + OFF.indexOf(p), noMax:0, over:0, face:-1, b:null});
  return r;
}
export function flushOlRecs(list){ for(const p of OFF){ const r = p.olRec; if(r && (r.noMax > 0 || r.over > 0 || r.face >= 0)) list.push({id:r.id, noMax:+r.noMax.toFixed(2), over:+r.over.toFixed(2), face:r.face}); p.olRec = null; } }
const FIT_UP = 0.6;   // B-021: a blocker aims this far in front of his man's centre (was 0.85, x0.7 body width)
const DBL_ARC = 75*Math.PI/180, DBL_R = BODY_W + 0.05;   // B-025: while the battle blocker (d.bt.o) is locked on, the second man fits up on the defender's ring DBL_ARC round from him (centres 2*DBL_R*sin(arc/2) = 0.9 apart, clear of BODY_W), on the side he is already on
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
  let tx = d.x + side + vx/l*FIT_UP, ty = d.y + vy/l*FIT_UP;
  const o = side && d.bt && d.bt.o !== p ? d.bt.o : null;
  if(o){   // B-025: the locked pair owns the spot on its axis; the second man takes the ring spot beside it, not on it
    const ux = o.x - d.x, uy = o.y - d.y, ul = Math.hypot(ux, uy) || 1;
    if(p.dbl.ringO !== o){ p.dbl.ringO = o; p.dbl.ringS = Math.sign(ux*(p.y - d.y) - uy*(p.x - d.x)) || 1; }   // latched per battle blocker: the side can't flip when the pair swings round the axis; p.dbl is replaced when the double ends
    const s = p.dbl.ringS, c = Math.cos(DBL_ARC*s), n = Math.sin(DBL_ARC*s);
    tx = d.x + (ux*c - uy*n)/ul*DBL_R; ty = d.y + (ux*n + uy*c)/ul*DBL_R;
  }
  let f = p.beatT > 0 ? BEATEN_F : RUN_BLOCK_F;
  if(p.beatT > 0){   // B-073: beaten: plant (brake hard, no aiming past himself), then chase his man's hip from where he stands
    const r = noteBlocker(p); if(!r.b){ const sp = Math.hypot(p.vx, p.vy) || 1; r.b = {x:p.x, y:p.y, t:0, ux:p.vx/sp, uy:p.vy/sp}; }
    r.b.t += dt; r.over = Math.max(r.over, (p.x - r.b.x)*r.b.ux + (p.y - r.b.y)*r.b.uy); if(r.face < 0 && dist(p, d) < ENGAGE_R) r.face = r.b.t;
    if(p.beatT > BEATEN_T - BEAT_BRAKE_T && Math.hypot(p.vx, p.vy) > BEAT_STOP_V){ steer(p, p.x, p.y, 0, dt); return; }
    steer(p, tx, ty, p.spd*BEATEN_F, dt); return;   // his man's fit point (his offense-side hip), not his centre
  }
  if(p.dbl && p.dbl.state === 'climbing' && p.dbl.lb === d && p.beatT <= 0 && dist(p, d) >= ENGAGE_R){   // B-012 (climb-timing): before contact only (a landed climber blocks at block speed, no lead feedback): the climber runs to where the linebacker will be, at climb speed
    const k = Math.min(CLIMB_LEAD_T, dist(p, d)/Math.max(p.spd*CLIMB_F, 1));
    tx += d.vx*k; ty += d.vy*k; f = CLIMB_F;
  }
  steer(p, tx, ty, p.spd*f, dt);
}
const pulling = p => p.pull && p.pull.state === 'pulling';   // B-073: a puller whose pull is unresolved keeps the old no-target run (a puller with no target is B-074's)
const claimed = (p, d) => OFF.some(o => o !== p && o.blk === d);
// man / gap: the assignment is kept all play, even after getting beaten. Only a knocked-down
// defender (pancake) frees the blocker to go find someone else.
function block(p, dt){
  const ref = runRef();
  let d = p.blk;
  if(!d || d.stun > 0){ d = p.blk = pickBlock(p, ref); }
  if(!d){ if(p.role === 'WR' || pulling(p)){ steer(p, ref.x + (p.x > ref.x ? LEAD_X : -LEAD_X), ref.y + 3, p.spd*LEAD_F, dt); return; } if(p.nmX == null) p.nmX = p.x; noMan(p, ref, p.nmX, dt); return; }  // nobody left: a receiver leads upfield; the line stays near it (B-073)
  driveAt(p, d, ref, dt);
}
// B-073: nobody in my lane or climb area: stay near the line, help the nearest engaged lineman at the hole side, else hold a fixed spot shaded toward the hole at block speed
function noMan(p, ref, lane, dt){
  let h = null, t = null, hd = NM_HELP_R;
  for(const o of OFF){ if(o === p || !o.blk || !o.locked || o.blk.stun > 0 || o.role === 'WR') continue; const k = dist(o, p); if(k < hd && (o.x - p.x)*(ref.x - p.x) >= 0){ hd = k; h = o.blk; t = o; } }
  const r = noteBlocker(p); r.noMax = Math.max(r.noMax, p.y - S.los);
  p.blk = null; p.ruled = false;   // nothing is kept: the lane / climb search runs again next frame, so a backer or rusher crossing his face is picked up
  if(h){   // help: the second-man ring spot beside the teammate (B-025: DBL_R from his man, DBL_ARC round from the teammate), side latched per teammate; no p.blk (the pair stays one-on-one in blocking.js)
    const ux = t.x - h.x, uy = t.y - h.y, ul = Math.hypot(ux, uy) || 1;
    if(!p.nmSide || p.nmSide.t !== t) p.nmSide = {t, s: Math.sign(ux*(p.y - h.y) - uy*(p.x - h.x)) || 1};
    const s = p.nmSide.s, c = Math.cos(DBL_ARC*s), n = Math.sin(DBL_ARC*s);
    const tx = h.x + (ux*c - uy*n)/ul*DBL_R, ty = h.y + (ux*n + uy*c)/ul*DBL_R;
    if(dist(p, h) < ENGAGE_R) p.eng = 0.15;
    p.faceAt = h; steer(p, tx, ty, p.spd*RUN_BLOCK_F, dt); return;
  }
  p.nmSide = null;
  steer(p, lane + Math.max(-NM_SHADE_MAX, Math.min(NM_SHADE_MAX, (ref.x - lane)*NM_SHADE)), S.los + NM_DEPTH, p.spd*RUN_BLOCK_F, dt);
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
  if(!d){ p.climbing = true; if(p.role === 'WR' || pulling(p)) steer(p, lane, Math.max(p.y + 2, S.los + 3), p.spd*CLIMB_F, dt); else noMan(p, ref, lane, dt); return; }   // a receiver with no man still runs downfield to stalk (B-073 is the line)
  driveAt(p, d, ref, dt);
}
// B-074: the puller's new man when his target is down: unclaimed, standing, ahead of him, near the hole; the one nearest the hole side of him first (a man in his path counts via the distance to him)
const PULL_PICK_HOLE_W = 0.5;
function pullPick(p){
  const ref = runRef(); let best = null, bs = 1e9;
  for(const d of DEF){
    if(d.stun > 0 || dist(d, ref) > 15 || d.y < ref.y - 3 || d.y < p.y - BEHIND_Y || OFF.some(o => o !== p && o.blk === d)) continue;
    const k = dist(d, p) + PULL_PICK_HOLE_W*dist(d, ref); if(k < bs){ bs = k; best = d; }
  }
  return best;
}
function runBlock(p, dt){
  const play = PLAYS[S.play];
  if(p.pull) pullCheck(p, dt, pullPick);
  if(p.pull && p.pull.late && p.pull.t < p.pull.late && p.via && p.via.length){ steer(p, p.x, p.y, 0, dt); p.faceAt = p.blk; return; }   // B-032-3: a busting puller leaves late
  if(play.run && p.via && p.via.length && !(p.pull && p.pull.lost > 0 && p.via.length === 1)){   // (his man is down on the last leg: the B-074 hole run below takes over) pulling: get through the waypoints first
    const v = p.via[0];
    if(p.pull && p.via.length === 1 && p.blk === p.pull.tgt){ const lead = Math.min(PULL_LEAD_T, Math.hypot(p.blk.x - p.x, p.blk.y - p.y)/Math.max(Math.hypot(p.vx, p.vy), PULL_LEAD_V)); v.x = p.blk.x + p.pull.ox + p.blk.vx*lead; v.y = p.blk.y + p.blk.vy*lead; }   // B-061: the last waypoint is the target as he is now, not where he stood at the snap (the run-up now takes 1-2 s, he moves)
    const onTgt = p.pull && p.via.length === 1 && p.blk === p.pull.tgt;   // B-082: the last leg is the man himself (led ahead of him): the puller keeps pull speed until pullCheck engages him; he does not drop to block speed at the led point and trail a man running away
    if(!onTgt && Math.hypot(v.x - p.x, v.y - p.y) < PULL_VIA_R) p.via.shift();
    else {   // pulling: full speed through the waypoints (no arrive braking), quicker feet than a normal OL
      const dx = v.x - p.x, dy = v.y - p.y, l = Math.hypot(dx, dy) || 1, a = p.acc, t = p.turn, s = p.spd*PULL_V;
      p.acc *= PULL_ACC; p.turn *= PULL_TURN; steerVel(p, dx/l*s, dy/l*s, dt); p.acc = a; p.turn = t;
      p.faceAt = p.blk; return;   // eyes on the kick-out man
    }
  }
  if(p.pull && p.pull.state === 'pulling' && p.pull.lost > 0){ const r = runRef(); steer(p, r.x, r.y, p.spd*PULL_V, dt); return; }   // B-074: his man is down, reading the next one: runs at the hole at pull speed (no engage, no lock on the fallen man; pullCheck re-picks)
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
  if(p.role !== 'QB' && p !== (ball.holder)) logSpeed(p, p.spd);
  p.faceAt = null;
  if(S.phase === 'presnap'){ p.olRec = null; p.nmX = null; p.nmSide = null; }   // B-073: a fresh record and home spot each play
  else if(p.beatT <= 0 && p.olRec) p.olRec.b = null;
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
    if(inp.on){ p.auto = false; cutEnd(p); }   // B-072-3 (carrier-cuts)
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
    route(p, dt); return;
  }
  if(S.runMode){ runBlock(p, dt); return; }
  if(drawHold()){ p.blk = null; p.ruled = false; p.dbl = null; p.rr = null; }   // Draw: no run target in the pass set; the handoff re-read picks the man on him
  const r = olAssign(p), qx = QB.x - r.x, qy = QB.y - r.y, ql = Math.hypot(qx, qy) || 1;
  if(dist(p, r) < ENGAGE_R) p.eng = 0.15;
  p.faceAt = r;
  const k = 0.95 + (drawHold() ? DRAW_SET : 0);
  steer(p, r.x + qx/ql*k, r.y + qy/ql*k, p.spd*PASS_SET_F, dt);
}
