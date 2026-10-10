import { battle, pancakeHit } from './blocking.js';
import { burst } from './carrier.js';
import { steer, steerVel } from './movement.js';
import { logSpeed } from './offense.js';
import { FRONTS, STUNTS, SAFETY_D, VIA_NEAR, safetyJob, gapX, stuntStep } from './fronts.js';
import { PLAYS } from './playbook.js';
import { CBs, DEF, DL, LBs, OFF, QB, RB, RECV, SFs } from './players.js';
import { isBody } from './physics.js';
import { S, ball } from './state.js';
import { lack } from './ratings.js';
import { GRID_K } from './formations.js';
import { DBL_R, bearing, dist, rand } from './util.js';

// Human mistakes in pursuit. Per defender per play state (reset in assignFits):
//   aim     AIM_K resampled every AIM_T s; < 1 undershoots the cut-off spot, > 1 overpursues
//   holding runner cuts back while AIM_K > 1 (overrunning): with p HOLD_P*lack(pursuit) keep running to the old future spot for HOLD_T s;
//           another flip while holding re-holds the newest spot
//   bite    with p BITE_P*lack(recog) follows the first flow step BITE_T s longer
// Leverage and blockers (B-006-6). Per defender per play: avoid = {st, o, until, lat}, st 'avoid' | 'fight'
//   pursuing  default: runFit target
//   avoiding  a blocker sits in the AVOID_CONE within AVOID_DIST of his path (checked every AVOID_EVERY s) and he lost the FIGHT_P roll:
//             steps around to his leverage side (outside for the force man and a support man who took the force job, toward the ball for the rest) for AVOID_T s
//   fighting  won the FIGHT_P = shed/99 - 0.3 roll: runs straight through the blocker, quick shed move on contact. A force man or acting force whose blocker sits on his
//             outside (leverage side) always fights through, whatever the roll: he never gives up the edge
//   squeezing B-084: a force man with the ball clearly inside him (d.sqzL, latched; d.sqz is set only the frames contain() runs) takes the blocker on at the line and always fights through, never stepping wide around him
//   held      engaged (d.bt): the line battle owns him; avoid state cleared
// Backside (ball away from his side, not past los+BACK_L): stays home near his gap unless the runner closes within BACK_D. Once a run is seen (S.runSeen: handoff, pitch or scramble),
//   gap and force roles only, and only men who passed the d.home roll (a poor pursuer abandons the backside early)
const AVOID_CONE = 30, AVOID_DIST = 2.5, AVOID_EVERY = 0.1, AVOID_T = 0.5, AVOID_STEP = 1.6, BACK_D = 3, BACK_L = 3, HOME_P = 0.5, FIGHT_QUICK = 0.15;
const COS_CONE = Math.cos(AVOID_CONE*Math.PI/180);
const levShade = d => 0.8*(0.5 + d.rt.pursuit/200);   // LEV_SHADE: how far he keeps to his leverage side
// B-060-2: situational speeds, fractions of d.spd (full only chasing in the open or on a ball in the air); scale the steered speed only, never d.acc or d.leg
const PURSUE_F = 0.8, READ_F = 0.4, ZONE_F = 0.8, MAN_STEM_F = 0.9, RUSH_FULL_T = 1.0, OPEN_Y = 6;   // ZONE_F: zone and deep drops; MAN_STEM_F: man cover until the receiver is past his stem (then full); RUSH_FULL_T: a pass rusher runs full this long after the snap
const FORCE_FIRE_DEPTH = -0.3, FIRE_DEPTH = 1, FIRE_T = 0.5, FIRE_ACC = 1.8;   // FORCE_FIRE_DEPTH (B-084): the edge (force) DL aims this far past the line (negative = a hair on his own side) so he holds the line and the puller meets him there, not 2.5 yd across it. B-064 (dl-fire): a one-gap DL aims FIRE_DEPTH yd past the line and accelerates FIRE_ACC x for FIRE_T s after the snap (stacked on movement.js p.fire x FIRE_K 1.3 for 0.35 s: about 2.3x then), so he meets the blocker at the line carrying his charge
const BT_KEEP_D = 1.3;   // B-023: a battle that started inside ENGAGED_D survives until its blocker is this far (drive and steering open the gap past ENGAGED_D 50 times a second)
const RUNNER_PAST_Y = 1.0;   // B-023: the runner this far (yd) downfield of a blocked defender: the blocks break down, he is released to pursue
const TOW_V = 4, TOW_FREE_T = 0.4;   // B-023: a blocker who is not assigned to him (o.blk is another man: a climber, a puller, a stunt pass-off) moving faster than TOW_V yd/s is passing, not blocking: the battle ends and he cannot re-engage for TOW_FREE_T s
const ENGAGED_D = 0.91;   // B-021: a defender locks onto a blocker this close (was 1.3, x0.7 body width)
// B-021: run-fit windows on the old 2.2 yd line grid, carried onto the new one (x GRID_K): the backside stay-home line, the gap fill window, the contain offsets and the outflanked margin
// B-084: edge squeeze. SQUEEZE_IN: the ball is this far inside the edge man (yd) to count as an inside run; BOUNCE_V: the carrier moving outward faster than this (yd/s) widens him; SQUEEZE_X: his outside leverage on the ball's line; SQUEEZE_Y: his depth past the line
const SQUEEZE_IN = 1, BOUNCE_V = 2.5, SQUEEZE_X = 0.6*GRID_K, SQUEEZE_Y = 0.5, SQUEEZE_BACK = 1.5*GRID_K;   // SQUEEZE_BACK: he never closes more than this inside his own gap line
const BACK_HOME_X =1.5*GRID_K, FILL_DX = 2.5*GRID_K, CONTAIN_X = 1.5*GRID_K, CONTAIN_SHOULDER = 0.5*GRID_K, OUTFLANKED_X = 0.5*GRID_K, CHASE_X = 2*GRID_K, ALLEY_X = 1*GRID_K;   // CHASE_X: the ball is this far to the backside of the force man, he chases; ALLEY_X: the ball is this far to the alley man's side, he fills
// B-085: free, shed and backside linemen chase the ball by role. Only the backside edge (force) man stays home (boot, reverse, cutback), and only the d.home roll; backside interior men pursue flat on an intercept angle
// (their target is never deeper than the runner once he is across the line, and L+FLAT_Y while he is behind it, so they run the line, not away from him); a playside gap man fills his gap while the ball is at the line, then closes on the runner once within FILL_CLOSE yd
const FLOW_OUT = 1.5;   // B-089: the force DL widens (FIRE_DEPTH) while the ball has moved this far toward his side from where the back lined up; otherwise it is an inside run and he holds (FORCE_FIRE_DEPTH)
let snapQB = 0, snapRB = 0, snapN = 0, snapPending = false;   // B-089: each ball carrier's x at the snap (QB and RB), taken at the first runFit after assignFits (which runs once per play and sets snapPending); snapN counts plays for d.wideN
const FILL_CLOSE = 3, FILL_BAND = 0.5, FLAT_Y = 0.5;   // FILL_BAND: dead band on FILL_CLOSE (in at 3 yd, out past 3.5, d.fillL). DL only: LBs also carry role 'gap' and keep the old rules; FLAT_Y: a flat chaser's target is at least this far past the line
const backsideOf = (j, bx) => bx*j.side < -BACK_HOME_X;   // the ball went away from this gap's side
const RUN_SUPPORT_Y = 1;   // B-094: a designed run this far (yd) past the line turns a deep man into run support whatever his distance
const AIM_AMP = 0.8, AIM_T = 0.4, HOLD_P = 0.6, HOLD_T = 0.5, BITE_P = 0.35, BITE_T = 0.3;

// pursuit: run to the point where I can actually meet the runner, using his smoothed velocity
// (solve |r + v·t| = s·t for the earliest t > 0); if he is faster, aim where he will be soon
function intercept(d, c, k = 1){
  const rx = c.x - d.x, ry = c.y - d.y, vx = c.svx, vy = c.svy, s = d.spd + 0.2;
  const a = vx*vx + vy*vy - s*s, b = 2*(rx*vx + ry*vy), cc = rx*rx + ry*ry;
  let t = Infinity;
  if(Math.abs(a) < 1e-6){ if(b < 0) t = -cc/b; }
  else {
    const disc = b*b - 4*a*cc;
    if(disc >= 0) for(const r of [(-b - Math.sqrt(disc))/(2*a), (-b + Math.sqrt(disc))/(2*a)]) if(r > 0) t = Math.min(t, r);
  }
  // he can get there first: take the cut-off angle (up to 3 s out). He can't: aim just ahead of the runner,
  // never at a spot far downfield (that sends him running away from the play)
  t = isFinite(t) ? Math.min(t, 3) : Math.min(Math.hypot(rx, ry)/s, 0.6);
  return [c.x + vx*t*k, c.y + vy*t*k];
}
function coverTarget(d){
  if(d.mode === 'cover'){ const w = d.assign; return [w.x + w.vx*0.25, w.y + w.vy*0.25 + d.cushion]; }
  if(d.mode === 'deep'){
    const mine = RECV.filter(r => r.x*d.side > -3);
    if(!mine.length) return [d.side*10, S.los + 13];
    const deep = mine.reduce((a, b) => b.y > a.y ? b : a);
    return [deep.x*0.7, Math.max(S.los + 12, deep.y + 5)];
  }
  return [QB.x, QB.y];
}
// First contact: pads pop. Momentum into the hit (mass x closing speed, scaled by blocker strength vs
// defender power) decides who gets knocked back. A blocker who wins it on a run play goes straight to
// driving his man; a defender who wins it gets to his move right away.
function pop(o, d, bt){
  const l = dist(o, d) || 1, nx = (d.x - o.x)/l, ny = (d.y - o.y)/l;
  const mo = o.mass*Math.max(0, o.vx*nx + o.vy*ny)*(o.rStr/80), md = d.mass*Math.max(0, -(d.vx*nx + d.vy*ny))*(d.rPow/80);
  const edge = (mo - md)/(o.mass + d.mass);                     // yd/s of momentum advantage
  const knock = Math.min(0.45, Math.abs(edge)*0.15), loser = edge > 0 ? d : o, s = edge > 0 ? 1 : -1;
  loser.x += nx*s*knock; loser.y += ny*s*knock;                 // jolted back
  const cx = (o.mass*o.vx + d.mass*d.vx)/(o.mass + d.mass), cy = (o.mass*o.vy + d.mass*d.vy)/(o.mass + d.mass);
  o.vx = d.vx = cx; o.vy = d.vy = cy;                           // locked up: they move together from here
  if(edge > 0.8 && S.runMode){ bt.phase = 'recover'; bt.dur = rand(0.6, 1.0); }   // blocker won the get-off: drive him
  else if(edge < -0.8) bt.dur = 0.05;                           // defender won it: straight into his move
}
// ---------- RUN FITS ----------
// Which gap each defender owns comes from the front (src/fronts.js: d.spec, set when the front lines up). Gaps are named by strength
// (AS = A gap on the tight end's side, CW = C gap on the other side); S.flip puts them on the field, so every fit below reads the
// tight end's side and a flipped play is the mirror image.
// Jobs:
//   gap     own one gap: fill it while the ball can still come there, then pursue inside-out (no cutback behind him)
//   two     two-gap lineman (3-4): hold his spot until the read, then shed to the gap the ball is on and fill like a gap man
//   force   own the edge on one side: nothing gets outside him; squeeze the runner back in. Ball goes away: backside chase
//   alley   safety between the force and the box: hold, then fill inside-out once the ball commits to his side
//   deep    last line: stay deeper than the ball, mirror it, come downhill only when it's close
//   B-094: two-high safeties (alley / deep, no safety rolled into the box: S.boxS null) swap by the run side: once the ball commits (past ALLEY_X of the middle, or through the line) the safety on its side is the alley man and the other the deep man (d.alt, latched per play, d.altN); a deep man stops holding 8 yd off a designed run once it is RUN_SUPPORT_Y past the line
//   support corner: cover his man; becomes the force if the force man is blocked, down or outflanked
// Ratings decide how well: awareness = read time, read-step quality and angle discipline; speed = pursuit;
// power / speed vs the blocker = shedding (line battle); tackling = the tackle.
export function assignFits(call, boxS){
  const L = S.los, f = S.flip, box = [...DL, ...LBs];
  box.forEach(d => {
    const sp = d.spec || {role:'gap', gap:'AS'}, g = gapX(sp.gaps ? sp.gaps[0] : sp.gap, f);
    d.job = {role:sp.role, gx:g.x, side:g.side};
    if(sp.role === 'two'){   // holds where he stands; the two gaps left to right on the field
      const [a, b] = sp.gaps.map(n => gapX(n, f).x).sort((p, q) => p - q);
      d.job = {role:'two', gx:d.x, gl:a, gr:b, side:Math.sign(d.x) || f};
    }
  });
  DEF.forEach(d => { d.stunt = null; });
  box.forEach(d => { const st = d.spec && d.spec.stunt; if(st){ d.stunt = {st:'aligned', via:st.via || null, t0:0, blitz:!!st.blitz}; if(st.blitz) d.mode = 'rush'; } });
  const [sl, sr] = [...SFs].sort((a, b) => a.x - b.x);
  const strongS = f > 0 ? sr : sl, weakS = strongS === sr ? sl : sr;
  // the strong edge (tight end side) belongs to a safety unless the front already put a man there
  const strongForce = box.some(d => d.job.role === 'force' && d.job.side === f);
  if(boxS){
    // rolled into the box: a bear's strong safety plays the alley behind the front's edge men; a safety rolled from the call (eight in
    // the box) is the force on his side, the other plays deep middle alone
    const strongBox = boxS === strongS, other = boxS === sl ? sr : sl;
    other.job = {role:'deep', side:0};
    if(FRONTS[call.front].roll) boxS.job = {role:'alley', gx:gapX('DS', f).x, side:f};
    else {
      boxS.job = {role:'force', gx:strongBox ? gapX('DS', f).x : -f*(Math.abs(gapX('CW', 1).x) + 1.5), side:boxS.side};
      if(!strongBox){
        const w = box.find(d => d.job.role === 'force' && d.job.side === -f);
        if(w) w.job = {role:'gap', gx:w.job.gx, side:w.job.side};
        if(!strongForce){ const lb = [...LBs].sort((a, b) => b.x*f - a.x*f)[0]; if(lb) lb.job = {role:'force', gx:gapX('DS', f).x, side:f}; }
      }
    }
  } else {
    strongS.job = strongForce ? {role:'alley', gx:gapX('DS', f).x, side:f} : {role:'force', gx:gapX('DS', f).x + f, side:f};
    weakS.job = {role:'deep', side:0};
    if(call.stunt && STUNTS[call.stunt].kind === 'safety'){   // strong safety blitz: down to depth 7, through the strong C gap
      const sj = safetyJob(strongForce);
      strongS.job = {role:sj.role, gx:gapX(sj.gap, f).x, side:f};
      strongS.x = gapX(sj.gap, f).x + f; strongS.y = L + SAFETY_D; strongS.rx = strongS.x; strongS.ry = strongS.y;   // the drawn mesh follows, no glide
      strongS.stunt = {st:'aligned', via:null, t0:0, blitz:true}; strongS.mode = 'rush';
    }
  }
  CBs.forEach(c => c.job = {role:'support', side:Math.sign(c.x) || 1});
  DEF.forEach(d => {
    d.read = (d.mode === 'rush' && d.role === 'LB') || (d.stunt && d.stunt.blitz) ? 0 : 0.6 - d.rt.recog/250;   // recognition: 0.24 s (95) .. 0.38 s (55)
    d.aimK = 1; d.aimT = 0; d.hold = null; d.lastDir = 0; d.lastAim = null; d.avoid = null; d.avoidAt = 0; d.actForce = false; d.sqz = false; d.sqzL = false; d.fillL = false; d.fhOff = false; d.fh = null; d.faceHold = null;
    d.home = Math.random() >= HOME_P*lack(d, 'pursuit');                // discipline: a poor pursuer abandons the backside early
    d.bite = ['gap', 'force', 'alley'].includes(d.job.role) && d.role !== 'DL' && Math.random() < BITE_P*lack(d, 'recog') ? BITE_T : 0;   // only roles that read-step with the flow
    d.levErr = rand(-1, 1)*(1 - d.rAwr/100)*2;                          // poor awareness = sloppier angles
    d.fit = d.job.gx != null && (d.role === 'DL' || d.role === 'LB' || d === boxS) ? {x:d.job.gx, y:d.role === 'DL' ? L - (d.job.role === 'two' ? 0.5 : FIRE_DEPTH) : L + 1.5} : null;
  });
  S.flow0 = RB.x;
  snapN++; snapPending = true;   // B-089: a new play
}
// Stunt states (fronts.js stuntStep): aligned holds his spot until STUNT_T (BLITZ_DELAY for a blitzer; B-011), looping runs the waypoint, gap attacks his new gap until // blitz-fire (B-011)
// the handoff, then free (normal fit). Returns null once free.
function stuntFit(d){
  const s = d.stunt, L = S.los, v = s.via, vy = v && L + v.dy;
  stuntStep(s, S.clock, !!v && Math.hypot(v.x - d.x, vy - d.y) < VIA_NEAR, S.clock > S.handoffAt);
  if(s.st === 'aligned') return [d.x, d.y];
  if(s.st === 'looping') return [v.x, vy];
  if(s.st === 'gap') return [d.job.gx, L + 0.5];
  return null;
}
// B-089: the force DL widens once the ball has moved FLOW_OUT toward his side from his own snap spot, and stays wide for the play (no flicker back at the handoff)
function wide(d, j){ const h = ball.holder; if(d.wideN !== snapN && (h === QB || h === RB || !h) && (h === QB ? QB.x - snapQB : RB.x - snapRB)*j.side >= FLOW_OUT) d.wideN = snapN; return d.wideN === snapN; }   // only the QB, the RB or the pitch in the air (no holder) count as flow; a receiver after a catch is not read against the RB's spot
// where the job sends him this frame
function runFit(d, c){
  if(snapPending){ snapQB = QB.x; snapRB = RB.x; snapPending = false; }   // B-089: the references for the force man's outside-flow read, taken at the snap whatever the formation did to the back; each holder is read against his own snap spot, so a gun back's alignment is not flow
  const latch = d.sqzL; d.sqzL = false;   // B-089: the latch lives only through consecutive contain() frames; any other return leaves it clear
  d.sqz = false;   // B-084: set only by contain() this frame, so the chase and backside-home branches never leave it on for avoidBlockers
  if(d.stunt){ const t = stuntFit(d); if(t) return t; }
  let j = d.job; const L = S.los, bx = c.x, by = c.y;
  if(S.clock <= S.handoffAt + d.read + d.bite){
    // before the read: linemen attack their gap, second level read-steps with the backfield, the rest hold
    const flow = ((ball.holder || RB).x - S.flow0)*(d.rAwr/100)*0.7;
    if(d.role === 'DL') return [j.gx, L - (j.role === 'two' ? 0.5 : j.role === 'force' && !wide(d, j) ? FORCE_FIRE_DEPTH : FIRE_DEPTH)];   // B-064 (dl-fire): a one-gapper explodes through his gap; a two-gapper attacks the blocker and holds square; B-084: the edge (force) man holds the line (FORCE_FIRE_DEPTH, a hair on his side of it) instead of crossing it, so the puller meets him at the line, not 2.5 yd deep
    if(j.role === 'gap' || j.role === 'force') return [j.gx + flow, L + (d.role === 'LB' ? 3.5 : 4)];
    if(j.role === 'alley') return [j.gx*0.7 + flow*0.5, L + 7];
    if(j.role === 'deep') return [flow*0.4, L + 12];
    return coverTarget(d);
  }
  if(d.role === 'S' && (j.role === 'alley' || j.role === 'deep') && S.runSeen && !S.boxS){   // B-094: two-high safeties (no safety rolled into the box: a one-high shell keeps its post man deep and its rolled man down) fill by the run side, not by a fixed role: once the ball commits (past ALLEY_X of the middle, or through the line) the safety on its side is the alley man, the other the deep man; latched for the play
    if(d.altN !== snapN && (Math.abs(bx) > ALLEY_X || by > L + RUN_SUPPORT_Y)){ const rs = Math.sign(bx) || 1; d.altN = snapN; d.alt = d.x*rs >= 0 ? {role:'alley', gx:bx, side:rs} : {role:'deep', side:0}; }
    if(d.altN === snapN) j = d.alt;
  }
  if(j.role === 'two'){ const left = bx < d.x; const gx = left ? j.gl : j.gr; j = {role:'gap', gx, side:Math.sign(gx) || (left ? -1 : 1)}; }   // read done: shed to the ball-side gap; his side is that gap's, so a run away still reads backside
  const s = j.side;
  if(S.clock >= d.aimT){ d.aimK = 1 + lack(d, 'pursuit')*AIM_AMP*rand(-1, 1); d.aimT = S.clock + AIM_T; }
  const dir = Math.abs(c.svx) > 0.8 ? Math.sign(c.svx) : 0, e = d.levErr;
  let [px, py] = intercept(d, c, d.aimK);
  if(dir && d.lastDir && dir !== d.lastDir && d.aimK > 1 && d.lastAim && Math.random() < HOLD_P*lack(d, 'pursuit')) d.hold = {x:d.lastAim[0], y:d.lastAim[1], until:S.clock + HOLD_T};   // cutback: he is still running to the old spot
  if(dir) d.lastDir = dir;
  d.lastAim = [px, py];
  if(d.hold){ if(S.clock < d.hold.until){ px = d.hold.x; py = d.hold.y; } else d.hold = null; }
  const lev = levShade(d), inside = () => [px - dir*lev + e, py];                 // pursue keeping inside leverage: no cutback behind him
  // B-084: the edge squeezes while the ball is clearly inside him and not bouncing out: outside leverage on the ball's line (SQUEEZE_X), at the line (meets the puller there), not wide and deep. SQUEEZE_BACK keeps him from closing more than this inside his own gap line
  // latched (d.sqzL) so the switch has a dead band: in at SQUEEZE_IN inside him, out only when the ball is outside him by SQUEEZE_X or bounces
  const squeeze = side => { const off = (bx - d.x)*side; d.sqzL = c.svx*side < BOUNCE_V && (latch ? off < SQUEEZE_X : off < -SQUEEZE_IN); return d.sqzL; };
  const contain = side => {
    d.sqz = squeeze(side);
    if(dist(d, c) <= 3) return [px + side*CONTAIN_SHOULDER, py];                                     // close: attack his outside shoulder
    if(d.sqz) return [side*Math.max(bx*side + SQUEEZE_X, (d.job.gx != null ? d.job.gx*side : d.x*side) - SQUEEZE_BACK) + e, Math.max(L + SQUEEZE_Y, by)];
    return [bx + side*CONTAIN_X + e, Math.max(L + 1, by + 1.5)];                                     // get outside and in front of him
  };
  // backside: ball went away from my side and hasn't cleared los+BACK_L: stay home on the cutback unless he closes on me
  if(d.home && S.runSeen && (j.role === 'force' || (j.role === 'gap' && d.role !== 'DL')) && bx*s < -BACK_HOME_X && by < L + BACK_L && dist(d, c) > BACK_D) return [j.gx + (bx - j.gx)*0.25, L + 0.5];
  switch(j.role){
    case 'gap':
      if(by < L + 1.5 && Math.abs(bx - j.gx) < FILL_DX && !(d.role === 'DL' && (d.fillL = dist(d, c) <= (d.fillL ? FILL_CLOSE + FILL_BAND : FILL_CLOSE)))) return [j.gx + (bx - j.gx)*0.5, L + 0.5];   // he's coming at my gap: fill and squeeze, then close on him (B-085)
      if(d.role === 'DL' && S.runSeen && backsideOf(j, bx) && by < L + BACK_L){ const [ix, iy] = inside(); return [ix, Math.min(iy, Math.max(L + FLAT_Y, by))]; }   // B-085: backside interior man runs the line at the runner
      return inside();
    case 'force':
      if(bx*s < -CHASE_X) return [px - dir*1 + e, Math.max(py, by)];  // ball is CHASE_X to my backside: chase (any depth)
      return contain(s);
    case 'alley':
      if(bx*s > ALLEY_X || by > L + 1) return inside();               // ball committed to my side: fill the alley
      return [bx*0.5 + j.gx*0.5, L + 6];
    case 'deep':
      if(dist(d, c) > 8 && !(S.runSeen && by > L + RUN_SUPPORT_Y)) return [bx, Math.max(by + 5, L + 8)];  // stay over the top of it, until a designed run is through the line (B-094: then every deep man is run support and fills at the runner, not 8 yd off him)
      return inside();
    case 'support': {
      const f = DEF.find(o => o.job && o.job.role === 'force' && o.job.side === s);
      const outflanked = !f || f.bt || f.stun > 0 || isBody(f) || (bx - f.x)*s > OUTFLANKED_X;
      d.actForce = bx*s > 0 && outflanked;                      // B-009: while he holds the force job avoidBlockers sets the edge for him too
      if(d.actForce) return contain(s);                        // my side, force man beaten: I'm the force now (actForce, so avoidBlockers sets the edge too)
      return d.bt ? [px, py] : coverTarget(d);
    }
  }
  return inside();
}
// A blocker in the cone ahead (within AVOID_DIST, AVOID_CONE of the path to the target): fight through (FIGHT_P) or step around.
// The cone is looked at every AVOID_EVERY s; a decision holds for AVOID_T s.
function avoidBlockers(d, c, tx, ty){
  if(d.bt || d.ph){ d.avoid = null; return [tx, ty]; }        // held (d.bt) or a physics body (d.ph): clear avoid, battle / physics owns him
  const a = d.avoid;
  if(a && S.clock < a.until){
    if(a.st === 'fight') return [tx, ty];
    return stepAround(d, a, tx, ty);
  }
  if(S.clock < d.avoidAt) return [tx, ty];
  d.avoidAt = S.clock + AVOID_EVERY; d.avoid = null;
  const hx = tx - d.x, hy = ty - d.y, hl = Math.hypot(hx, hy);
  if(hl < 0.5) return [tx, ty];
  let best = null, bd = AVOID_DIST;
  for(const o of OFF){
    if(o === c || o === QB || (o.ph && o.ph.bubble) || isBody(o) || (d.freeFrom === o && d.freeT > 0)) continue;
    const ox = o.x - d.x, oy = o.y - d.y, od = Math.hypot(ox, oy);
    if(od < bd && od > 0.01 && (ox*hx + oy*hy)/(od*hl) > COS_CONE){ best = o; bd = od; }
  }
  if(!best) return [tx, ty];
  let fight = Math.random() < Math.max(0, Math.min(1, d.rt.shed/99 - 0.3));
  const j = d.job, ox = best.x - d.x, oy = best.y - d.y;
  const force = j.role === 'force' || d.actForce;   // B-009: a support man who took over the force job counts
  const outX = force ? j.side : Math.sign(c.x - d.x) || 1;       // outside for the force man (or whoever took over), toward the ball for the rest
  let lat = [-hy/hl, hx/hl];                                    // perpendicular to his heading
  if(Math.abs(lat[0]) < 0.3) lat = [outX, 0];                   // heading sideways: pick the side by x directly
  else if(lat[0]*outX < 0) lat = [-lat[0], -lat[1]];
  const toBlk = ox*lat[0] + oy*lat[1];
  if(toBlk > 0.3){                                              // the blocker sits on my leverage side
    if(force) fight = true;                                     // the force man never gives up the edge: through him
    else lat = [-lat[0], -lat[1]];
  } else if(force && d.sqz) fight = true;                       // B-084: a squeezing edge takes the blocker on at the line, never steps wide around him
  d.avoid = {st:fight ? 'fight' : 'avoid', o:best, until:S.clock + AVOID_T, lat};
  return fight ? [tx, ty] : stepAround(d, d.avoid, tx, ty);
}
function stepAround(d, a, tx, ty){
  const hx = tx - d.x, hy = ty - d.y, hl = Math.hypot(hx, hy) || 1;
  return [d.x + hx/hl*AVOID_STEP + a.lat[0]*AVOID_STEP, d.y + hy/hl*AVOID_STEP + a.lat[1]*AVOID_STEP];
}
// B-020: who a blocked defender faces: his blocker, or a man double-teaming him who is clearly nearer (NEAR_SWAP yd), and he
// keeps his current man until another is that much nearer, so the facing never flips between two men at about the same distance
const NEAR_SWAP = 0.25, FRESH_T = 0.05;
function nearBlocker(d, o){
  const cand = q => q === o || (q.blk === d && !(q.ph && q.ph.bubble) && dist(q, d) < DBL_R);
  let cur = d.faceAt && cand(d.faceAt) && d.bt.t > FRESH_T ? d.faceAt : o;   // a new battle starts on its own blocker
  for(const q of OFF) if(q !== cur && cand(q) && dist(q, d) + NEAR_SWAP < dist(cur, d)) cur = q;
  return cur;
}
// B-072-2: facing holds (movement.js faceHold; speed caps and gait come from there). A non-blitzing LB stays square to the line, a DB in coverage faces the QB, until a trigger fires;
// then faceHold is null for the rest of the play (d.fhOff). Triggers (named constants):
//   LB in a run: the carrier is across the line, heads within LB_GAP_D of his gap laterally (once he is within LB_NEAR_Y of the line), or LB_READ_T s after the handoff
//   DB / LB in coverage: the man within DB_TURN_D and moving downfield (over DB_MOVE_V), or at DB_DEEP_V yd/s going deep within DB_DEEP_NEAR; the ball thrown. A deep zone DB (mode 'deep') bails (turns and runs) when the deepest receiver in his half is at DB_DEEP_V yd/s and within DB_BAIL_CUSH of him; else he keeps facing the QB until the throw.
// An engaged man's hold stays set (movement.js ignores it while p.bt), so his fh time is not counted.
// d.fh = {t, sq, end}: the sim's readout (time held, time within FH_SQ_DEG of the hold, play clock (LB: since the handoff) at the commit or turn, null if none)
const LB_GAP_D = 3, LB_NEAR_Y = 3, LB_READ_T = 0.6, DB_TURN_D = 2, DB_DEEP_V = 5, DB_DEEP_NEAR = 5, DB_MOVE_V = 1, DB_BAIL_CUSH = 4, FH_SQ_DEG = 30;   // DB_MOVE_V: the 2 yd turn needs the man moving downfield faster than this (a stopped hitch keeps the DB on the QB); DB_BAIL_CUSH: a deep zone DB bails when his deepest man in his half is this close (yd) at DB_DEEP_V
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
function holdFacing(d, c, runRead, dt){
  if(d.fhOff || d.role === 'DL' || d.mode === 'rush' || (d.stunt && d.stunt.blitz)) return null;
  const lb = d.role === 'LB', fh = d.fh || (d.fh = {t:0, sq:0, end:null});
  const end = () => { d.fhOff = true; fh.end = S.clock - (runRead && lb && S.handoffAt < Infinity ? S.handoffAt : 0); return null; };
  if(ball.state === 'air') return end();   // thrown: turn and run to the ball
  let yaw = 0, go = false;
  if(runRead){
    if(!lb) return null;   // a DB in a run play fits the run at once (no latch: the play can turn pass)
    const j = d.job, gx = j.role === 'two' ? (c.x < d.x ? j.gl : j.gr) : (j.gx !== undefined ? j.gx : d.x);
    go = c.y > S.los || (c.y > S.los - LB_NEAR_Y && Math.abs(c.x - gx) < LB_GAP_D) || S.clock > S.handoffAt + LB_READ_T;
  } else {
    yaw = lb ? 0 : bearing(d, QB);
    const w = d.mode === 'cover' ? d.assign : null;
    if(w) go = (dist(d, w) < DB_TURN_D && w.vy > DB_MOVE_V) || (w.vy > DB_DEEP_V && dist(d, w) < DB_DEEP_NEAR);
    else if(d.mode === 'deep'){ const deep = RECV.filter(r => r.x*d.side > -3).reduce((a, b) => !a || b.y > a.y ? b : a, null); go = !!deep && deep.vy > DB_DEEP_V && d.y - deep.y < DB_BAIL_CUSH; }   // the same man coverTarget drops over
  }
  if(go) return end();
  if(d.bt) return yaw;   // engaged: movement.js ignores the hold; not counted
  fh.t += dt; if(Math.abs(wrapPi(d.face - yaw)) < FH_SQ_DEG*Math.PI/180) fh.sq += dt;
  return yaw;
}
// B-065: the gap an engaged defender fights for: his own gap (job.gx); a two-gapper holds square (null) until his read, then takes the ball-side gap
function engagedGap(d, c){
  const j = d.job;
  if(!j || !S.runMode || !S.runSeen) return undefined;   // a run the defense has seen only: a pass rusher keeps the old leverage
  if(j.role !== 'two'){
    if(j.role === 'gap' && d.role === 'DL' && backsideOf(j, c.x) && c.y < S.los + BACK_L) return c.x;   // B-085: a backside interior man fights toward the ball, not back to his own gap
    return j.gx;
  }
  return S.clock <= S.handoffAt + d.read + d.bite ? null : (c.x < d.x ? j.gl : j.gr);
}
export function defenseAI(d, dt){
  if(d.tkCool > 0) d.tkCool -= dt;
  if(d.reachCool > 0) d.reachCool -= dt;
  if(d.latch){ d.faceHold = null; return; }                       // riding the runner: tackleUpdate moves him
  if(isBody(d)){ d.faceHold = null; d.stun -= dt; return; }    // ragdoll / tackler: the body moves him (a bubble body runs the AI below)
  if(d.stun > 0){ d.faceHold = null; d.stun -= dt; steer(d, d.x, d.y, 0, dt); return; }
  if(d.fireDelay > 0){ d.fireDelay -= dt; d.faceHold = null; return; }   // still in his stance, reading the ball
  logSpeed(d, d.spd);
  let c = ball.state === 'held' ? ball.holder : (ball.state === 'air' ? null : QB);
  const draw = PLAYS[S.play].delay && S.runMode;   // B-007-12 Draw: the defense reads pass until the handoff and its read delay, then the run fit
  const passRead = draw && S.clock <= S.handoffAt + d.read;
  if(c === QB && S.runMode && PLAYS[S.play].run === 'hand' && !passRead) c = RB;   // handoff coming: defenders key the back, not the QB at the mesh
  let tx, ty, sp = d.spd, attack = false;
  if(ball.state === 'air'){
    if(S.clock - ball.thrownAt > d.react && Math.hypot(ball.tx - d.x, ball.ty - d.y) < 18){ tx = ball.tx; ty = ball.ty; }
    else [tx, ty] = coverTarget(d);
  } else if(passRead && c){   // pass read: the line rushes the passer, everybody else drops into his coverage
    if(d.role === 'DL' || d.mode === 'rush'){ tx = QB.x; ty = QB.y; attack = true; } else [tx, ty] = coverTarget(d);
  } else if(S.runMode && c && d.job){
    [tx, ty] = runFit(d, c); attack = true;
    if(S.clock > S.handoffAt + d.read) [tx, ty] = avoidBlockers(d, c, tx, ty);
    if(S.clock > S.handoffAt + d.read) sp = (sp + 0.2)*burst(d, dist(d, c) > 3 && !d.bt, dt);   // same limited sprint the runner has
  } else if(d.mode === 'rush'){ tx = c ? c.x : QB.x; ty = c ? c.y : QB.y; attack = !!c; }
  else [tx, ty] = coverTarget(d);
  if(d.freeT > 0) d.freeT -= dt;
  if(attack){
    const free = o => d.freeFrom === o && d.freeT > 0;   // just beat this blocker: he can't re-engage yet
    const dc = dist(d, c);
    // a bubble body has no line battle: the physics world decides who gives way
    const past = S.runMode && c !== QB && c.y > d.y + RUNNER_PAST_Y;   // B-023: the ball is by him: no block holds him
    const bo = d.bt && d.bt.o;   // B-023: his live battle's blocker stays his while he is still on him (bo.blk === d) or has nobody else, within BT_KEEP_D
    const kept = bo && !past && !d.ph && !isBody(bo) && !free(bo) && bo !== c && bo !== QB && dist(bo, d) < BT_KEEP_D && (bo.blk === d || !bo.blk || bo.blk.stun > 0) ? bo : null;   // the nearer-the-ball fallback is for new contacts only: a blocker with another live assignment (a stunt re-read, a climber) lets go
    const o = past ? null : kept || (d.ph ? null : OFF.find(o => !(o.ph && o.ph.bubble) && o.blk === d && o !== c && dist(o, d) < ENGAGED_D && !free(o))
           || (d.ph ? null : OFF.find(o => !(o.ph && o.ph.bubble) && o !== c && o !== QB && dist(o, d) < ENGAGED_D && dist(o, c) < dc && !free(o))));
    if(o && o.blk !== d && Math.hypot(o.vx, o.vy) > TOW_V){   // B-023: a blocker for somebody else running past him: end the battle, do not tow the defender along his route
      if(!(d.freeT > TOW_FREE_T)){ d.freeFrom = o; d.freeT = TOW_FREE_T; }   // never shorten the hold on a blocker he just beat
      d.towT = S.clock; d.bt = null;   // towT: the sim's jitterLost reason 'tow'
    } else if(o){
      if(!d.bt || d.bt.o !== o){
        // first contact: a blocker arriving with a lot more momentum than the defender can absorb flattens him
        if(d.freeFrom !== o && pancakeHit(o, d)) return;
        // re-engaging a blocker he already beat: that blocker is off balance, so the next move comes quicker
        d.bt = {o, ang:Math.atan2(d.x - o.x, d.y - o.y), phase:'set', t:0, dur:d.freeFrom === o ? 0.1 : rand(0.2, 0.4), move:null};
        if(d.avoid && d.avoid.st === 'fight' && d.avoid.o === o) d.bt.dur = Math.min(d.bt.dur, FIGHT_QUICK);   // he came through on purpose: straight into his shed move
        o.bt = d.bt;
        if(d.freeFrom !== o){ const cv = {x:d.vx, y:d.vy}; pop(o, d, d.bt); if(d.bt.phase !== 'recover') d.bt.cv = cv; }   // a blocker who wins the get-off (pop sets recover) takes the pair: no coast   // B-023: the defender's own charge (his velocity into the hit), which blocking.js carries for CARRY_T s
      }
      d.eng = o.eng = 0.15;
      d.faceAt = nearBlocker(d, o);   // B-020: square to his blocker (the nearer of a double team) until the battle ends
      d.bt.gx = engagedGap(d, c);   // B-065: the lock (blocking.js) turns the pair by this gap and the strength matchup
      battle(d, o, c, dt);
    } else d.bt = null;
  } else d.bt = null;
  if(!d.bt && d.faceAt && d.faceAt.team === 'O' && !d.latch) d.faceAt = null;   // B-020: a battle that ended outside blocking.js (avoidBlockers, a bubble promote); a tackle's faceAt comes with d.latch, which returned above
  d.faceHold = holdFacing(d, c, !!(ball.state !== 'air' && !passRead && S.runMode && c && d.job), dt);   // B-072-2
  d.fireAcc = false;   // B-064 (dl-fire): set below, only while the ball is not in the air
  if(ball.state !== 'air'){   // B-060-2: situational speed
    const open = c && attack && S.runMode && (c.y > d.y + RUNNER_PAST_Y || c.y > S.los + OPEN_Y);
    const reading = S.runMode && c && S.runSeen && d.role !== 'DL' && S.clock <= S.handoffAt + d.read + d.bite;   // run plays only: a catch sets runMode too
    const rush = attack && !S.runMode && (d.role === 'DL' || d.mode === 'rush') && S.clock < RUSH_FULL_T;
    const fire = attack && d.role === 'DL' && d.job && d.job.role !== 'two' && S.clock < FIRE_T;   // B-064 (dl-fire): every one-gap DL fires on every snap, run or pass (he can't know the play yet); acceleration is x FIRE_ACC for the get-off, on top of movement.js p.fire x FIRE_K 1.3 for its first 0.35 s (about 2.3x then, FIRE_ACC alone after) (acceleration, not wanted speed, limits the first yards; offense.js:98 does the same for a blocker)
    d.fireAcc = fire;
    sp *= open || rush || fire ? 1 : reading ? READ_F : attack ? PURSUE_F : d.mode === 'cover' ? (d.assign && d.assign.wp > 0 ? 1 : MAN_STEM_F) : ZONE_F;
  }
  if(d.bt) return;   // B-023: engaged, the battle (blocking.js lock) moves him; he does not steer himself
  const a0 = d.acc; if(d.fireAcc) d.acc *= FIRE_ACC;   // B-064 (dl-fire)
  if(attack && !d.bt && c){   // hunting the runner: run through the target, never ease up approaching it
    const dx = tx - d.x, dy = ty - d.y, l = Math.hypot(dx, dy) || 1;
    steerVel(d, dx/l*sp, dy/l*sp, dt);
  } else steer(d, tx, ty, sp, dt);
  d.acc = a0;
}
