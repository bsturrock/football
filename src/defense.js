import { battle, pancakeHit } from './blocking.js';
import { burst } from './carrier.js';
import { steer, steerVel } from './movement.js';
import { FRONTS, STUNTS, SAFETY_D, VIA_NEAR, safetyJob, gapX, stuntStep } from './fronts.js';
import { PLAYS } from './playbook.js';
import { CBs, DEF, DL, LBs, OFF, QB, RB, RECV, SFs } from './players.js';
import { isBody } from './physics.js';
import { S, ball } from './state.js';
import { lack } from './ratings.js';
import { dist, rand } from './util.js';

// Human mistakes in pursuit. Per defender per play state (reset in assignFits):
//   aim     AIM_K resampled every AIM_T s; < 1 undershoots the cut-off spot, > 1 overpursues
//   holding runner cuts back while AIM_K > 1 (overrunning): with p HOLD_P*lack(pursuit) keep running to the old future spot for HOLD_T s;
//           another flip while holding re-holds the newest spot
//   bite    with p BITE_P*lack(recog) follows the first flow step BITE_T s longer
// Leverage and blockers (B-006-6). Per defender per play: avoid = {st, o, until, lat}, st 'avoid' | 'fight'
//   pursuing  default: runFit target
//   avoiding  a blocker sits in the AVOID_CONE within AVOID_DIST of his path (checked every AVOID_EVERY s) and he lost the FIGHT_P roll:
//             steps around to his leverage side (outside for the force man, toward the ball for the rest) for AVOID_T s
//   fighting  won the FIGHT_P = shed/99 - 0.3 roll: runs straight through the blocker, quick shed move on contact
//   held      engaged (d.bt): the line battle owns him; avoid state cleared
// Backside (ball away from his side, not past los+BACK_L): stays home near his gap unless the runner closes within BACK_D
const AVOID_CONE = 30, AVOID_DIST = 2.5, AVOID_EVERY = 0.1, AVOID_T = 0.5, AVOID_STEP = 1.6, BACK_D = 3, BACK_L = 3, HOME_P = 0.5, FIGHT_QUICK = 0.15;
const COS_CONE = Math.cos(AVOID_CONE*Math.PI/180);
const levShade = d => 0.8*(0.5 + d.rt.pursuit/200);   // LEV_SHADE: how far he keeps to his leverage side
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
    d.aimK = 1; d.aimT = 0; d.hold = null; d.lastDir = 0; d.lastAim = null; d.avoid = null; d.avoidAt = 0;
    d.home = Math.random() >= HOME_P*lack(d, 'pursuit');                // discipline: a poor pursuer abandons the backside early
    d.bite = ['gap', 'force', 'alley'].includes(d.job.role) && d.role !== 'DL' && Math.random() < BITE_P*lack(d, 'recog') ? BITE_T : 0;   // only roles that read-step with the flow
    d.levErr = rand(-1, 1)*(1 - d.rAwr/100)*2;                          // poor awareness = sloppier angles
    d.fit = d.job.gx != null && (d.role === 'DL' || d.role === 'LB' || d === boxS) ? {x:d.job.gx, y:d.role === 'DL' ? L - 0.5 : L + 1.5} : null;
  });
  S.flow0 = RB.x;
}
// Stunt states (fronts.js stuntStep): aligned holds his spot until STUNT_T, looping runs the waypoint, gap attacks his new gap until
// the handoff, then free (normal fit). Returns null once free.
function stuntFit(d){
  const s = d.stunt, L = S.los, v = s.via, vy = v && L + v.dy;
  stuntStep(s, S.clock, !!v && Math.hypot(v.x - d.x, vy - d.y) < VIA_NEAR, S.clock > S.handoffAt);
  if(s.st === 'aligned') return [d.x, d.y];
  if(s.st === 'looping') return [v.x, vy];
  if(s.st === 'gap') return [d.job.gx, L + 0.5];
  return null;
}
// where the job sends him this frame
function runFit(d, c){
  if(d.stunt){ const t = stuntFit(d); if(t) return t; }
  let j = d.job; const L = S.los, bx = c.x, by = c.y;
  if(S.clock <= S.handoffAt + d.read + d.bite){
    // before the read: linemen attack their gap, second level read-steps with the backfield, the rest hold
    const flow = ((ball.holder || RB).x - S.flow0)*(d.rAwr/100)*0.7;
    if(d.role === 'DL') return [j.gx, L - 0.5];
    if(j.role === 'gap' || j.role === 'force') return [j.gx + flow, L + (d.role === 'LB' ? 3.5 : 4)];
    if(j.role === 'alley') return [j.gx*0.7 + flow*0.5, L + 7];
    if(j.role === 'deep') return [flow*0.4, L + 12];
    return coverTarget(d);
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
  const contain = side => dist(d, c) > 3
    ? [bx + side*1.5 + e, Math.max(L + 1, by + 1.5)]            // get outside and in front of him
    : [px + side*0.5, py];                                      // close: attack his outside shoulder
  // backside: ball went away from my side and hasn't cleared los+BACK_L: stay home on the cutback unless he closes on me
  if(d.home && PLAYS[S.play].run && (j.role === 'gap' || j.role === 'force') && bx*s < -1.5 && by < L + BACK_L && dist(d, c) > BACK_D) return [j.gx + (bx - j.gx)*0.25, L + 0.5];
  switch(j.role){
    case 'gap':
      if(by < L + 1.5 && Math.abs(bx - j.gx) < 2.5) return [j.gx + (bx - j.gx)*0.5, L + 0.5];   // he's coming at my gap: fill and squeeze
      return inside();
    case 'force':
      if(bx*s < -2) return [px - dir*1 + e, Math.max(py, by)];  // ball went away and past los+3: backside chase
      return contain(s);
    case 'alley':
      if(bx*s > 1 || by > L + 1) return inside();               // ball committed to my side: fill the alley
      return [bx*0.5 + j.gx*0.5, L + 6];
    case 'deep':
      if(dist(d, c) > 8) return [bx, Math.max(by + 5, L + 8)];  // stay over the top of it
      return inside();
    case 'support': {
      const f = DEF.find(o => o.job && o.job.role === 'force' && o.job.side === s);
      const outflanked = !f || f.bt || f.stun > 0 || isBody(f) || (bx - f.x)*s > 0.5;
      if(bx*s > 0 && outflanked) return contain(s);            // my side, force man beaten: I'm the force now
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
  const outX = j.role === 'force' ? j.side : Math.sign(c.x - d.x) || 1;       // outside for the force man, toward the ball for the rest
  let lat = [-hy/hl, hx/hl];                                    // perpendicular to his heading
  if(Math.abs(lat[0]) < 0.3) lat = [outX, 0];                   // heading sideways: pick the side by x directly
  else if(lat[0]*outX < 0) lat = [-lat[0], -lat[1]];
  const toBlk = ox*lat[0] + oy*lat[1];
  if(toBlk > 0.3){                                              // the blocker sits on my leverage side
    if(j.role === 'force') fight = true;                        // the force man never gives up the edge: through him
    else lat = [-lat[0], -lat[1]];
  }
  d.avoid = {st:fight ? 'fight' : 'avoid', o:best, until:S.clock + AVOID_T, lat};
  return fight ? [tx, ty] : stepAround(d, d.avoid, tx, ty);
}
function stepAround(d, a, tx, ty){
  const hx = tx - d.x, hy = ty - d.y, hl = Math.hypot(hx, hy) || 1;
  return [d.x + hx/hl*AVOID_STEP + a.lat[0]*AVOID_STEP, d.y + hy/hl*AVOID_STEP + a.lat[1]*AVOID_STEP];
}
export function defenseAI(d, dt){
  if(d.tkCool > 0) d.tkCool -= dt;
  if(d.reachCool > 0) d.reachCool -= dt;
  if(d.latch) return;                       // riding the runner: tackleUpdate moves him
  if(isBody(d)){ d.stun -= dt; return; }    // ragdoll / tackler: the body moves him (a bubble body runs the AI below)
  if(d.stun > 0){ d.stun -= dt; steer(d, d.x, d.y, 0, dt); return; }
  if(d.fireDelay > 0){ d.fireDelay -= dt; return; }   // still in his stance, reading the ball
  let c = ball.state === 'held' ? ball.holder : (ball.state === 'air' ? null : QB);
  if(c === QB && S.runMode && PLAYS[S.play].run === 'hand') c = RB;   // handoff coming: defenders key the back, not the QB at the mesh
  let tx, ty, sp = d.spd, attack = false;
  if(ball.state === 'air'){
    if(S.clock - ball.thrownAt > d.react && Math.hypot(ball.tx - d.x, ball.ty - d.y) < 18){ tx = ball.tx; ty = ball.ty; }
    else [tx, ty] = coverTarget(d);
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
    const o = d.ph ? null : OFF.find(o => !(o.ph && o.ph.bubble) && o.blk === d && o !== c && dist(o, d) < 1.3 && !free(o))
           || (d.ph ? null : OFF.find(o => !(o.ph && o.ph.bubble) && o !== c && o !== QB && dist(o, d) < 1.3 && dist(o, c) < dc && !free(o)));
    if(o){
      if(!d.bt || d.bt.o !== o){
        // first contact: a blocker arriving with a lot more momentum than the defender can absorb flattens him
        if(d.freeFrom !== o && pancakeHit(o, d)) return;
        // re-engaging a blocker he already beat: that blocker is off balance, so the next move comes quicker
        d.bt = {o, phase:'set', t:0, dur:d.freeFrom === o ? 0.1 : rand(0.2, 0.4), move:null};
        if(d.avoid && d.avoid.st === 'fight' && d.avoid.o === o) d.bt.dur = Math.min(d.bt.dur, FIGHT_QUICK);   // he came through on purpose: straight into his shed move
        o.bt = d.bt;
        if(d.freeFrom !== o) pop(o, d, d.bt);
      }
      d.eng = o.eng = 0.15; sp *= 0.12;
      battle(d, o, c, dt);
    } else d.bt = null;
  } else d.bt = null;
  if(attack && !d.bt && c){   // hunting the runner: run through the target, never ease up approaching it
    const dx = tx - d.x, dy = ty - d.y, l = Math.hypot(dx, dy) || 1;
    steerVel(d, dx/l*sp, dy/l*sp, dt);
  } else steer(d, tx, ty, sp, dt);
}
