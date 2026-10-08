import { OFF } from './players.js';
import { dist } from './util.js';
import { steer } from './movement.js';
import { driveMove, driveV, lock } from './blocking.js';
import { S } from './state.js';

// B-066 defense-off mode (?def=off): a defender stands where he is in his stance and only a blocker moves him. No AI, no tackle, no battle, no shed, no physics calls.
// B-067: a run blocker on his man (o.blk === d) that gets within DRIVE_D locks to him as in B-062 (blocking.js lock: contact distance and the leverage turn) and drives him at driveV with the battle's ramp
// for as long as he stays on him (until DRIVE_KEEP), no target spot, no shed; the blocker's own steering that frame is taken back, as battle() does. Any other contact keeps the closing-speed push below.
// A blocker in contact (within PUSH_D, closing on him) pushes him along his own motion, split by mass; blocking.js separate() keeps the bodies apart as always.
export const DEF_OFF_WHISTLE = 6;   // s after the snap: the play ends here unless it ended sooner (touchdown, out of bounds)
const PUSH_D = 0.9, PUSH_MIN_V = 0.3, DRIVE_D = 1.5, DRIVE_KEEP = 2.2, DRIVE_RAMP = 0.3;
const fresh = t => t !== undefined && S.clock - t >= 0 && S.clock - t < 0.1;   // stamped last frame (S.clock restarts at 0 on a snap, so a stamp from the last play reads as negative)
export function defOffStep(d, dt){
  d.stun = 0; d.latch = null; d.bt = null;
  if(d.dof && !fresh(d.dof.T)) d.dof = null;   // a drive left over from an earlier play is dropped
  if(d.dof) { d.vx = d.vy = 0; }   // a driven man moves only by the drive below (his velocity is the pair's, set there: braking on it would move him again)
  else steer(d, d.x, d.y, 0, dt);   // brake to a halt, facing and stance as they stand
  let driven = false;
  for(const o of OFF){
    if(o.ph) continue;
    const g = d.dof && d.dof.o === o ? d.dof : null, r = dist(o, d);
    const own = d.dof && d.dof.o !== o && d.dof.o.blk === d && dist(d.dof.o, d) < DRIVE_KEEP;   // a double team: one driver per man, the other falls through to the push
    if(!own && S.runMode && o.blk === d && r < (g ? DRIVE_KEEP : DRIVE_D)){
      const b = g || (d.dof = {o, ang:Math.atan2(d.x - o.x, d.y - o.y), phase:'set', age:0});
      const undo = g && fresh(o.doT);
      if(undo){ o.x = o.dox; o.y = o.doy; }   // movement.js steered him toward his man this frame: take it back
      b.age += dt; b.T = S.clock; driven = true;
      driveMove(d, o, driveV(o, d)*Math.min(1, b.age/DRIVE_RAMP)*dt);
      lock(d, o, b, dt, d);   // c (the ball) is read only by the swim move, which def-off never starts
      if(undo && dt > 0){ o.vx = d.vx = (o.x - o.dox)/dt; o.vy = d.vy = (o.y - o.doy)/dt; } else { d.vx = o.vx; d.vy = o.vy; }
      o.dox = o.x; o.doy = o.y; o.doT = S.clock;
      continue;
    }
    if(dist(o, d) > PUSH_D) continue;
    const dx = d.x - o.x, dy = d.y - o.y, l = Math.hypot(dx, dy) || 1, closing = (o.vx*dx + o.vy*dy)/l;
    if(closing < PUSH_MIN_V) continue;
    const w = o.mass/(o.mass + d.mass);
    d.x += o.vx*dt*w; d.y += o.vy*dt*w;
  }
  if(!driven) d.dof = null;
}
