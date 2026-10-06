import { battle, pancakeHit } from './blocking.js';
import { burst } from './carrier.js';
import { steer, steerVel } from './movement.js';
import { PLAYS } from './playbook.js';
import { CBs, DEF, DL, LBs, OFF, QB, RB, RECV, SFs } from './players.js';
import { isBody } from './physics.js';
import { S, ball } from './state.js';
import { dist, rand } from './util.js';

// pursuit: run to the point where I can actually meet the runner, using his smoothed velocity
// (solve |r + v·t| = s·t for the earliest t > 0); if he is faster, aim where he will be soon
function intercept(d, c){
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
  return [c.x + vx*t, c.y + vy*t];
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
// Gaps, offense's view: A beside the center, B outside the guards, C outside the tackles, D outside the TE (right).
const GAP = {AL:-1.1, BL:-3.3, CL:-5.6, AR:1.1, BR:3.3, CR:5.6, DR:8.2};
// Jobs:
//   gap     own one gap: fill it while the ball can still come there, then pursue inside-out (no cutback behind him)
//   force   own the edge on one side: nothing gets outside him; squeeze the runner back in. Ball goes away: backside chase
//   alley   safety between the force and the box: hold, then fill inside-out once the ball commits to his side
//   deep    last line: stay deeper than the ball, mirror it, come downhill only when it's close
//   support corner: cover his man; becomes the force if the force man is blocked, down or outflanked
// Ratings decide how well: awareness = read time, read-step quality and angle discipline; speed = pursuit;
// power / speed vs the blocker = shedding (line battle); tackling = the tackle.
const FITS = {   // DL0..3, LB0 (left), LB1 (right): [job, gap]
  'Base':             [['force','CL'], ['gap','AL'], ['gap','AR'], ['gap','CR'], ['gap','BL'], ['gap','BR']],
  'Slant Left':       [['force','CL'], ['gap','BL'], ['gap','AL'], ['gap','BR'], ['gap','AR'], ['gap','CR']],
  'Slant Right':      [['gap','BL'],   ['gap','AR'], ['gap','BR'], ['force','DR'], ['force','CL'], ['gap','AL']],
  'Run Blitz':        [['force','CL'], ['gap','AL'], ['gap','AR'], ['gap','CR'], ['gap','BL'], ['gap','BR']],
  'Eight in the Box': [['force','CL'], ['gap','AL'], ['gap','AR'], ['gap','CR'], ['gap','BL'], ['gap','BR']]
};
export function assignFits(call, boxS){
  const L = S.los, box = [...DL, ...LBs];
  FITS[call.name].forEach(([job, g], i) => { const d = box[i]; d.job = {role:job, gx:GAP[g], side:Math.sign(GAP[g])}; });
  const [sl, sr] = [...SFs].sort((a, b) => a.x - b.x);
  // right edge (TE side) belongs to a safety unless the front already put a man there
  const rightForce = box.some(d => d.job.role === 'force' && d.job.side > 0);
  if(boxS){
    // eight in the box: the rolled-down safety is the force on his side, the other plays deep middle alone
    boxS.job = {role:'force', gx:boxS.side > 0 ? GAP.DR : GAP.CL - 1.5, side:boxS.side};
    if(boxS.side < 0) box.find(d => d.job.role === 'force' && d.job.side < 0).job = {role:'gap', gx:GAP.CL, side:-1};
    const other = boxS === sl ? sr : sl; other.job = {role:'deep', side:0};
    if(boxS.side < 0 && !rightForce) LBs[1].job = {role:'force', gx:GAP.DR, side:1};
  } else {
    sr.job = rightForce ? {role:'alley', gx:GAP.DR, side:1} : {role:'force', gx:GAP.DR + 1, side:1};
    sl.job = {role:'deep', side:0};
  }
  CBs.forEach(c => c.job = {role:'support', side:Math.sign(c.x) || 1});
  DEF.forEach(d => {
    d.read = d.mode === 'rush' && d.role === 'LB' ? 0 : 0.6 - d.rAwr/250;   // awareness: 0.24 s (95) .. 0.38 s (55)
    d.levErr = rand(-1, 1)*(1 - d.rAwr/100)*2;                          // poor awareness = sloppier angles
    d.fit = d.job.gx != null && (d.role === 'DL' || d.role === 'LB' || d === boxS) ? {x:d.job.gx, y:d.role === 'DL' ? L - 0.5 : L + 1.5} : null;
  });
  S.flow0 = RB.x;
}
// where the job sends him this frame
function runFit(d, c){
  const j = d.job, L = S.los, bx = c.x, by = c.y, s = j.side;
  if(S.clock <= S.handoffAt + d.read){
    // before the read: linemen attack their gap, second level read-steps with the backfield, the rest hold
    const flow = ((ball.holder || RB).x - S.flow0)*(d.rAwr/100)*0.7;
    if(d.role === 'DL') return [j.gx, L - 0.5];
    if(j.role === 'gap' || j.role === 'force') return [j.gx + flow, L + (d.role === 'LB' ? 3.5 : 4)];
    if(j.role === 'alley') return [j.gx*0.7 + flow*0.5, L + 7];
    if(j.role === 'deep') return [flow*0.4, L + 12];
    return coverTarget(d);
  }
  const [px, py] = intercept(d, c), dir = Math.abs(c.svx) > 0.8 ? Math.sign(c.svx) : 0, e = d.levErr;
  const inside = () => [px - dir*0.8 + e, py];                 // pursue keeping inside leverage: no cutback behind him
  const contain = side => dist(d, c) > 3
    ? [bx + side*1.5 + e, Math.max(L + 1, by + 1.5)]            // get outside and in front of him
    : [px + side*0.5, py];                                      // close: attack his outside shoulder
  switch(j.role){
    case 'gap':
      if(by < L + 1.5 && Math.abs(bx - j.gx) < 2.5) return [j.gx + (bx - j.gx)*0.5, L + 0.5];   // he's coming at my gap: fill and squeeze
      return inside();
    case 'force':
      if(bx*s < -2) return [px - dir*1 + e, Math.max(py, by)];  // ball went away: backside, take the cutback
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
    if(S.clock > S.handoffAt + d.read) sp = (sp + 0.2)*burst(d, dist(d, c) > 3 && !d.bt, dt);   // same limited sprint the runner has
  } else if(d.mode === 'rush'){ tx = c ? c.x : QB.x; ty = c ? c.y : QB.y; attack = !!c; }
  else [tx, ty] = coverTarget(d);
  if(d.freeT > 0) d.freeT -= dt;
  if(attack){
    const free = o => d.freeFrom === o && d.freeT > 0;   // just beat this blocker: he can't re-engage yet
    const dc = dist(d, c);
    // a bubble body has no line battle: the physics world decides who gives way
    const o = d.ph ? null : OFF.find(o => !o.ph && o.blk === d && o !== c && dist(o, d) < 1.3 && !free(o))
           || (d.ph ? null : OFF.find(o => !o.ph && o !== c && o !== QB && dist(o, d) < 1.3 && dist(o, c) < dc && !free(o)));
    if(o){
      if(!d.bt || d.bt.o !== o){
        // first contact: a blocker arriving with a lot more momentum than the defender can absorb flattens him
        if(d.freeFrom !== o && pancakeHit(o, d)) return;
        // re-engaging a blocker he already beat: that blocker is off balance, so the next move comes quicker
        d.bt = {o, phase:'set', t:0, dur:d.freeFrom === o ? 0.1 : rand(0.2, 0.4), move:null};
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
