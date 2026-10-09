import { callout } from './hud.js';
import { runRef } from './offense.js';
import { isBody, physOn } from './physics.js';
import { ALL, TE } from './players.js';
import { S } from './state.js';
import { HW, LOCK_D, clamp, dist, rand, sigmoid } from './util.js';

// ---------- line battle ----------
// A battle is a loop of discrete moves:
//   set (0.2-0.4s hand fighting) -> move (0.45s, swim or bull rush) -> resolved on the spot
//   win: he bursts past.  lose: blocker takes control for a recovery (REC_LO-REC_HI s), then he sets up again.
// Win chance comes from the rating matchup for that move (speed: rSpd vs rAgi, power: rPow vs rStr).
// Run blocking favours the blocker (he fires out first); pass rush is an even fight.
const MOVE_TIME = 0.45;
// B-020: a battle end gives the defender his own facing back, but only if it is the block's (never a tackle's faceAt: tackling.js sets that with d.latch)
export function unface(d){
  const t = d.faceAt, b = d.bt;
  if(t && !d.latch && b && (t === b.o || t.blk === d)) d.faceAt = null;
}
// B-023 engagement lock: a pair in a battle is one unit. Each frame the pair's axis (b.ang, the bearing blocker -> defender, 0 = straight upfield) turns
// toward its leverage axis (the defender's gap side, LEV_ANGLE off upfield) or, in a swim move, around the blocker's shoulder; the defender's spot is then the
// blocker's plus CONTACT_D along the axis, pulled there at LOCK_K (1/s), split by mass. The defender never steers himself while the battle lives (defense.js).
// B-065 gap hold: defense.js gives the pair its gap each frame (b.gx: the defender's gap x, or null = a two-gapper before his read, square). The leverage target then comes from the strength
// matchup w = (defender rPow - blocker rStr)/LEV_SPAN (-1..1): a defender who wins (w > 0) turns the pair so his gap shoulder is free (the blocker on the far side of him, up to LEV_ANGLE, square when he has no gap yet);
// a blocker who wins (w < 0) turns him the old way, onto the hole side's far shoulder. The drive's sideways push (driveMove) is scaled the same way (LAT_EVEN at an even matchup, 0 to 1 over +-LEV_SPAN).
const LEV_SPAN = 20, LAT_EVEN = 0.5, FIGHT_V = 0.5, FIGHT_STOP = 0.2;   // FIGHT_V: yd/s the defender works the pair toward his gap, x (1 - the lateral share the blocker keeps), until within FIGHT_STOP yd of it
const CONTACT_D = LOCK_D, LOCK_K = 60, LEV_ANGLE = 18*Math.PI/180, LEV_RATE = 40*Math.PI/180, LEV_REACH = 70*Math.PI/180, SWIM_RATE = 70*Math.PI/180;
// B-062 drive at real speed: a locked pair moves at DRIVE_EVEN yd/s on an even matchup, +DRIVE_SLOPE per point of the blocker's rStr over the defender's rPow, from a stall (0) at about -16 points up to DRIVE_MAX;
// scaled by the blocker's push share (o.push/OL_PUSH: a TE or back drives less than a lineman) and the phase (DRIVE_SET/DRIVE_RECOVER). A strong defender anchors (drive 0); a strong blocker stays under about 1.5 yd/s.
// The legs take short steps (STEP_L yd, about 7 in) at a cadence that follows the pair's speed, floor STEP_MIN churning in place (stepHz, shared with animation.js and the sim readout).
const DRIVE_EVEN = 0.8, DRIVE_SLOPE = 0.05, DRIVE_MAX = 1.4, OL_PUSH = 2.5, BULL_V = 0.25, V_EMA = 8;
export const STEP_L = 0.19, STEP_MIN = 2.5, STEP_MAX = 7.5;
export const stepHz = v => clamp(v/STEP_L, STEP_MIN, STEP_MAX);   // steps per second of one foot-fall (two to a stride)
export const driveV = (o, d) => clamp(DRIVE_EVEN + (o.rStr - d.rPow)*DRIVE_SLOPE, 0, DRIVE_MAX)*Math.min(1, o.push/OL_PUSH);   // yd/s the blocker moves his man at in full drive
const DRIVE_SET = 0.7, DRIVE_RECOVER = 1, DRIVE_RAMP_T = 0.3;
export const CARRY_T = 0.3;   // B-023 rebalance: drive strength per phase (x driveV); the drive builds in over DRIVE_RAMP_T s; the pair first coasts on the momentum of the hit (b.cv, set by defense.js pop), fading over CARRY_T s, so a defender's charge carries before the drive takes over
const OL_BIAS = -0.8, REC_LO = 0.4, REC_HI = 0.8, SET_LO = 0.2, SET_HI = 0.4;   // the win-roll offset for a linemen's run block (was -1.4), the recovery and set times (s; were 0.8-1.4)
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
export function lock(d, o, b, dt, c){   // B-067: exported for defoff.js
  if(b.phase === 'move' && b.move === 'speed'){   // swim: work around the blocker's ball-side shoulder
    const ang = wrapA(b.ang), side = Math.sign(c.x - d.x) || Math.sign(ang) || 1;
    b.ang += side*SWIM_RATE*dt;
  } else {
    const ref = runRef(), away = (Math.sign(d.x - ref.x) || 1)*LEV_ANGLE;
    let tgt = away;
    if(b.gx !== undefined){
      const w = clamp((d.rPow - o.rStr)/LEV_SPAN, -1, 1), gs = b.gx === null || Math.abs(b.gx - d.x) <= FIGHT_STOP ? 0 : Math.sign(b.gx - d.x);   // dead band: on his gap the pair holds square, no flip at each crossing
      tgt = w >= 0 ? w*gs*LEV_ANGLE : -w*away;
    }
    const diff = wrapA(tgt - b.ang);
    if(Math.abs(diff) < LEV_REACH) b.ang += clamp(diff, -LEV_RATE*dt, LEV_RATE*dt);
  }
  const ex = o.x + Math.sin(b.ang)*CONTACT_D - d.x, ey = o.y + Math.cos(b.ang)*CONTACT_D - d.y, k = Math.min(1, LOCK_K*dt), wd = o.mass/(o.mass + d.mass);
  d.x += ex*k*wd; d.y += ey*k*wd; o.x -= ex*k*(1 - wd); o.y -= ey*k*(1 - wd);
  d.vx = o.vx; d.vy = o.vy;   // one unit: he moves as the blocker moves
}
export function battle(d, o, c, dt){
  const b = d.bt;
  // B-062: movement.js still steers the blocker at his run-block speed toward the man he is on (about 1.6 yd/s of free travel for the pair); a locked pair moves only by the battle below, so that travel is taken back.
  // Only on a run play, only for the battle that owns the blocker (o.bt === b: a second defender sharing him leaves him alone) and only while this man is his job (o.blk === d or nobody): a blocker with another live assignment (a stunt pass-off, a climb) is let go.
  const undo = S.runMode && o.bt === b && (o.blk === d || !o.blk) && b.ox !== undefined && S.clock - b.oxT < 0.1;
  if(undo){ o.x = b.ox; o.y = b.oy; }
  battleStep(d, o, c, dt);
  if(d.bt === b) lock(d, o, b, dt, c);
  if(d.bt === b){   // B-062: the pair's measured speed (yd/s, smoothed): the defender's travel since the last battle call; animation.js sets the leg cadence from it
    if(b.px !== undefined && dt > 0) b.v = (b.v || 0) + (Math.hypot(d.x - b.px, d.y - b.py)/dt - (b.v || 0))*Math.min(1, V_EMA*dt);
    if(undo && dt > 0){ o.vx = d.vx = (o.x - b.ox)/dt; o.vy = d.vy = (o.y - b.oy)/dt; }   // the pair's velocity is what the battle moved it by, not the steering's
    b.px = d.x; b.py = d.y; if(o.bt === b){ b.ox = o.x; b.oy = o.y; b.oxT = S.clock; }
  }
}
// B-067: one drive step, m yd, of the pair away from the hole (also used by defoff.js, where nobody battles)
export function driveMove(d, o, m, lat = 1){
  const ax = d.x - o.x, ay = d.y - o.y, al = Math.hypot(ax, ay) || 1;
  const ref = runRef(), away = Math.sign(d.x - ref.x) || 1;
  const px = ax/al + away*0.6*lat, py = ay/al + 0.9, k = Math.hypot(px, py) || 1;
  d.x += px/k*m; d.y += py/k*m; o.x += px/k*m; o.y += py/k*m;
}
function battleStep(d, o, c, dt){
  const b = d.bt; b.t += dt; b.age = (b.age || 0) + dt;
  if(b.cv && b.age < CARRY_T){ const k = (1 - b.age/CARRY_T)*dt; d.x += b.cv.x*k; d.y += b.cv.y*k; o.x += b.cv.x*k; o.y += b.cv.y*k; }   // B-023: coast on the hit
  const ramp = DRIVE_RAMP_T > 0 ? Math.min(1, b.age/DRIVE_RAMP_T) : 1;   // the first contact carries the defender's own charge: the drive builds in over DRIVE_RAMP_T s
  const ax = d.x - o.x, ay = d.y - o.y, al = Math.hypot(ax, ay) || 1;     // blocker -> defender
  const cx = c.x - d.x, cy = c.y - d.y, cl = Math.hypot(cx, cy) || 1;     // defender -> ball
  // blocker in control (run plays): drive him back and away from the hole to open the gap.
  // How fast depends on the strength matchup: a good blocker on a weak defender moves him up to DRIVE_MAX (1.4) yd/s (B-062).
  const lat = b.gx === undefined ? 1 : clamp(LAT_EVEN + (o.rStr - d.rPow)/(2*LEV_SPAN), 0, 1);   // B-065
  if(S.runMode && typeof b.gx === 'number' && Math.abs(b.gx - d.x) > FIGHT_STOP){   // B-065: he fights toward his gap; a stronger blocker's lateral drive (above) outweighs it
    const m = Math.sign(b.gx - d.x)*FIGHT_V*(1 - lat)*ramp*dt; d.x += m; o.x += m;
  }
  const drive = f => { if(S.runMode) driveMove(d, o, driveV(o, d)*f*ramp*dt, lat); };
  if(b.phase === 'set'){
    drive(DRIVE_SET);
    if(b.t >= b.dur){
      b.phase = 'move'; b.t = 0;
      b.move = Math.random() < d.rSpd/(d.rSpd + d.rPow) ? 'speed' : 'power';
      callout(d, b.move === 'speed' ? 'Swim' : 'Bull rush');
    }
    return;
  }
  if(b.phase === 'move'){
    const speed = b.move === 'speed';
    if(speed){   // swim / rip: work toward the blocker's ball-side shoulder
      const sx = -ay/al, sy = ax/al, s = Math.sign(sx*cx + sy*cy) || 1;
      d.x += sx*s*0.9*dt; d.y += sy*s*0.9*dt;
    } else {     // bull rush: jolt the blocker back toward the ball
      const f = (S.runMode ? BULL_V : 0.8)*dt; d.x += cx/cl*f; d.y += cy/cl*f; o.x += cx/cl*f; o.y += cy/cl*f;
    }
    if(b.t < MOVE_TIME) return;
    const diff = speed ? d.rSpd - o.rAgi : d.rPow - o.rStr;
    const pWin = sigmoid(diff/(speed ? 9 : 12) + (S.runMode ? (o.role === 'OL' || o === TE ? OL_BIAS : 0.3) : 0));   // linemen fire out first; a receiver's stalk block gets shed   // speed: boom or bust
    if(Math.random() < pWin){
      d.freeFrom = o; d.freeT = 0.9; o.beatT = 0.9; unface(d); d.bt = o.bt = null;
      d.x += cx/cl*0.8; d.y += cy/cl*0.8;
      callout(d, 'Beat him!', 'bad');
      return;
    }
    // stuffed. A bull rush into a much stronger blocker can end up on its back.
    if(!speed && d.role === 'DL' && o.rStr - d.rPow + rand(0, 40) > 58){   // only a much stronger blocker, only in the trenches
      d.stun = 1.6; d.act = 'down'; d.actT = 1.6; d.fallDir = -1; unface(d); d.bt = o.bt = null;
      physOn(d, {vx:(d.x - o.x)*2.5, vy:(d.y - o.y)*2.5, up:0.3, bal:0, ttl:1.4});
      callout(d, 'Pancaked!', 'good');
      return;
    }
    callout(d, 'Stonewalled', 'good');
    b.phase = 'recover'; b.t = 0; b.dur = rand(REC_LO, REC_HI);
    return;
  }
  // recover: blocker has the upper hand until the defender resets
  drive(DRIVE_RECOVER);
  if(b.t >= b.dur){ b.phase = 'set'; b.t = 0; b.dur = rand(SET_LO, SET_HI); }
}
// Pancake on contact: the blocker's momentum into the defender, per defender mass, scaled by blocker strength
// against defender power. A pulling guard or climbing tackle at speed into a linebacker or DB can put him on
// his back; a lineman squared up at the line almost never does. Both become bodies for the collision: the
// blocker stays on his feet driving through, the defender is knocked off his and needs a moment to get up.
// B-092: a full-speed pull (7-7.5 yd/s, a guard into a set edge or an LB) scores about 6.5-11 here, so at 6.5 it flattened
// him as often as not; a kick-out or wrap usually just moves the man and a pancake is the exception, for a blocker clearly
// stronger or a defender already moving off balance (his own back-momentum is taken off the score). One bar for every blocker.
const PANCAKE_AT = 8;
export function pancakeHit(o, d){
  if(o.ph || isBody(d) || !S.runMode) return false;
  const l = dist(o, d) || 1, nx = (d.x - o.x)/l, ny = (d.y - o.y)/l;
  // the blocker's momentum into him beyond the defender's own momentum back into the block
  const into = o.vx*nx + o.vy*ny, back = -(d.vx*nx + d.vy*ny);
  const close = into + Math.max(0, back);
  const score = (o.mass*Math.max(0, into) - d.mass*Math.max(0, back))/d.mass*(o.rStr/80)/(d.rPow/70)*rand(0.8, 1.2);
  if(score < PANCAKE_AT) return false;
  const L = S.pancakeLog || (S.pancakeLog = {}), pk = o.pull ? o.pull.kind : 'other'; L[pk] = (L[pk] || 0) + 1;   // B-092: the sim's count by pull kind (kick, wrap, lead, trap; other = not a puller); sim.js reads it through S
  const k = close*o.mass/(o.mass + d.mass)*1.6;                     // what the hit hands the defender
  d.stun = 2.4; d.act = 'down'; d.actT = 2.4; d.fallDir = -1; unface(d); d.bt = o.bt = null;
  physOn(d, {bal:0, vx:d.vx + nx*k, vy:d.vy + ny*k, up:0.4, ttl:1.8});
  physOn(o, {bal:1, ttl:0.4});                                      // he runs through it
  callout(o, 'Pancake!', 'good');
  return true;
}
// bodies push each other apart by mass, so a runner can squeeze past a blocked defender
const SEP_R = 0.56;   // B-021: bodies closer than this are pushed apart (was 0.8, x0.7 body width)
export function separate(){
  for(let i = 0; i < ALL.length; i++) for(let j = i+1; j < ALL.length; j++){
    const a = ALL[i], b = ALL[j];
    if(a.latch === b || b.latch === a || a.ph || b.ph || (a.bt && a.bt === b.bt)) continue;   // B-023: a locked pair holds its own contact distance   // physical bodies collide in the physics world
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if(d > 0 && d < SEP_R){
      const over = SEP_R - d, nx = dx/d, ny = dy/d, wa = b.mass/(a.mass + b.mass), wb = 1 - wa;
      a.x -= nx*over*wa; a.y -= ny*over*wa; b.x += nx*over*wb; b.y += ny*over*wb;
    }
  }
  for(const p of ALL){ p.x = clamp(p.x, -HW-4, HW+4); p.y = clamp(p.y, -11, 111); }
}
