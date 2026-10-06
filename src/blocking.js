import { callout } from './hud.js';
import { runRef } from './offense.js';
import { physOn } from './physics.js';
import { ALL, TE } from './players.js';
import { S } from './state.js';
import { HW, clamp, dist, rand, sigmoid } from './util.js';

// ---------- line battle ----------
// A battle is a loop of discrete moves:
//   set (0.2-0.4s hand fighting) -> move (0.45s, swim or bull rush) -> resolved on the spot
//   win: he bursts past.  lose: blocker takes control for a 0.8-1.4s recovery, then he sets up again.
// Win chance comes from the rating matchup for that move (speed: rSpd vs rAgi, power: rPow vs rStr).
// Run blocking favours the blocker (he fires out first); pass rush is an even fight.
const MOVE_TIME = 0.45;
export function battle(d, o, c, dt){
  const b = d.bt; b.t += dt;
  const ax = d.x - o.x, ay = d.y - o.y, al = Math.hypot(ax, ay) || 1;     // blocker -> defender
  const cx = c.x - d.x, cy = c.y - d.y, cl = Math.hypot(cx, cy) || 1;     // defender -> ball
  // blocker in control (run plays): drive him back and away from the hole to open the gap.
  // How fast depends on the strength matchup: a good blocker on a weak defender moves him 2-3 yd/s.
  const drive = f => {
    if(!S.runMode) return;
    const ref = runRef(), away = Math.sign(d.x - ref.x) || 1;
    const px = ax/al + away*0.6, py = ay/al + 0.9, k = Math.hypot(px, py) || 1;
    const m = o.push*f*clamp(1 + (o.rStr - d.rPow)/40, 0.3, 1.8)*dt;
    d.x += px/k*m; d.y += py/k*m; o.x += px/k*m; o.y += py/k*m;
  };
  if(b.phase === 'set'){
    drive(0.7);
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
      const f = 0.8*dt; d.x += cx/cl*f; d.y += cy/cl*f; o.x += cx/cl*f; o.y += cy/cl*f;
    }
    if(b.t < MOVE_TIME) return;
    const diff = speed ? d.rSpd - o.rAgi : d.rPow - o.rStr;
    const pWin = sigmoid(diff/(speed ? 9 : 12) + (S.runMode ? (o.role === 'OL' || o === TE ? -1.4 : 0.3) : 0));   // linemen fire out first; a receiver's stalk block gets shed   // speed: boom or bust
    if(Math.random() < pWin){
      d.freeFrom = o; d.freeT = 0.9; o.beatT = 0.9; d.bt = o.bt = null;
      d.x += cx/cl*0.8; d.y += cy/cl*0.8;
      callout(d, 'Beat him!', 'bad');
      return;
    }
    // stuffed. A bull rush into a much stronger blocker can end up on its back.
    if(!speed && d.role === 'DL' && o.rStr - d.rPow + rand(0, 40) > 58){   // only a much stronger blocker, only in the trenches
      d.stun = 1.6; d.act = 'down'; d.actT = 1.6; d.fallDir = -1; d.bt = o.bt = null;
      physOn(d, {vx:(d.x - o.x)*2.5, vy:(d.y - o.y)*2.5, up:0.3, bal:0, ttl:1.4});
      callout(d, 'Pancaked!', 'good');
      return;
    }
    callout(d, 'Stonewalled', 'good');
    b.phase = 'recover'; b.t = 0; b.dur = rand(0.8, 1.4);
    return;
  }
  // recover: blocker has the upper hand until the defender resets
  drive(1.4);
  if(b.t >= b.dur){ b.phase = 'set'; b.t = 0; b.dur = rand(0.2, 0.4); }
}
// Pancake on contact: the blocker's momentum into the defender, per defender mass, scaled by blocker strength
// against defender power. A pulling guard or climbing tackle at speed into a linebacker or DB can put him on
// his back; a lineman squared up at the line almost never does. Both become bodies for the collision: the
// blocker stays on his feet driving through, the defender is knocked off his and needs a moment to get up.
const PANCAKE_AT = 6.5;
export function pancakeHit(o, d){
  if(o.ph || d.ph || !S.runMode) return false;
  const l = dist(o, d) || 1, nx = (d.x - o.x)/l, ny = (d.y - o.y)/l;
  // the blocker's momentum into him beyond the defender's own momentum back into the block
  const into = o.vx*nx + o.vy*ny, back = -(d.vx*nx + d.vy*ny);
  const close = into + Math.max(0, back);
  const score = (o.mass*Math.max(0, into) - d.mass*Math.max(0, back))/d.mass*(o.rStr/80)/(d.rPow/70)*rand(0.8, 1.2);
  if(score < PANCAKE_AT) return false;
  const k = close*o.mass/(o.mass + d.mass)*1.6;                     // what the hit hands the defender
  d.stun = 2.4; d.act = 'down'; d.actT = 2.4; d.fallDir = -1; d.bt = o.bt = null;
  physOn(d, {bal:0, vx:d.vx + nx*k, vy:d.vy + ny*k, up:0.4, ttl:1.8});
  physOn(o, {bal:1, ttl:0.4});                                      // he runs through it
  callout(o, 'Pancake!', 'good');
  return true;
}
// bodies push each other apart by mass, so a runner can squeeze past a blocked defender
export function separate(){
  for(let i = 0; i < ALL.length; i++) for(let j = i+1; j < ALL.length; j++){
    const a = ALL[i], b = ALL[j];
    if(a.latch === b || b.latch === a || a.ph || b.ph) continue;   // physical bodies collide in the physics world
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if(d > 0 && d < 0.8){
      const over = 0.8 - d, nx = dx/d, ny = dy/d, wa = b.mass/(a.mass + b.mass), wb = 1 - wa;
      a.x -= nx*over*wa; a.y -= ny*over*wa; b.x += nx*over*wb; b.y += ny*over*wb;
    }
  }
  for(const p of ALL){ p.x = clamp(p.x, -HW-4, HW+4); p.y = clamp(p.y, -11, 111); }
}
