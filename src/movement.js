import { clamp } from './util.js';

// ---------- movement ----------
// Movement physics. The velocity change is split along the current heading (speed up / brake) and
// across it (turn). Acceleration fades toward top speed, braking is harder than accelerating, and the
// sideways limit means a full-speed cut has to shed speed first. Rates are per player (yd/s²).
// B-060-1: acceleration fades linearly to zero at ACC_FADE_TOP x spd (v = V(1 - e^(-t/tau)), tau = that top / acc), so a run-up takes
// 2-3 s and 15-20 yd to 90%; ACC_FLOOR keeps a little push above it (a burst's wanted speed). FIRE_K: the lineman's get-off multiplier on acc.
const ACC_FADE_TOP = 1, ACC_FLOOR = 0.1, FIRE_K = 1.3;
export function steerVel(p, dvx, dvy, dt){
  const slow = p.slow || 1; dvx *= slow; dvy *= slow;   // tacklers hanging on
  const bub = p.ph && p.ph.bubble;
  if(bub && p.wx != null){ p.vx = p.wx; p.vy = p.wy; }   // a bubble body steers from what he wants (physics overwrites vx / vy with the real motion)
  const sp = Math.hypot(p.vx, p.vy);
  let ux, uy;
  if(sp > 0.3){ ux = p.vx/sp; uy = p.vy/sp; }
  else {
    const dl = Math.hypot(dvx, dvy);
    if(dl < 0.05){ p.vx = p.vy = 0; p.accel = 0; if(bub) p.wx = p.wy = 0; return; }
    ux = dvx/dl; uy = dvy/dl;
  }
  const ex = dvx - p.vx, ey = dvy - p.vy;
  const par = ex*ux + ey*uy, px = ex - par*ux, py = ey - par*uy;
  const acc = p.acc*(p.fire > 0 ? FIRE_K : 1);   // get-off: a lineman's first steps out of his stance are explosive
  const aMax = par > 0 ? acc*Math.max(ACC_FLOOR, 1 - sp/(p.spd*ACC_FADE_TOP)) : p.brake;
  const dPar = clamp(par, -aMax*dt, aMax*dt);
  const pl = Math.hypot(px, py), lim = p.turn*dt, k = pl > lim ? lim/pl : 1;
  p.vx += dPar*ux + px*k; p.vy += dPar*uy + py*k;
  p.latAcc = pl*k/dt;   // sideways acceleration: how hard he is cutting
  p.accel = dPar/dt;
  p.x += p.vx*dt; p.y += p.vy*dt;
  if(bub){ p.wx = p.vx; p.wy = p.vy; }
  if(p.fire > 0) p.fire -= dt;
}
export function steer(p, tx, ty, speed, dt){
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  // arrive: never faster than what he can still brake from before the target
  const s = d > 0.05 ? (p.fire > 0 ? speed : Math.min(speed, Math.sqrt(2*p.brake*d)))/d : 0;   // firing out: no easing into contact
  steerVel(p, dx*s, dy*s, dt);
}
export function runRoute(w, dt, f = 1){   // B-060-2 (speed-situational): f scales only the speed passed to steer/steerVel (stem speed), never w.spd, acc or brake
  if(w.wp < w.route.length){
    const t = w.route[w.wp], n = w.route[w.wp + 1], d = Math.hypot(t.x - w.x, t.y - w.y);
    if(!n && !w.go){ if(d < 0.7) w.wp++; steer(w, t.x, t.y, w.spd*f, dt); return; }   // a route that stops (curl): settle on the spot
    // through waypoints at full speed, rounding each corner by aiming partway at the next one
    if(d < 1.2) { w.wp++; runRoute(w, dt, f); return; }
    const k = n ? clamp(1 - d/2.5, 0, 1)*0.6 : 0, ax = t.x + (n ? (n.x - t.x)*k : 0), ay = t.y + (n ? (n.y - t.y)*k : 0);
    const l = Math.hypot(ax - w.x, ay - w.y) || 1;
    steerVel(w, (ax - w.x)/l*w.spd*f, (ay - w.y)/l*w.spd*f, dt);
  } else if(w.go) steer(w, w.x + w.goDir.x*5, w.y + w.goDir.y*5, w.spd*f, dt);
  else steer(w, w.x, w.y, 0, dt);
}

// B-034: a 40-yard dash straight upfield from a standstill, stepped through steerVel (deterministic; no game state): wanted speed
// spd*sprint for the first burstS seconds, spd after (burstS 0 = unsprinted). Returns {t10, t40 (s), top (peak yd/s)}.
// B-060-1: plus t90, d90 (s and yd to 90% of spd) and a stop from the peak speed: stopT (s), stopYd (yd) until he is under 0.3 yd/s.
export function dash40(spd, acc, brake, sprint = 1, burstS = 0, dt = 1/60){
  const p = {spd, acc, brake, turn: 10 /* unused in a straight dash: no sideways error to turn */, vx: 0, vy: 0, x: 0, y: 0, fire: 0};
  let t = 0, top = 0, t10 = 0, t90 = 0, d90 = 0;
  while(p.y < 40 && t < 20){ steerVel(p, 0, spd*(t < burstS ? sprint : 1), dt); t += dt; top = Math.max(top, p.vy); if(!t10 && p.y >= 10) t10 = t; if(!t90 && p.vy >= 0.9*spd){ t90 = t; d90 = p.y; } }
  const t40 = t, y0 = p.y; let ts = 0;
  while(p.vy > 0.3 && ts < 10){ steerVel(p, 0, 0, dt); ts += dt; }
  return {t10, t40, top, t90, d90, stopT: ts, stopYd: p.y - y0};
}
