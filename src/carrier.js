import { runRoute, steerVel } from './movement.js';
import { PLAYS } from './playbook.js';
import { DEF, OFF } from './players.js';
import { isBody } from './physics.js';
import { lack } from './ratings.js';
import { S } from './state.js';
import { HW, clamp, rand } from './util.js';

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
// ---------- zone read: press, read the key, commit (B-006-3) ----------
// States (p.rd.st): press (slow half-step at the line so defenders commit) -> read (key re-picked 5x/s, heading for the designed hole)
// -> committed (lane chosen once at los+1; runs it until his x is reached past los+LOCK_Y, or los+COMMIT_Y) -> open (latched: openField from then on).
// S.read starts as {key:-1, choice:null, wrong:null} (no decision yet) and is overwritten at the decision; a back stuffed first keeps choice null.
// Keyboard carrier and man schemes never come here.
const PRESS_V = 0.7, PRESS_T = 0.15, PRESS_VIS = 0.35, PRESS_MAX = 0.6;    // press speed x spd; seconds = PRESS_T + PRESS_VIS*vision/99, capped
const KEY_R = 3, KEY_Y0 = -1, KEY_Y1 = 5, KEY_EVERY = 0.2;   // key: nearest unengaged defender within KEY_R of the hole x, y los+KEY_Y0..KEY_Y1
const DECIDE_Y = 1, LOCK_Y = 1.5, COMMIT_Y = 3, AIM_Y = 2.5, RACE3 = 0.6, RACE5 = 0.4, LAT_COST = 0.015, BEND = 2.2, BOUNCE = 5, CUTBACK = 4, EDGE = 1.5;
const WRONG_P = 0.25, NOISE = 0.05, HOLE_COST = 0.05, KEY_PEN = 1.2, KEY_CLOSE = 2.2, KEY_LEAD = 0.3;   // NOISE: score noise amplitude x (1-vision/99); any lane but the noiseless best counts as wrong (B-006-7 tunes it)
const free = d => d.stun <= 0 && !isBody(d) && !(d.eng > 0) && !d.bt && !OFF.some(o => o.blk === d);
function pickKey(hole){
  let key = null, bd = KEY_R;
  for(const d of DEF){
    if(!free(d) || d.y < S.los + KEY_Y0 || d.y > S.los + KEY_Y1) continue;
    const dx = Math.abs(d.x - hole); if(dx < bd){ bd = dx; key = d; }
  }
  return key;
}
function decide(p, hole, key, side){
  const lim = HW - EDGE, kx = key ? key.x + key.vx*KEY_LEAD : null;
  const away = key ? (Math.sign(hole - key.x) || side) : side;
  const opts = {hit:hole, bend:key ? key.x + away*BEND : hole + side*BEND, bounce:hole + side*BOUNCE, cutback:hole - side*CUTBACK};
  let best = null, bs = -1e9, noisy = null, ns = -1e9, second = null, ss = -1e9;
  const vn = lack(p, 'vision')*NOISE;
  for(const [name, raw] of Object.entries(opts)){
    const x = clamp(raw, -lim, lim);
    let sc = raceMargin(p, x, S.los + 1) + raceMargin(p, x, S.los + 3)*RACE3 + raceMargin(p, x, S.los + 5)*RACE5 - Math.abs(x - hole)*HOLE_COST - Math.abs(x - p.x)*LAT_COST;
    if(kx !== null) sc -= Math.max(0, KEY_CLOSE - Math.abs(x - kx))*KEY_PEN;
    if(sc > bs){ ss = bs; second = best; bs = sc; best = name; } else if(sc > ss){ ss = sc; second = name; }
    sc += vn*rand(-1, 1);
    if(sc > ns){ ns = sc; noisy = name; }
    opts[name] = x;
  }
  let pick = noisy;
  if(Math.random() < WRONG_P*lack(p, 'vision')){ pick = second; }   // a misread is the second-best lane: a plausible mistake
  return {choice:pick, x:opts[pick], wrong:pick !== best};
}
function zoneRead(p, dt){
  const play = PLAYS[S.play], hole = play.hole ?? 0, side = Math.sign(play.shift || hole) || 1;
  const rd = p.rd || (p.rd = {st:'press', t:Math.min(PRESS_MAX, PRESS_T + PRESS_VIS*p.rt.vision/99), k:0, key:null, x:0});
  if(!S.read) S.read = {key:-1, choice:null, wrong:null};
  if(rd.st === 'press' || rd.st === 'read'){
    rd.k -= dt;
    if(rd.k <= 0){ rd.k = KEY_EVERY; rd.key = pickKey(hole); }   // re-picked until the decision at los+DECIDE_Y
    if(rd.st === 'press'){ rd.t -= dt; if(rd.t <= 0) rd.st = 'read'; }
    if(p.y >= S.los + DECIDE_Y){
      const r = decide(p, hole, rd.key, side);
      rd.st = 'committed'; rd.x = r.x;
      S.read = {key:rd.key ? DEF.indexOf(rd.key) : -1, choice:r.choice, wrong:r.wrong};
    }
  }
  if(rd.st === 'committed' && ((p.y >= S.los + LOCK_Y && Math.abs(p.x - rd.x) < 1) || p.y >= S.los + COMMIT_Y)) rd.st = 'open';
  if(rd.st === 'open'){ openField(p, dt); return; }
  if(rd.st === 'committed'){
    const tx = rd.x, dx = tx - p.x, dy = S.los + COMMIT_Y - p.y, l = Math.hypot(dx, dy) || 1, sp = p.spd*burst(p, true, dt);
    steerVel(p, dx/l*sp, dy/l*sp, dt); return;
  }
  const sp = p.spd*(rd.st === 'press' ? PRESS_V : 1), dx = hole - p.x, dy = S.los + AIM_Y - p.y, l = Math.hypot(dx, dy) || 1;
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
  const rd = p.rd, zone = PLAYS[S.play].scheme === 'zone';
  if(zone && (rd ? rd.st !== 'open' : p.y < S.los + COMMIT_Y)) zoneRead(p, dt);
  else if(!zone && p.y < S.los + 1.5) readHole(p, dt); else openField(p, dt);
}
