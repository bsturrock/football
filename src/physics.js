import { C, DEF, G, TEAM, mat } from './players.js';
import { scene } from './scene.js';
import { S, ball } from './state.js';
import { PLANT_A, gripK } from './tackling.js';
import { clamp } from './util.js';

// ---------- body physics ----------
// Players who get hit become physical bodies (cannon-es): 10 solid parts with mass, joined at the
// joints. Nothing is scripted: muscles drive each joint toward the pose the animation rig wants
// (bracing, wrapping up, running) with limited strength, joint limits keep knees / elbows / shoulders
// inside human ranges, and parts collide with the ground, with each other and with every other player.
// `bal` is how much he's still on his feet: legs hold him up, keep him upright and drive him where
// he wants to go. A tackle is just the tacklers' grips and leg drive beating that, and then gravity.
const PH_DT = 1/180, PH_G = 10.7, MASS_KG = 0.45, ARM_GRIP = 10;
// name, rig pivot, parent, box size, center in pivot frame, mass share, joint limits [x],[y],[z] (rad,
// rotation vector relative to the rig's rest pose), meshes
const PARTS = [
  {n:'torso', j:'torso', size:[0.75,0.8,0.42], c:[0,0.37,0], m:0.5},
  {n:'head',  j:'head',  p:'torso', size:[0.46,0.44,0.5], c:[0,0.24,0], m:0.08, lim:[[-0.6,0.6],[-1,1],[-0.5,0.5]]},
  {n:'uaL', j:'shL', p:'torso', size:[0.2,0.42,0.22], c:[0,-0.21,0], m:0.03, lim:[[-3.1,1],[-1,1],[-0.3,1.8]]},
  {n:'faL', j:'elL', p:'uaL', size:[0.18,0.4,0.2], c:[0,-0.2,0], m:0.025, lim:[[-2.5,0],[-0.15,0.15],[-0.15,0.15]]},
  {n:'uaR', j:'shR', p:'torso', size:[0.2,0.42,0.22], c:[0,-0.21,0], m:0.03, lim:[[-3.1,1],[-1,1],[-1.8,0.3]]},
  {n:'faR', j:'elR', p:'uaR', size:[0.18,0.4,0.2], c:[0,-0.2,0], m:0.025, lim:[[-2.5,0],[-0.15,0.15],[-0.15,0.15]]},
  {n:'thL', j:'hipL', p:'torso', size:[0.28,0.5,0.3], c:[0,-0.25,0], m:0.1, lim:[[-2,0.6],[-0.6,0.6],[-0.3,0.9]]},
  {n:'snL', j:'kneeL', p:'thL', size:[0.24,0.55,0.3], c:[0,-0.27,0.03], m:0.06, lim:[[0,2.5],[-0.1,0.1],[-0.1,0.1]]},
  {n:'thR', j:'hipR', p:'torso', size:[0.28,0.5,0.3], c:[0,-0.25,0], m:0.1, lim:[[-2,0.6],[-0.6,0.6],[-0.9,0.3]]},
  {n:'snR', j:'kneeR', p:'thR', size:[0.24,0.55,0.3], c:[0,-0.27,0.03], m:0.06, lim:[[0,2.5],[-0.1,0.1],[-0.1,0.1]]}
];
const PI_ = Object.fromEntries(PARTS.map((d, i) => [d.n, i]));
let PW = null;
const PHYS = [];
const GRP = {ground:1, proxy:2, part:4};
export function physInit(){
  PW = new CANNON.World({gravity: new CANNON.Vec3(0, -PH_G, 0)});
  [qc, qd, qe] = [0, 0, 0].map(() => new CANNON.Quaternion()); [rv, rt, tw, dw] = [0, 0, 0, 0].map(() => new CANNON.Vec3());
  PW.solver.iterations = 20; PW.allowSleep = false;
  const turf = new CANNON.Material('turf'), body = new CANNON.Material('body');
  // soft contact correction: overlapping bodies ease apart instead of exploding apart
  const soft = {contactEquationStiffness:4e5, contactEquationRelaxation:4};
  PW.addContactMaterial(new CANNON.ContactMaterial(turf, body, {friction:0.7, restitution:0, ...soft}));
  PW.addContactMaterial(new CANNON.ContactMaterial(body, body, {friction:0.35, restitution:0, ...soft}));
  PW.bodyMat = body;
  const g = new CANNON.Body({mass:0, material:turf, collisionFilterGroup:GRP.ground, collisionFilterMask:GRP.part});
  g.addShape(new CANNON.Plane()); g.quaternion.setFromEuler(-Math.PI/2, 0, 0); PW.addBody(g);
  // ponytail: animated players have no collision body (blocks they ride on / get launched by looked worse);
  // physical bodies only collide with each other and the turf. Add capsule proxies if piles need blockers in them.
}
const tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), tv = new THREE.Vector3(), tv2 = new THREE.Vector3();
const toC = q => new CANNON.Quaternion(q.x, q.y, q.z, q.w);
const rigQ = (p, j, out) => p.j[j].getWorldQuaternion(out);
const rigP = (p, j, out) => p.j[j].getWorldPosition(out);
// opts: vx, vy (game velocity), up, spin {x, y} (game-space lean rate), bal (0 = off his feet), ttl
export function physOn(p, o={}){
  if(!PW) return null;
  if(p.ph){ if(o.bal != null) p.ph.bal = Math.min(p.ph.bal, o.bal); return p.ph; }
  p.mesh.updateMatrixWorld(true);
  const M = p.mass*MASS_KG, vx = o.vx ?? p.vx, vy = o.vy ?? p.vy, up = o.up || 0, sp = o.spin || {x:0, y:0};
  const cap = 9, s = Math.hypot(vx, vy), k = s > cap ? cap/s : 1;
  const w = new CANNON.Vec3(-sp.y, 0, -sp.x);   // lean rate as an angular velocity (top moves along spin)
  const bodies = PARTS.map(d => {
    rigQ(p, d.j, tq); rigP(p, d.j, tv);
    const c = tv2.set(...d.c).applyQuaternion(tq).add(tv);
    const b = new CANNON.Body({mass:M*d.m, material:PW.bodyMat, collisionFilterGroup:GRP.part, collisionFilterMask:GRP.ground|GRP.proxy|GRP.part,
      linearDamping:0.05, angularDamping:0.2});
    const sz = d.n === 'torso' ? [0.66, 0.8, 0.4] : d.size;    // torso collides a bit narrower than the pads look
    b.addShape(new CANNON.Box(new CANNON.Vec3(sz[0]/2, sz[1]/2, sz[2]/2)));
    b.position.set(c.x, c.y, c.z); b.quaternion.copy(toC(tq));
    b.velocity.set(vx*k + sp.x*c.y, up, -(vy*k + sp.y*c.y)); b.angularVelocity.copy(w);
    PW.addBody(b); return b;
  });
  const joints = PARTS.map((d, i) => {
    if(!d.p) return null;
    const a = bodies[PI_[d.p]], b = bodies[i];
    rigP(p, d.j, tv);
    const pa = new CANNON.Vec3(), pb = new CANNON.Vec3(), jw = new CANNON.Vec3(tv.x, tv.y, tv.z);
    a.pointToLocalFrame(jw, pa); b.pointToLocalFrame(jw, pb);
    const c = new CANNON.PointToPointConstraint(a, pa, b, pb); c.collideConnected = false; PW.addConstraint(c); return c;
  });
  p.body.visible = false;
  p.ph = {bodies, joints, grips:[], bal:o.bal ?? 1, ttl:o.ttl ?? Infinity, t:0, M, meshes:physMeshes(p)};
  PHYS.push(p);
  return p.ph;
}
export function physOff(p){
  const ph = p.ph; if(!ph) return;
  physUngrip(p); PHYS.filter(q => q.ph).forEach(q => q.ph.grips = q.ph.grips.filter(g => { if(g.on === p){ PW.removeConstraint(g.c); return false; } return true; }));
  ph.joints.forEach(c => c && PW.removeConstraint(c)); ph.bodies.forEach(b => PW.removeBody(b));
  ph.meshes.forEach(m => m.visible = false); p.body.visible = true;
  p.ph = null; PHYS.splice(PHYS.indexOf(p), 1);
  if(p.act === 'dive' || p.act === 'down' || p.act === 'fall') p.act = null;
}
export function physClear(){ while(PHYS.length) physOff(PHYS[0]); }
// grab: tackler's hands latch onto the closest part of the runner. maxForce = grip strength.
export function physGrip(d, c, kind){ const D = physOn(d), C = physOn(c); if(D && C){ D.reach = {on:c, kind, t:0}; } }
// distance from a world point to the nearest of his torso / thigh boxes
function surfDist(C, w){
  let m = 1e9; const loc = new CANNON.Vec3();
  for(const n of ['torso','thL','thR']){
    const b = C.bodies[PI_[n]], he = b.shapes[0].halfExtents; b.pointToLocalFrame(w, loc);
    m = Math.min(m, Math.hypot(Math.max(0, Math.abs(loc.x) - he.x), Math.max(0, Math.abs(loc.y) - he.y), Math.max(0, Math.abs(loc.z) - he.z)));
  }
  return m;
}
// hands lock on once they're actually on him (within a few inches of his body)
function physReach(d){
  const D = d.ph, R = D.reach, C = R.on.ph; if(!C) { D.reach = null; return; }
  const hb = D.bodies[PI_.faL], hw = hb.pointToWorldFrame(new CANNON.Vec3(0, -0.2, 0)), hb2 = D.bodies[PI_.faR], hw2 = hb2.pointToWorldFrame(new CANNON.Vec3(0, -0.2, 0));
  const tb = D.bodies[0];   // hands on him, or his body into him: either way he gets his arms around him
  if(Math.min(surfDist(C, hw), surfDist(C, hw2)) < 0.3 || surfDist(C, tb.position) < 0.45){ D.reach = null; lockGrip(d, R.on, R.kind); }
}
function lockGrip(d, c, kind){
  const D = d.ph, C = c.ph;
  const hands = kind === 'wrap' ? ['faL', 'faR'] : ['faL'];
  for(const h of hands){
    const hb = D.bodies[PI_[h]], hw = hb.pointToWorldFrame(new CANNON.Vec3(0, -0.2, 0));
    let best = null, bd = 1e9;
    for(const n of ['torso','thL','thR']){ const b = C.bodies[PI_[n]], k = b.position.distanceTo(hw); if(k < bd){ bd = k; best = b; } }
    const loc = new CANNON.Vec3(); best.pointToLocalFrame(hw, loc);
    const he = best.shapes[0].halfExtents;   // hold the surface, not thin air
    loc.set(clamp(loc.x, -he.x, he.x), clamp(loc.y, -he.y, he.y), clamp(loc.z, -he.z, he.z));
    const g = new CANNON.PointToPointConstraint(hb, new CANNON.Vec3(0, -0.2, 0), best, loc);
    // what his hands can hold (force); one hand holds a lot less than a runner's legs pull
    const cap = d.mass*MASS_KG*(kind === 'wrap' ? 150 : ARM_GRIP)*(d.rTkl/80);
    g.collideConnected = false; PW.addConstraint(g); D.grips.push({c:g, on:c, hb, best, loc, born:D.t, cap});
  }
}
export function physUngrip(d){ if(!d.ph) return; d.ph.grips.forEach(g => PW.removeConstraint(g.c)); d.ph.grips = []; }
// how hard each grip is being pulled vs what the hands can hold (>1 = slipping)
export function gripStrain(d){
  let m = 0; if(!d.ph) return 0;
  for(const g of d.ph.grips){ if(d.ph.t - g.born < 0.35) continue;   // the hit itself isn't a pull
    const c = g.c; m = Math.max(m, Math.hypot(c.equationX.multiplier, c.equationY.multiplier, c.equationZ.multiplier)/g.cap); }
  return m;
}
// how far a grip has been torn open (yd): his drive pulling out of the tackler's hands
export function gripGap(d){
  let m = 0; if(!d.ph) return 0;
  for(const g of d.ph.grips){ if(d.ph.t - g.born < 0.35) continue;   // arms still closing around him
    const a = g.hb.pointToWorldFrame(new CANNON.Vec3(0, -0.2, 0)), b = g.best.pointToWorldFrame(g.loc); m = Math.max(m, a.distanceTo(b)); }
  return m;
}
let qc, qd, qe, rv, rt, tw, dw;
// rotation vector (axis * angle) of a cannon quaternion
function rotVec(q, out){
  let {x, y, z, w} = q; if(w < 0){ x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x*x + y*y + z*z), a = 2*Math.atan2(s, w), k = s > 1e-6 ? a/s : 2;
  return out.set(x*k, y*k, z*k);
}
function physMuscles(p, ph){
  // athletes never go limp: braced while falling or fighting, still holding posture once down
  const tone = ph.rest ? 0.55 : 0.8 + 0.2*ph.bal, wn = 18*Math.sqrt(tone), wL = 40;
  PARTS.forEach((d, i) => {
    if(!d.p) return;
    const pb = ph.bodies[PI_[d.p]], cb = ph.bodies[i];
    // current and wanted orientation of the part relative to its parent
    pb.quaternion.conjugate(qc); qc.mult(cb.quaternion, qd);                       // qd = rel now
    rigQ(p, PARTS[PI_[d.p]].j, tq); rigQ(p, d.j, tq2); tq.invert().multiply(tq2);    // rel wanted (rig)
    qe.set(tq.x, tq.y, tq.z, tq.w); qd.conjugate(qc); qe.mult(qc, qe);             // error = want * now^-1 (parent frame)
    rotVec(qe, rv);
    // joint limits: how far outside the human range (rotation vector vs the rig's rest pose), parent frame
    rotVec(qd, rt); let out = false;
    for(const [ax, k] of [['x', 0], ['y', 1], ['z', 2]]){
      const v = rt[ax], [lo, hi] = d.lim[k];
      rt[ax] = v < lo ? lo - v : v > hi ? hi - v : 0; if(rt[ax]) out = true;
    }
    // everything into the child's own axes, so each axis uses its real inertia (a limb twists far easier
    // about its length than it swings; one averaged inertia made that axis overshoot and spin)
    pb.quaternion.vmult(rv, tw); cb.quaternion.conjugate(qc); qc.vmult(tw, rv);    // error, child frame
    pb.quaternion.vmult(rt, tw); qc.vmult(tw, rt);                                  // limit push, child frame
    cb.angularVelocity.vsub(pb.angularVelocity, dw); qc.vmult(dw, dw);             // relative spin, child frame
    const I = cb.inertia, kd = 2*wn + (out ? 2*wL : 0);
    tw.set(I.x*(wn*wn*rv.x + wL*wL*rt.x - kd*dw.x), I.y*(wn*wn*rv.y + wL*wL*rt.y - kd*dw.y), I.z*(wn*wn*rv.z + wL*wL*rt.z - kd*dw.z));
    cb.quaternion.vmult(tw, tw);                                                    // to world
    cb.torque.vadd(tw, cb.torque); pb.torque.vsub(tw, pb.torque);
  });
}
// legs: hold him up, upright, and push him toward where he wants to go, all scaled by `bal`
function physLegs(p, ph, vdx, vdz, drive, h=1.3, over=1.3){
  const tb = ph.bodies[0], M = ph.M, bal = ph.bal;
  if(bal <= 0) return;
  // vertical: legs carry up to his weight, a bit more if he's sagging, never a launch
  const fy = bal*(M*PH_G*clamp(1 + 3*(h - tb.position.y), 0, over) - M*6*tb.velocity.y);
  // horizontal: leg drive toward the wanted velocity, limited by leg strength
  let fx = M*8*(vdx - tb.velocity.x), fz = M*8*(vdz - tb.velocity.z);
  const fl = Math.hypot(fx, fz), lim = M*drive; if(fl > lim){ fx *= lim/fl; fz *= lim/fl; }
  tb.applyForce(new CANNON.Vec3(fx*bal, fy, fz*bal));
  // upright: rotate the spine back toward vertical, leaning a little into where he's driving (yaw is free)
  const spine = tb.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
  let ux = clamp(vdx*0.04, -0.3, 0.3), uz = clamp(vdz*0.04, -0.3, 0.3); const ul = Math.hypot(ux, 1, uz);
  const ax = spine.y*uz/ul - spine.z*1/ul, ay = spine.z*ux/ul - spine.x*uz/ul, az = spine.x*1/ul - spine.y*ux/ul;   // spine × wanted
  // per-axis in the torso's frame (x3 inertia: the limbs hang off it), yaw only damped
  const wn = 9; tw.set(ax, 0, az); tb.quaternion.conjugate(qc); qc.vmult(tw, rv); qc.vmult(tb.angularVelocity, dw);
  const I = tb.inertia, k = bal*3;
  tw.set(k*I.x*(wn*wn*rv.x - 2*wn*dw.x), k*I.y*(wn*wn*rv.y - 2*wn*dw.y), k*I.z*(wn*wn*rv.z - 2*wn*dw.z));
  tb.quaternion.vmult(tw, tw); tb.torque.vadd(tw, tb.torque);
}
let phAcc = 0;
export function physStep(dt){
  if(!PW) return;
  for(const p of [...PHYS]){
    const ph = p.ph; ph.t += dt;
    // dead ball or lying on the turf: stop fighting, let go, settle
    if(S.phase !== 'live' && ph.grips.length && (ph.deadT = (ph.deadT || 0) + dt) > 0.25) physUngrip(p);
    ph.rest = ph.bal <= 0 && !ph.getUp && (S.phase !== 'live' || physDown(p));
    if(ph.t > ph.ttl){ ph.getUp = true; ph.ttl = Infinity; }
    if(ph.getUp){ ph.bal = Math.min(1, ph.bal + dt*1.2); const tb = ph.bodies[0];
      if(ph.bal >= 1 && tb.quaternion.vmult(new CANNON.Vec3(0, 1, 0)).y > 0.95 && tb.angularVelocity.length() < 2){ physOff(p); continue; } }
  }
  phAcc = Math.min(phAcc + dt, 0.05);
  while(phAcc >= PH_DT){
    phAcc -= PH_DT;
    for(const p of PHYS){
      const ph = p.ph, c = ball.state === 'held' ? ball.holder : null;
      physMuscles(p, ph);
      if(ph.reach){ ph.reach.t += PH_DT; physReach(p); }
      if(p.latch && p.latch.ph && S.phase === 'live'){   // tackler: plant against his motion and drive through him
        const r = p.latch.ph.bodies[0], t = ph.bodies[0], dx = r.position.x - t.position.x, dz = r.position.z - t.position.z, l = Math.hypot(dx, dz) || 1;
        const F = ph.reach || p.grip === 'wrap' ? ph.M*p.acc*(p.rTkl/80)*1.25 : 0;   // arm tackle: just hanging on, dragging his weight
        t.applyForce(new CANNON.Vec3(dx/l*F, 0, dz/l*F));
        if(ph.reach) physLegs(p, ph, r.velocity.x + dx/l*3, r.velocity.z + dz/l*3, p.acc*1.2, 1.0, 1.0);   // still reaching: run through him
        else physLegs(p, ph, 0, 0, PLANT_A*gripK(p), 1.0, 1.0);   // got him: plant, low pad level, can't lift him
      } else if(p === c) physLegs(p, ph, p.vx, -p.vy, p.acc*(p.rBrk/75), 1.3, DEF.some(d => d.latch === p) ? 1.0 : 1.3);   // runner: where his steering wants to go
      else physLegs(p, ph, p.vx, -p.vy, p.acc);
    }
    PW.step(PH_DT);
    // speed rail: no part moves faster than a sprinter or gets launched skyward
    for(const p of PHYS) for(const b of p.ph.bodies){
      const v = b.velocity, sp = Math.hypot(v.x, v.y, v.z); if(sp > 10){ v.x *= 10/sp; v.y *= 10/sp; v.z *= 10/sp; }
      if(v.y > 3) v.y = 3;
      const w = b.angularVelocity, ws = w.length(); if(ws > 14){ w.x *= 14/ws; w.y *= 14/ws; w.z *= 14/ws; }
    }
  }
  for(const p of PHYS){ const t = p.ph.bodies[0]; p.x = t.position.x; p.y = 50 - t.position.z;
    if(!(ball.state === 'held' && ball.holder === p)){ p.vx = t.velocity.x; p.vy = -t.velocity.z; } }
}
// he's down when anything but his feet touches the turf (knee, hand, elbow, hip, back, helmet)
export function physDown(p){
  const ph = p.ph; if(!ph) return false;
  for(let i = 0; i < PARTS.length; i++){
    const b = ph.bodies[i], n = PARTS[i].n, he = b.shapes[0].halfExtents;
    if(n === 'snL' || n === 'snR'){ const top = b.pointToWorldFrame(new CANNON.Vec3(0, he.y, 0)); if(top.y < 0.14) return true; continue; }
    // lowest corner of the box
    const q = b.quaternion, ex = q.vmult(new CANNON.Vec3(he.x, 0, 0)), ey = q.vmult(new CANNON.Vec3(0, he.y, 0)), ez = q.vmult(new CANNON.Vec3(0, 0, he.z));
    if(b.position.y - Math.abs(ex.y) - Math.abs(ey.y) - Math.abs(ez.y) < 0.06) return true;
  }
  return false;
}
export const physBall = p => { const v = p.ph.bodies[PI_.faR].pointToWorldFrame(new CANNON.Vec3(0, -0.08, 0.13)); return tv.set(v.x, v.y, v.z); };
function physMeshes(p){
  if(p.phM){ p.phM.forEach(m => m.visible = true); return p.phM; }
  const t = TEAM[p.team], skin = p.skin;
  const MESH = {torso:[[G.torso,t.jersey],[G.pads,t.jersey]], head:[[G.helmet,t.helmet],[G.stripe,t.stripe],[G.mask,0x222222]],
    uaL:[[G.upperArm,t.jersey]], faL:[[G.forearm,skin]], uaR:[[G.upperArm,t.jersey]], faR:[[G.forearm,skin]],
    thL:[[G.thigh,t.pants]], snL:[[G.shin,t.socks],[G.cleat,0x1a1a1a]], thR:[[G.thigh,t.pants]], snR:[[G.shin,t.socks],[G.cleat,0x1a1a1a]]};
  p.phM = PARTS.map(d => {   // rig geometry hangs from the joint; shift it so the part's center is the body origin
    const g = new THREE.Group();
    MESH[d.n].forEach(([geo, c]) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(-d.c[0], -d.c[1], -d.c[2]); g.add(m); });
    scene.add(g); return g;
  });
  return p.phM;
}
export function physRender(){
  for(const p of PHYS) p.ph.bodies.forEach((b, i) => { const m = p.ph.meshes[i]; m.position.set(b.position.x, b.position.y, b.position.z); m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w); });
}
