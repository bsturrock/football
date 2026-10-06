import { clamp } from './util.js';

// ---------- movement ----------
// Movement physics. The velocity change is split along the current heading (speed up / brake) and
// across it (turn). Acceleration fades toward top speed, braking is harder than accelerating, and the
// sideways limit means a full-speed cut has to shed speed first. Rates are per player (yd/s²).
// (The trailing argument some callers still pass is ignored.)
export function steerVel(p, dvx, dvy, dt){
  const slow = p.slow || 1; dvx *= slow; dvy *= slow;   // tacklers hanging on
  const sp = Math.hypot(p.vx, p.vy);
  let ux, uy;
  if(sp > 0.3){ ux = p.vx/sp; uy = p.vy/sp; }
  else {
    const dl = Math.hypot(dvx, dvy);
    if(dl < 0.05){ p.vx = p.vy = 0; p.accel = 0; return; }
    ux = dvx/dl; uy = dvy/dl;
  }
  const ex = dvx - p.vx, ey = dvy - p.vy;
  const par = ex*ux + ey*uy, px = ex - par*ux, py = ey - par*uy;
  const aMax = par > 0 ? p.acc*Math.max(0.2, 1 - (sp/(p.spd*1.15))**2) : p.brake;
  const dPar = clamp(par, -aMax*dt, aMax*dt);
  const pl = Math.hypot(px, py), lim = p.turn*dt, k = pl > lim ? lim/pl : 1;
  p.vx += dPar*ux + px*k; p.vy += dPar*uy + py*k;
  p.latAcc = pl*k/dt;   // sideways acceleration: how hard he is cutting
  p.accel = dPar/dt;
  p.x += p.vx*dt; p.y += p.vy*dt;
}
export function steer(p, tx, ty, speed, dt){
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  // arrive: never faster than what he can still brake from before the target
  const s = d > 0.05 ? Math.min(speed, Math.sqrt(2*p.brake*d))/d : 0;
  steerVel(p, dx*s, dy*s, dt);
}
export function runRoute(w, dt){
  if(w.wp < w.route.length){
    const t = w.route[w.wp], n = w.route[w.wp + 1], d = Math.hypot(t.x - w.x, t.y - w.y);
    if(!n && !w.go){ if(d < 0.7) w.wp++; steer(w, t.x, t.y, w.spd, dt); return; }   // a route that stops (curl): settle on the spot
    // through waypoints at full speed, rounding each corner by aiming partway at the next one
    if(d < 1.2) { w.wp++; runRoute(w, dt); return; }
    const k = n ? clamp(1 - d/2.5, 0, 1)*0.6 : 0, ax = t.x + (n ? (n.x - t.x)*k : 0), ay = t.y + (n ? (n.y - t.y)*k : 0);
    const l = Math.hypot(ax - w.x, ay - w.y) || 1;
    steerVel(w, (ax - w.x)/l*w.spd, (ay - w.y)/l*w.spd, dt);
  } else if(w.go) steer(w, w.x + w.goDir.x*5, w.y + w.goDir.y*5, w.spd, dt, 8);
  else steer(w, w.x, w.y, 0, dt, 8);
}
