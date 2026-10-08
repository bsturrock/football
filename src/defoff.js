import { OFF } from './players.js';
import { dist } from './util.js';
import { steer } from './movement.js';

// B-066 defense-off mode (?def=off): a defender stands where he is in his stance and only a blocker moves him. No AI, no tackle, no battle, no shed, no physics calls.
// A blocker in contact (within PUSH_D, closing on him) pushes him along his own motion, split by mass; blocking.js separate() keeps the bodies apart as always.
export const DEF_OFF_WHISTLE = 6;   // s after the snap: the play ends here unless it ended sooner (touchdown, out of bounds)
const PUSH_D = 0.9, PUSH_MIN_V = 0.3;
export function defOffStep(d, dt){
  d.stun = 0; d.latch = null; d.bt = null;
  steer(d, d.x, d.y, 0, dt);   // brake to a halt, facing and stance as they stand
  for(const o of OFF){
    if(o.ph || dist(o, d) > PUSH_D) continue;
    const dx = d.x - o.x, dy = d.y - o.y, l = Math.hypot(dx, dy) || 1, closing = (o.vx*dx + o.vy*dy)/l;
    if(closing < PUSH_MIN_V) continue;
    const w = o.mass/(o.mass + d.mass);
    d.x += o.vx*dt*w; d.y += o.vy*dt*w;
  }
}
