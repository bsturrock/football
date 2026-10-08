import { callout, toast } from './hud.js';
import { UPRIGHT_H, UPRIGHT_W, UPRIGHT_Y, gripGap, gripStrain, isBody, physBall, physDown, physDownC, physGrip, physPropped, physOff, physOn, physTouch, physTouched, physUngrip } from './physics.js';
import { BODY_W, DEF, QB } from './players.js';
import { endPlay } from './rules.js';
import { S } from './state.js';
import { clamp, dist, rand } from './util.js';

// ---------- tackling ----------
// Contact starts an attempt (ratings + momentum decide what the tackler gets), and from there it's bodies:
//   big hit: the tackler launches through him and the runner is knocked off his feet; the collision does the rest
//   run-through / bounce-off (B-063): the runner's weight x speed clearly beats the tackler's: the tackler is knocked off his feet (run-through) or staggers (bounce-off), the runner keeps most of his speed
//   slip:    the tackler dives and comes up empty
//   grab:    the tackler's hands lock onto him (arm = one hand, wrap = both), he plants and drives.
// The runner keeps his legs (bal) and drives on; a grip only holds as much force as the tackler's hands,
// so a strong runner tears out of an arm tackle. Takedown progress (tackler ratings vs break-tackle) bleeds
// his balance; when it's gone he falls the way the forces on him send him.
// Down (NFL): any part but a hand or foot on the turf (or his body resting on other players' bodies: physPropped, physics.js, B-010) AND a defender touched him within CONTACT_T (physics.js). An untouched
// runner on the turf is not down: he gets up and runs on.
// Runner states (c = ball holder), every row has its transition in tackleUpdate:
//   run        no fall; contact or off balance (up < 0.6, or down by contact) -> falling; back upright and slow -> physOff
//   falling    c.falling, bal 0; down by contact -> endPlay; on turf untouched and unheld for GETUP_WAIT s -> getting up (getUps+1)
//              not on the turf yet: keeps falling; falling for FALL_MAX_T s (c.fallAge), or GETUP_MAX get-ups used and on the turf -> endPlay
//   getting up falling false, ph.getUp, bal rising 1.2/s (physStep); bal 1 clears getUp -> run (here, runner only); falling again (a tackle, a latch,
//              down by contact) -> falling, with getUp cleared on the next tackleUpdate (one frame of bal rise, harmless)
//   any state  ball dead (touchdown, out of bounds, endPlay elsewhere): tackleUpdate stops, physStep rests him, or a get-up in progress finishes (physOff when upright); the next setup's physClear removes what is left
const GETUP_WAIT = 0.3, GETUP_MAX = 3, FALL_MAX_T = 4, FALL_SETTLE = 0.4;   // s on the turf before he gets up, tries per body, play-ending fall time, s before a fresh body may get up
export const PLANT_A = 7;
// B-063 (tackle-momentum): the runner's weight times speed into the hit, against the tackler's, decides a clear win.
// edge = (resist - hit)/tackler mass, per the tackler's tackling (yd/s); over THRU_EDGE the runner runs through (tackler off his feet,
// runner keeps most of his speed), over BOUNCE_EDGE the tackler bounces off (staggered, runner slowed a little), else the grab roll below.
const THRU_EDGE = 6, BOUNCE_EDGE = 4.5, EDGE_NOISE = 0.5, THRU_KEEP = 0.9, BOUNCE_KEEP = 0.8;
// S.tkLog: contact outcomes for the sim readout (sim.js reads it through S, so it imports nothing from here): {o: 'big'|'thru'|'bounce'|'evade'|'grab', edge, t (S.clock, s), cm, dm} (cm, dm: weight x speed into the hit)
const logTk = (o, edge, c, d) => { const L = S.tkLog || (S.tkLog = []); if(L.length < 20000) L.push({o, edge, t:+S.clock.toFixed(2), cm:c.mass*Math.hypot(c.vx, c.vy), dm:d.mass*Math.hypot(d.vx, d.vy)}); };
const PILE_HOLD_K = 3, PILE_HOLD_MIN = 0.2;   // feature (pile-push): teammates' surge keeps him up: downP rate x max(PILE_HOLD_MIN, 1/(1 + K*offensive pushers)); the floor 0.2 bounds the slowdown at 5x, and pile.js whistles (STALL_T 1.0 s stalled, PUSH_MAX_T 1.5 s of pushing) so the hold is never open-ended
export const gripK = d => (d.grip === 'wrap' ? 1 : 0.5)*(d.rTkl/80);
function tackleNote(c){ return c === QB && !S.runMode ? 'SACKED' : null; }
// a teammate already has him (or he's going down): no open-field duel, just get on him and finish it
function joinPile(d, c, dd){
  const nx = (c.x - d.x)/dd, ny = (c.y - d.y)/dd;
  d.latch = c; d.grip = 'wrap'; d.act = 'wrap'; d.actT = 99; d.faceAt = c;
  physOn(d, {bal:c.falling ? 0 : 0.6, vx:d.vx + nx*2.6, vy:d.vy + ny*2.6, up:0.25});
  physGrip(d, c, 'wrap');
  callout(d, 'Piles on', 'bad');
}
function attemptTackle(d, c, dd){
  if(c.falling || DEF.some(o => o !== d && o.latch === c)){ joinPile(d, c, dd); return; }
  const nx = (c.x - d.x)/dd, ny = (c.y - d.y)/dd;               // tackler -> runner
  const cs = Math.hypot(c.vx, c.vy);
  // Momentum along the line of impact: the tackler's speed into the runner beyond what the runner carries
  // away from him, against the runner's momentum back into the hit.
  const cAway = c.vx*nx + c.vy*ny, dInto = d.vx*nx + d.vy*ny;
  const hit = d.mass*Math.max(0, dInto - Math.max(0, cAway)), resist = c.mass*Math.max(0, -cAway);
  const headOn = cs > 0.5 ? -(c.vx*nx + c.vy*ny)/cs : 0;          // 1: runner coming straight at him, -1: running away
  d.face = Math.atan2(c.x - d.x, d.y - c.y);
  const bigScore = (hit - resist)/c.mass*(d.rTkl/80) + rand(-1, 1);
  const edge = (resist - hit)/d.mass*(80/d.rTkl);
  if(bigScore > 3.0){
    logTk('big', edge, c, d);
    // he's knocked off his feet; the tackler launches through him, wraps, and the bodies collide for real
    c.falling = true; c.act = 'fall'; c.actT = 99;
    physOn(c, {bal:0});
    d.latch = c; d.grip = 'wrap'; d.act = 'wrap'; d.actT = 99; d.faceAt = c;
    physOn(d, {bal:0, vx:d.vx + nx*3.5, vy:d.vy + ny*3.5, up:0.5});   // launches through him
    physGrip(d, c, 'wrap');
    callout(d, 'BOOM!', 'bad'); toast('BIG HIT');
    return;
  }
  const runEdge = edge + rand(-EDGE_NOISE, EDGE_NOISE);
  if(runEdge > BOUNCE_EDGE){
    const thru = runEdge > THRU_EDGE, k = thru ? THRU_KEEP : BOUNCE_KEEP;
    logTk(thru ? 'thru' : 'bounce', edge, c, d);
    c.vx *= k; c.vy *= k; physTouch(c);   // the hit counts as contact: down if he falls after it
    d.tkCool = 2;
    if(thru){   // knocked back and off his feet, comes up later
      d.stun = 1.6; d.act = 'dive'; d.actT = 1.6;
      physOn(d, {bal:0, vx:d.vx - nx*3, vy:d.vy - ny*3, up:0.6, ttl:1.4});
    } else {    // staggers back on his feet
      d.stun = 0.9; d.vx -= nx*2.5; d.vy -= ny*2.5;
    }
    callout(d, thru ? 'Run over!' : 'Bounced off', 'good');
    return;
  }
  const slide = Math.abs((c.vx - d.vx)*ny - (c.vy - d.vy)*nx);   // relative speed across the line of impact
  const evade = c.rBrk*0.6 + slide*4 + (headOn < -0.3 ? 8 : 0) + rand(-12, 12);
  const grab = d.rTkl + rand(-12, 12);
  if(evade > grab + 12){
    logTk('evade', edge, c, d);
    d.stun = 1.6; d.act = 'dive'; d.actT = 1.6; d.tkCool = 2;
    physOn(d, {bal:0, vx:d.vx + nx*1.5, vy:d.vy + ny*1.5, up:1, ttl:1.2});   // dives at where he was and comes up empty
    callout(d, slide > 4 ? 'Juked!' : 'Slipped it', 'good');
    return;
  }
  logTk('grab', edge, c, d);
  d.latch = c; d.grip = headOn < -0.3 || grab < evade + 5 ? 'arm' : 'wrap';
  d.act = 'wrap'; d.actT = 99; d.faceAt = c;
  physOn(c, {bal:1});
  physOn(d, {bal:0.8, vx:d.vx + nx*2.6, vy:d.vy + ny*2.6, up:0.25});   // shoots his hips and shoulder into him
  physGrip(d, c, d.grip);
  callout(d, d.grip === 'arm' ? 'Arm tackle' : 'Wrapped up', 'bad');
}
function release(d, stun){ d.churn = false;
  d.latch = null; d.faceAt = null; d.stun = stun; d.act = 'dive'; d.actT = stun; d.tkCool = 1.5;
  physUngrip(d); if(d.ph){ d.ph.bal = 0; d.ph.ttl = d.ph.t + stun; }   // ripped off his feet, gets back up
}
export function tackleUpdate(c, dt){
  if(!c.falling) c.fallAge = 0;
  if(c.ph && c.ph.getUp && !c.falling && c.ph.bal >= 1) c.ph.getUp = false;   // up on his legs: the get-up is over (runner only; other bodies keep theirs)
  if(c.ph && c.ph.getUp && (c.falling || DEF.some(d => d.latch === c))) c.ph.getUp = false;   // tackled mid get-up: his legs don't come back
  if(c.falling){
    // until he's down, anyone who gets there piles on
    for(const d of DEF) if(!d.latch && !isBody(d) && !(d.stun > 0) && !d.bt && dist(d, c) < 1.6*BODY_W) joinPile(d, c, dist(d, c) || 1);
    c.fallAge += dt;
    const down = !!c.ph && (physDown(c) || physPropped(c)), by = down && physTouched(c), ups = c.ph ? c.ph.getUps || 0 : 0;   // physDown once per frame
    if(!down) c.fallT = 0;
    // on the turf with no defender on him for CONTACT_T: not down, he gets up and runs on (GETUP_MAX tries, then the play ends: never a hang)
    else if(!by && !DEF.some(d => d.latch === c) && c.ph.t > FALL_SETTLE && ups < GETUP_MAX && (c.fallT = (c.fallT || 0) + dt) > GETUP_WAIT){
      c.ph.getUps = ups + 1; c.falling = false; c.act = null; c.fallT = 0; c.ph.getUp = true; return;
    }
    if(!c.ph || by || c.fallAge > FALL_MAX_T || ups >= GETUP_MAX && down) endPlay('spot', c.ph ? 50 - physBall(c).z : c.y, tackleNote(c));   // ball spotted where he's down
    return;
  }
  if(c.tripT > 0) c.tripT -= dt;
  for(const d of DEF){
    if(d.latch || d.stun > 0 || d.tkCool > 0 || isBody(d)) continue;
    const dd = dist(d, c);
    if(d.bt){
      // blocked: can't tackle, but can reach out and grab a piece of him as he goes by
      if(dd < 1.6*BODY_W && !(d.reachCool > 0)){
        d.reachCool = 1.0;
        const juke = clamp((c.latAcc - 4)/6, 0, 1);
        if(Math.random() < 0.6*(d.rTkl/80)*(1 - juke*0.5)*(70/c.rBrk)){
          c.vx *= 0.6; c.vy *= 0.6; c.tripT = 0.4;
          physTouch(c); callout(d, 'Got a hand on him', 'bad');
        }
      }
      continue;
    }
    if(dd > 1.3*BODY_W){
      // open field (past the line, no blocker on him): a defender closing within 2 yd dives at him.
      // The physics decides whether his hands get there; if not he comes up empty.
      const close = ((c.x - d.x)*(d.vx - c.vx) + (c.y - d.y)*(d.vy - c.vy))/dd;
      if(dd > 2*BODY_W || close < 1 || c.y < S.los + 2) continue;
    }
    attemptTackle(d, c, dd);
    if(S.phase !== 'live' || c.falling) return;
  }
  let holding = false;
  for(const d of DEF){
    if(d.latch !== c) continue;
    if(d.ph && d.ph.reach){ if(d.ph.reach.t > 0.5){ release(d, 1.2); callout(c, 'Broke free!', 'good'); } else holding = true; continue; }
    d.slip = Math.max(0, (d.slip || 0) + (gripStrain(d) > 1 ? dt : -dt*0.5));   // pulled harder than he can hold: hands sliding off
    if(gripGap(d) > 0.45 || d.slip > 0.15){ d.slip = 0; release(d, 1.0); callout(c, 'Broke free!', 'good'); continue; }   // tore out of his hands
    holding = true;
    d.churn = d.grip === 'wrap' && !c.falling;   // driving his legs through him
    const hold = S.pile && S.pile.state === 'pushing' && S.pile.pushersO >= 1 ? Math.max(PILE_HOLD_MIN, 1/(1 + PILE_HOLD_K*S.pile.pushersO)) : 1;   // feature (pile-push)
    c.downP += (d.grip === 'wrap' ? 3.4 : 0.7)*(d.rTkl/80)*hold*dt;   // one hand alone rarely finishes him; it buys time for help
  }
  c.slow = c.tripT > 0 ? 0.7 : 1;
  c.churn = holding;   // held up: legs keep pumping
  if(!holding){
    c.downP = Math.max(0, c.downP - dt*0.8);
    if(c.ph && !DEF.some(d => d.ph && (d.ph.grips.some(g => g.on === c) || (d.ph.reach && d.ph.reach.on === c)))){
      // CANNON is the global main.js sets after loading cannon-es (physics.js uses it the same way)
      const tb = c.ph.bodies[0], up = tb.quaternion.vmult(new CANNON.Vec3(0, 1, 0)).y;
      if(physDownC(c) || !(c.ph.getUp && c.ph.bal < 1) && up < 0.6){ c.falling = true; c.act = 'fall'; c.actT = 99; c.ph.bal = 0; }   // off balance: he's going down; getting up, only a fresh touch puts him down again
      else if(c.ph.t > FALL_SETTLE && up > UPRIGHT_Y && tb.angularVelocity.length() < UPRIGHT_W && tb.position.y > UPRIGHT_H) physOff(c);   // back on balance: back on the run
    }
    return;
  }
  const lim = c.rBrk/80;
  if(c.ph) c.ph.bal = 1 - 0.5*Math.min(1, c.downP/lim);           // legs buckling under the weight
  if(c.downP >= lim){
    c.falling = true; c.act = 'fall'; c.actT = 99;
    if(c.ph) c.ph.bal = 0;                                         // legs gone: forces on him decide the fall
    DEF.forEach(d => { if(d.latch === c && d.ph) d.ph.bal = 0; });
  }
}
