import { runRoute, steerVel as steer0 } from './movement.js';
import { PLAYS } from './playbook.js';
import { GRID_K } from './formations.js';
import { ALL, BODY_W, C, DEF, LG, LT, OFF, RG, RT } from './players.js';
import { isBody, physBall, physDown, physTouched } from './physics.js';
import { lack } from './ratings.js';
import { S } from './state.js';
import { HW, PILE_R, clamp, dist, rand } from './util.js';

// ---------- ball carrier AI ----------
// Everything is a race: for a spot on the field, how much sooner does he get there than the quickest defender
// who can still make a play? Defenders on the ground don't count; ones locked up with a blocker count late.
const SPRINT = 1.12;
// every steer in this file goes through here: in contact and slowed under STALL_V x spd, the wanted velocity keeps at least DRIVE_V x spd upfield (leg drive; never stands still)
function steerVel(p, vx, vy, dt){
  const f = p.spd*DRIVE_V;
  if(p.rd && p.rd.cn && vy < f && Math.hypot(p.vx, p.vy) < p.spd*STALL_V){ const k = vy > 0 ? 1 : 0; vx *= k; vy = f; }   // no upfield want: drive straight up; else keep the lane's lateral part
  steer0(p, vx, vy, dt);
}
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
  const hole = S.hole ?? 0, y = S.los + 1;
  let best = p.holeX ?? hole, bs = -1e9;
  for(let x = hole - 5*GRID_K; x <= hole + 5*GRID_K; x += 0.5*GRID_K){
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
// B-021: the lane distances below were written on the old 2.2 yd line grid; GRID_K (x0.61) carries KEY_R, BEND, BOUNCE, CUTBACK, KEY_CLOSE, the hole scan and the lane tolerance to the 1.35 yd one. Per-yard score costs, EDGE (a sideline margin) and the y offsets stay.
const KEY_R = 3*GRID_K, KEY_Y0 = -1, KEY_Y1 = 5, KEY_EVERY = 0.2;   // key: nearest unengaged defender within KEY_R of the hole x, y los+KEY_Y0..KEY_Y1
const DECIDE_Y = 1, LOCK_Y = 1.5, COMMIT_Y = 3, AIM_Y = 2.5, RACE3 = 0.6, RACE5 = 0.4, LAT_COST = 0.015, BEND = 2.2*GRID_K, BOUNCE = 5*GRID_K, CUTBACK = 4*GRID_K, EDGE = 1.5;
const WRONG_P = 0.175, NOISE = 0.035, HOLE_COST = 0.05, KEY_PEN = 1.2, KEY_CLOSE = 2.2*GRID_K, KEY_LEAD = 0.3;   // NOISE: score noise amplitude x (1-vision/99); any lane but the noiseless best counts as wrong (B-006-7 tunes it)
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
  const play = PLAYS[S.play], hole = S.hole ?? 0, side = Math.sign(play.shift || hole) || 1;
  const rd = p.rd;
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
  if(rd.st === 'committed' && ((p.y >= S.los + LOCK_Y && Math.abs(p.x - rd.x) < GRID_K) || p.y >= S.los + COMMIT_Y)) rd.st = 'open';
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
const OF_NOISE = 0.8;   // open-field lane noise on ofMargin: (1 - vision/99) * OF_NOISE (B-006-4)
function openField(p, dt){
  p.ofT = (p.ofT || 0) - dt;
  if(p.ofT <= 0){
    p.ofT = 0.1;
    let best = p.ofLane ?? 0, bs = -1e9;
    const vn = lack(p, 'vision')*OF_NOISE;
    for(let a = -90; a <= 90; a += 10){
      const r = a*Math.PI/180, dx = Math.sin(r), dy = Math.cos(r);
      let m = 1.5, side = 0;
      for(const k of [2, 4, 6]){
        const qx = p.x + dx*k, qy = p.y + dy*k;
        m = Math.min(m, raceMargin(p, qx, qy));
        if(Math.abs(qx) > HW - 1) side = 4;
      }
      const sc = m*3 + dy*1.6 - side - (a === p.ofLane ? 0 : 0.15) + vn*rand(-1, 1)*3;   // noise on the margin (x3 like the margin itself)
      if(sc > bs){ bs = sc; best = a; }
    }
    p.ofLane = best; p.ofMargin = bs;
  }
  const r = p.ofLane*Math.PI/180, sp = p.spd*burst(p, (p.ofMargin ?? 0) > 1, dt);
  steerVel(p, Math.sin(r)*sp, Math.cos(r)*sp, dt);   // full commitment: cuts are as sharp as his feet allow
}
// ---------- follow the puller and fall forward (B-006-4) ----------
// p.rd.fs, one runner per play (place() clears p.rd): free (no puller, or he has engaged or the back is past los+FOLLOW_Y) <-> following; done (the puller stood under FOLLOW_STALL_V for FOLLOW_STALL_T s without engaging: never follows again)
// (a pulling blocker is ahead; the back tucks FOLLOW_BEHIND yd behind his hip at his pace, closing a gap at up to sprint) ; contact (a defender latched, or touched with
// 2+ bodies within PILE_R, and not down) keeps at least DRIVE_V x spd of wanted velocity upfield (rd.cn, see steerVel above), whatever his lane says. Contact ends when the grip and the bodies are gone.
const STALL_V = 0.25, FOLLOW_STALL_V = 1, FOLLOW_STALL_T = 0.5, FOLLOW_BEHIND = 0.6, FOLLOW_Y = 2, FOLLOW_NEAR = 3.5, DRIVE_V = 0.6;   // PILE_R: util.js
const pullerOf = () => { const k = Object.keys(PLAYS[S.play].pulls || {})[0]; return ({LT, LG, C, RG, RT})[k] || null; };   // the first puller the play names
const ballY = p => p.ph ? 50 - physBall(p).z : p.y;
function followPuller(p, dt){
  const rd = p.rd, q = rd.pull;
  if(!q || rd.fs === 'done' || p.y > S.los + FOLLOW_Y || q.y < p.y - FOLLOW_BEHIND) return false;   // no puller, done with him, or he is behind the back
  if(q.eng > 0 || q.bt || q.falling || (!(q.via && q.via.length) && q.blk && dist(q, q.blk) < 1.6*BODY_W)) return false;   // he has his man: the back takes the hole he made
  const sp = Math.hypot(q.vx, q.vy);
  rd.fst = sp < FOLLOW_STALL_V ? (rd.fst || 0) + dt : 0;
  if(rd.fst > FOLLOW_STALL_T){ rd.fs = 'done'; return false; }   // stopped without engaging (held on a body): the back goes on alone
  const ux = sp > 1 ? q.vx/sp : 0, uy = sp > 1 ? q.vy/sp : 1;
  const tx = q.x - ux*FOLLOW_BEHIND, ty = q.y - uy*FOLLOW_BEHIND, dx = tx - p.x, dy = ty - p.y, l = Math.hypot(dx, dy);
  if(rd.fs !== 'following' && l > FOLLOW_NEAR) return false;   // too far to catch him yet: stay on the designed path
  rd.fs = 'following';
  while(p.route[p.wp] && p.route[p.wp].y < p.y) p.wp++;   // waypoints he has passed are skipped, so leaving the follow never sends him back
  const v = Math.min(p.spd*SPRINT, sp + l*4);   // matches his pace, closes a gap fast
  steerVel(p, dx/(l || 1)*v, dy/(l || 1)*v, dt);
  return true;
}
function inContact(p){
  if(p.falling || (p.ph && physDown(p))) return false;
  if(DEF.some(d => d.latch === p)) return true;
  return !!p.ph && physTouched(p, 0.15) && ALL.filter(q => q !== p && isBody(q) && dist(q, p) < PILE_R).length >= 2;
}
export function autoCarry(p, dt){
  if(!p.rd) p.rd = {st:'press', t:Math.min(PRESS_MAX, PRESS_T + PRESS_VIS*p.rt.vision/99), k:0, key:null, x:0, fs:'free', pull:pullerOf(), ct:null, cn:false};
  const rd = p.rd, zone = PLAYS[S.play].scheme === 'zone';
  if(inContact(p)){
    if(rd.ct === null) rd.ct = ballY(p);   // yards after contact are counted from here; nothing reads it yet: B-006-7 wants yards-after-contact in sim.js
    rd.cn = true;
  } else rd.cn = false;
  if(!zone && followPuller(p, dt)) return;
  if(rd.fs === 'following') rd.fs = 'free';
  const next = p.route[p.wp];
  if(next && next.y < S.los - 1){ if(rd.cn) steerVel(p, 0, p.spd*DRIVE_V, dt); else runRoute(p, dt); return; }       // still on the designed path in the backfield
  if(zone && rd.st !== 'open') zoneRead(p, dt);
  else if(!zone && p.y < S.los + 1.5) readHole(p, dt); else openField(p, dt);
}
