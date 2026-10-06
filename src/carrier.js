import { runRoute, steerVel } from './movement.js';
import { PLAYS } from './playbook.js';
import { DEF } from './players.js';
import { isBody } from './physics.js';
import { S } from './state.js';
import { HW, clamp } from './util.js';

// ---------- ball carrier AI ----------
// Everything is a race: for a spot on the field, how much sooner does he get there than the quickest defender
// who can still make a play? Defenders on the ground don't count; ones locked up with a blocker count late.
const SPRINT = 1.12;
// sprint is a burst, not a gear: ~1.7 s of full burst per play, recovers slowly when he's not using it
export function burst(p, want, dt){
  if(p.stam == null) p.stam = 1;
  const on = want && p.stam > 0;
  p.stam = clamp(p.stam + (on ? -0.6 : 0.08)*dt, 0, 1);
  return on ? SPRINT : 1;
}
function raceMargin(p, qx, qy){
  const tr = Math.hypot(qx - p.x, qy - p.y)/(p.spd*SPRINT);
  let m = 1.5;
  for(const d of DEF){
    if(d.stun > 0 || isBody(d)) continue;
    const td = Math.hypot(qx - d.x, qy - d.y)/(d.spd + 0.2) + (d.bt ? 0.45 : 0);
    m = Math.min(m, td - tr);
  }
  return m;
}
// at the line: read the blocking and take the gap he wins, staying close to the designed hole
function readHole(p, dt){
  const play = PLAYS[S.play], hole = play.hole ?? 0, y = S.los + 1;
  let best = p.holeX ?? hole, bs = -1e9;
  for(let x = hole - 5; x <= hole + 5; x += 0.5){
    if(Math.abs(x) > HW - 1.5) continue;
    const sc = raceMargin(p, x, y) + raceMargin(p, x, y + 3)*0.6 - Math.abs(x - hole)*0.05 - Math.abs(x - p.x)*0.03;
    if(sc > bs + (x === p.holeX ? 0 : 0.08)){ bs = sc; best = x; }    // a little hysteresis: don't dance
  }
  p.holeX = best;
  const sp = p.spd*burst(p, bs > 0.2, dt);
  const dx = best - p.x, dy = y + 1.5 - p.y, l = Math.hypot(dx, dy) || 1;
  steerVel(p, dx/l*sp, dy/l*sp, dt);
}
// open field: lanes from straight upfield to 90° either side, each scored by the worst race along it
// (2, 4 and 6 yd out), plus ground gained, minus the sideline. Re-reads 10x a second, commits in between.
function openField(p, dt){
  p.ofT = (p.ofT || 0) - dt;
  if(p.ofT <= 0){
    p.ofT = 0.1;
    let best = p.ofLane ?? 0, bs = -1e9;
    for(let a = -90; a <= 90; a += 10){
      const r = a*Math.PI/180, dx = Math.sin(r), dy = Math.cos(r);
      let m = 1.5, side = 0;
      for(const k of [2, 4, 6]){
        const qx = p.x + dx*k, qy = p.y + dy*k;
        m = Math.min(m, raceMargin(p, qx, qy));
        if(Math.abs(qx) > HW - 1) side = 4;
      }
      const sc = m*3 + dy*1.6 - side - (a === p.ofLane ? 0 : 0.15);
      if(sc > bs){ bs = sc; best = a; }
    }
    p.ofLane = best; p.ofMargin = bs;
  }
  const r = p.ofLane*Math.PI/180, sp = p.spd*burst(p, (p.ofMargin ?? 0) > 1, dt);
  steerVel(p, Math.sin(r)*sp, Math.cos(r)*sp, dt);   // full commitment: cuts are as sharp as his feet allow
}
export function autoCarry(p, dt){
  const next = p.route[p.wp];
  if(next && next.y < S.los - 1){ runRoute(p, dt); return; }       // still on the designed path in the backfield
  if(p.y < S.los + 1.5) readHole(p, dt); else openField(p, dt);
}
