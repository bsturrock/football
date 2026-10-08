import { ALL, BODY_H, BODY_W, C, DEF, G, OFF, TEAM, bodyV, mat } from './players.js';
import { scene } from './scene.js';
import { S, ball } from './state.js';
import { PLANT_A, gripK } from './tackling.js';
import { clamp, dist, faceYaw } from './util.js';

// ---------- body physics ----------
// Players who get hit become physical bodies (cannon-es): 10 solid parts with mass, joined at the
// joints. Nothing is scripted: muscles drive each joint toward the pose the animation rig wants
// (bracing, wrapping up, running) with limited strength, joint limits keep knees / elbows / shoulders
// inside human ranges, and parts collide with the ground, with each other and with every other player.
// `bal` is how much he's still on his feet: legs hold him up, keep him upright and drive him where
// he wants to go. A tackle is just the tacklers' grips and leg drive beating that, and then gravity.
const PH_DT = 1/180, PH_G = 10.7, MASS_KG = 0.45, ARM_GRIP = 10;
// physics bubble: players near a live ragdoll become full bodies (ph.bubble) so ragdolls and piles hit them.
// States per player (all in bubbleUpdate / physOn / physOff):
//   animated    p.ph null, no collision body
//   ph.vis      B-036 visual offset of the engaged pose (set in physOn when he was drawn; physRender eases it out over VIS_TAU, clears it after VIS_END; gone with ph on physOff/physClear)
//   bubble      p.ph.bubble: real-mass body, AI intent drives the legs (p.wx/p.wy), yaw held toward faceAt / heading
//   tackle body p.ph, not bubble: ragdoll or tackler (tackling.js / blocking.js call physOn); lives until physOff
//   bubble, becomes ball holder -> tackle body: bubble off, wx/wy cleared, tackleUpdate steers and releases him
//   over BODY_CAP (a tackle made bodies after the join pass): capTrim steps bubble bodies out, upright ones first, then the farthest
//   getting up  tackle body, ph.getUp: bal rises 1.2/s; bal 1 and upright and slow -> physOff; for the ball holder tackleUpdate clears getUp (tackling.js runner states), other bodies keep it until physOff
//   contact     p.hitT = phClock whenever an opposing body touches him or grips him (physTouch); physClear resets it; physDownC = on the turf (or physPropped, B-008: resting on other bodies) and hitT within CONTACT_T
//   leaving     bubble body whose ragdolls are all past BUBBLE_OUT: after BUBBLE_CLEAR s, upright and slow, physOff
const BUBBLE_IN = 2.5*BODY_W, BUBBLE_OUT = 4*BODY_W, BUBBLE_CLEAR = 0.5, BODY_CAP = 14, BUBBLE_RESERVE = 3, BUBBLE_JOINS = 3, KEEP_BIAS = 0.8;   // reserve: slots kept free for the bodies a tackle makes next
// upright and settled: spine y above UPRIGHT_Y, spinning under UPRIGHT_W rad/s, torso above UPRIGHT_H yd (shared with tackling.js)
export const UPRIGHT_Y = 0.95, UPRIGHT_W = 2, UPRIGHT_H = 1.1*BODY_H;
const PLANT_HOLD = 0.4;   // feature (pile-push): tackler's plant and drive x this while a pile pushes with more offensive than defensive pushers (the bigger side wins the surge)
const DRIVE_T = 0.1;   // a drive lapses this long after the last physDrive call
const ELBOW_DOWN_Y = 0.1*BODY_H, CONTACT_T = 1.0;   // down: forearm's elbow end below ELBOW_DOWN_Y yd; a defender must have touched him within CONTACT_T s
// B-008/B-010 (propped + flat settle): a runner whose body lies on other players' bodies and never reaches the turf is down by contact all the same.
// PROP rule: his torso center lower than PROP_Y x BODY_H yd and slower than PROP_V yd/s, with a down-counting part (not a hand, forearm or shin) touching another player's body, for PROP_T s -> physPropped (counts as a part on the turf in physDownC).
// SETTLE: a fallen body (bal 0, on the turf or the dead ball) for SETTLE_T s gets a torque that rolls his spine toward horizontal (SETTLE_K 1/s^2 x inertia, damped) so piles lie flat instead of propped on end.
const PROP_Y = 0.9, PROP_V = 1.5, PROP_T = 0.3, PROP_FRESH = 0.1, SETTLE_T = 0.25, SETTLE_K = 150;
const YAW_K = 150, YAW_MAX = 1.5, HEADING_MIN = 0.4;   // yaw hold: spring gain, max error (rad), slowest speed (yd/s) that sets a heading
export const isBody = p => !!p.ph && !p.ph.bubble;
// name, rig pivot, parent, box size, center in pivot frame, mass share, joint limits [x],[y],[z] (rad,
// rotation vector relative to the rig's rest pose), meshes
const PARTS_RIG = [
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
// B-021: sizes and centers above are rig units; the pair in players.js (BODY_H, BODY_W) makes them the drawn body
const PARTS = PARTS_RIG.map(d => ({...d, size:bodyV(d.size), c:bodyV(d.c)}));
const HAND_Y = -0.2*BODY_H;   // the hand end of a forearm (rig -0.2 down its length)
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
  if(p.ph){
    const ph = p.ph;
    if(ph.bubble){   // a tackle / pancake / dive hits a bubble body: he becomes a tackle body, with the hit's push and timer
      ph.bubble = false; ph.ttl = o.ttl != null ? ph.t + o.ttl : Infinity;
      const dx = o.vx != null ? o.vx - p.vx : 0, dy = o.vy != null ? o.vy - p.vy : 0, up = o.up || 0;
      if(dx || dy || up) for(const b of ph.bodies){ b.velocity.x += dx; b.velocity.z -= dy; b.velocity.y += up; }
    }
    if(o.bal != null) ph.bal = Math.min(ph.bal, o.bal);
    return ph;
  }
  // B-036: the drawn rig (engaged pose: pushed back and squared) differs from the sim pose; keep the difference as a visual offset that physRender eases out
  const vis = p.rx != null ? {ox:p.mesh.position.x - p.x, oz:p.mesh.position.z - (50 - p.y), dyaw:Math.atan2(Math.sin(p.mesh.rotation.y - p.face), Math.cos(p.mesh.rotation.y - p.face)), px:p.x, pz:50 - p.y} : null;
  p.mesh.position.set(p.x, 0, 50 - p.y); p.mesh.rotation.y = p.face;   // the rig is where he is now (the drawn rig trails, and a sim never draws)
  p.mesh.updateMatrixWorld(true);
  const M = p.mass*MASS_KG, vx = o.vx ?? p.vx, vy = o.vy ?? p.vy, up = o.up || 0, sp = o.spin || {x:0, y:0};
  const cap = 9, s = Math.hypot(vx, vy), k = s > cap ? cap/s : 1;
  const w = new CANNON.Vec3(-sp.y, 0, -sp.x);   // lean rate as an angular velocity (top moves along spin)
  const bodies = PARTS.map(d => {
    rigQ(p, d.j, tq); rigP(p, d.j, tv);
    const c = tv2.set(...d.c).applyQuaternion(tq).add(tv);
    const b = new CANNON.Body({mass:M*d.m, material:PW.bodyMat, collisionFilterGroup:GRP.part, collisionFilterMask:GRP.ground|GRP.proxy|GRP.part,
      linearDamping:0.05, angularDamping:0.2});
    const sz = d.n === 'torso' ? bodyV([0.66, 0.8, 0.4]) : d.size;    // torso collides a bit narrower than the pads look
    b.addShape(new CANNON.Box(new CANNON.Vec3(sz[0]/2, sz[1]/2, sz[2]/2)));
    b.position.set(c.x, c.y, c.z); b.quaternion.copy(toC(tq));
    b.velocity.set(vx*k + sp.x*c.y, up, -(vy*k + sp.y*c.y)); b.angularVelocity.copy(w);
    b.pl = p; b.pi = PARTS.indexOf(d); PW.addBody(b); return b;
  });
  const joints = PARTS.map((d, i) => {
    if(!d.p) return null;
    const a = bodies[PI_[d.p]], b = bodies[i];
    rigP(p, d.j, tv);
    const pa = new CANNON.Vec3(), pb = new CANNON.Vec3(), jw = new CANNON.Vec3(tv.x, tv.y, tv.z);
    a.pointToLocalFrame(jw, pa); b.pointToLocalFrame(jw, pb);
    const c = new CANNON.PointToPointConstraint(a, pa, b, pb); c.collideConnected = false; PW.addConstraint(c); c.pvA = [pa.x, pa.y, pa.z]; c.pvB = [pb.x, pb.y, pb.z]; return c;
  });
  p.body.visible = false;
  p.ph = {bodies, joints, grips:[], bal:o.bal ?? 1, ttl:o.ttl ?? Infinity, t:0, M, meshes:physMeshes(p), vis};
  PHYS.push(p);
  return p.ph;
}
export function physOff(p){
  const ph = p.ph; if(!ph) return;
  physUngrip(p); PHYS.filter(q => q.ph).forEach(q => q.ph.grips = q.ph.grips.filter(g => { if(g.on === p){ PW.removeConstraint(g.c); return false; } return true; }));
  ph.joints.forEach(c => c && PW.removeConstraint(c)); ph.bodies.forEach(b => PW.removeBody(b));
  ph.meshes.forEach(m => m.visible = false); p.body.visible = true;
  const f = ph.bodies[0].quaternion.vmult(new CANNON.Vec3(0, 0, 1));   // the animated rig picks up where the body faces
  if(Math.hypot(f.x, f.z) > 0.3) p.face = Math.atan2(f.x, f.z);
  p.rx = p.x; p.ry = p.y; p.wx = p.wy = null;
  p.ph = null; PHYS.splice(PHYS.indexOf(p), 1);
  if(p.act === 'dive' || p.act === 'down' || p.act === 'fall') p.act = null;
}
export function physClear(){ ALL.forEach(p => { p.hitT = undefined; }); while(PHYS.length) physOff(PHYS[0]); }   // contact times don't carry into the next play
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
  const hb = D.bodies[PI_.faL], hw = hb.pointToWorldFrame(new CANNON.Vec3(0, HAND_Y, 0)), hb2 = D.bodies[PI_.faR], hw2 = hb2.pointToWorldFrame(new CANNON.Vec3(0, HAND_Y, 0));
  const tb = D.bodies[0];   // hands on him, or his body into him: either way he gets his arms around him
  if(Math.min(surfDist(C, hw), surfDist(C, hw2)) < 0.3*BODY_W || surfDist(C, tb.position) < 0.45*BODY_W){ D.reach = null; lockGrip(d, R.on, R.kind); }
}
function lockGrip(d, c, kind){
  const D = d.ph, C = c.ph;
  const hands = kind === 'wrap' ? ['faL', 'faR'] : ['faL'];
  for(const h of hands){
    const hb = D.bodies[PI_[h]], hw = hb.pointToWorldFrame(new CANNON.Vec3(0, HAND_Y, 0));
    let best = null, bd = 1e9;
    for(const n of ['torso','thL','thR']){ const b = C.bodies[PI_[n]], k = b.position.distanceTo(hw); if(k < bd){ bd = k; best = b; } }
    const loc = new CANNON.Vec3(); best.pointToLocalFrame(hw, loc);
    const he = best.shapes[0].halfExtents;   // hold the surface, not thin air
    loc.set(clamp(loc.x, -he.x, he.x), clamp(loc.y, -he.y, he.y), clamp(loc.z, -he.z, he.z));
    const g = new CANNON.PointToPointConstraint(hb, new CANNON.Vec3(0, HAND_Y, 0), best, loc);
    // what his hands can hold (force); one hand holds a lot less than a runner's legs pull
    const cap = d.mass*MASS_KG*(kind === 'wrap' ? 150 : ARM_GRIP)*(d.rTkl/80);
    g.collideConnected = false; PW.addConstraint(g); D.grips.push({c:g, on:c, hb, best, loc, born:D.t, cap});
  }
}
export function physUngrip(d){ if(!d.ph) return; d.ph.grips.forEach(g => PW.removeConstraint(g.c)); d.ph.grips = []; d.ph.reach = null; }   // reach too: a let-go tackler must not leave a reach that keeps the runner "held" (seed 7 play 43 never ended)
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
    const a = g.hb.pointToWorldFrame(new CANNON.Vec3(0, HAND_Y, 0)), b = g.best.pointToWorldFrame(g.loc); m = Math.max(m, a.distanceTo(b)); }
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
  const tone = ph.rest ? 0.35 : 0.8 + 0.2*ph.bal, wn = 18*Math.sqrt(tone), wL = 40;
  ph.viol = 0; ph.violP = ph.violP || []; ph.violP.length = 0;   // B-038: the worst joint excess past its limit (rad) at this substep (sim jointViol reads it)
  PARTS.forEach((d, i) => {
    if(!d.p) return;
    const pb = ph.bodies[PI_[d.p]], cb = ph.bodies[i];
    // current and wanted orientation of the part relative to its parent
    pb.quaternion.conjugate(qc); qc.mult(cb.quaternion, qd);                       // qd = rel now
    rigQ(p, PARTS[PI_[d.p]].j, tq); rigQ(p, d.j, tq2); tq.invert().multiply(tq2);    // rel wanted (rig)
    qe.set(tq.x, tq.y, tq.z, tq.w); qd.conjugate(qc); qe.mult(qc, qe);             // error = want * now^-1 (parent frame)
    rotVec(qe, rv);
    // joint limits: how far outside the human range (rotation vector vs the rig's rest pose), parent frame
    rotVec(qd, rt); let out = false, ex = 0;
    for(const [ax, k] of [['x', 0], ['y', 1], ['z', 2]]){
      const v = rt[ax], [lo, hi] = d.lim[k];
      rt[ax] = v < lo ? lo - v : v > hi ? hi - v : 0; if(rt[ax]){ out = true; ex = Math.max(ex, Math.abs(rt[ax])); }
    }
    ph.viol = Math.max(ph.viol, ex); ph.violP[i] = ex;
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
function physLegs(p, ph, vdx, vdz, drive, h=1.3*BODY_H, over=1.3){
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
// body yaw is free (legs only damp it): a bubble body squares up to his man, else faces where he's going
function physYaw(p, ph){
  const tb = ph.bodies[0], fy = faceYaw(p, ball, S), wx = p.wx ?? 0, wy = p.wy ?? 0;
  const want = fy !== null ? fy : Math.hypot(wx, wy) > HEADING_MIN ? Math.atan2(wx, -wy) : null;
  if(want == null) return;
  const f = tb.quaternion.vmult(new CANNON.Vec3(0, 0, 1)), e = want - Math.atan2(f.x, f.z);
  tb.torque.y += tb.inertia.y*YAW_K*clamp(Math.atan2(Math.sin(e), Math.cos(e)), -YAW_MAX, YAW_MAX);
}
// ---------- bubble ----------
const upright = tb => tb.quaternion.vmult(new CANNON.Vec3(0, 1, 0)).y > UPRIGHT_Y && tb.angularVelocity.length() < UPRIGHT_W && tb.position.y > UPRIGHT_H;
function promote(p){
  const ph = physOn(p, {bal:1}); if(!ph) return;
  ph.bubble = true; ph.clearT = 0; p.wx = p.vx; p.wy = p.vy;
  const b = p.bt; if(b) ALL.forEach(q => { if(q.bt === b) q.bt = null; });   // a line battle ends here; the blocker keeps his man (blk)
}
// where bubble slots are ranked from: the runner, else the snap spot
const refPoint = () => ball.state === 'held' ? ball.holder : {x:0, y:S.los};
function bubbleUpdate(dt){
  // the ball holder is a runner, not a bubble body: he goes back to tackle-body rules (tackleUpdate steers and releases him)
  const runner = ball.state === 'held' ? ball.holder : null;
  if(runner && runner.ph && runner.ph.bubble){ runner.ph.bubble = false; runner.wx = runner.wy = null; }
  const bub = PHYS.filter(p => p.ph.bubble);
  if(!bub.length && S.phase !== 'live') return;
  const gripped = new Set(); PHYS.forEach(q => { q.ph.grips.forEach(g => gripped.add(g.on)); if(q.ph.reach) gripped.add(q.ph.reach.on); });
  const rags = PHYS.filter(q => !q.ph.bubble && (q.ph.bal < 1 || q.ph.grips.length || gripped.has(q)));
  const near = (p, r) => rags.some(q => q !== p && dist(p, q) < r);
  const ref = refPoint();
  // leaving: clear of every live ragdoll for BUBBLE_CLEAR s, upright and slow (so he never pops or sinks)
  const stay = [];
  for(const p of bub){
    const ph = p.ph; ph.clearT = near(p, BUBBLE_OUT) ? 0 : ph.clearT + dt;
    if(ph.clearT >= BUBBLE_CLEAR && upright(ph.bodies[0])) physOff(p); else stay.push(p);
  }
  if(S.phase !== 'live' || !rags.length) return;
  // joining: inside BUBBLE_IN of a live ragdoll, or the man he's blocking / blocked by
  const cand = ALL.filter(p => !p.ph && p !== runner && !p.latch && !p.falling && near(p, BUBBLE_IN));
  for(const o of OFF) if(o.blk && !o.ph && !o.blk.ph && o !== runner && dist(o, o.blk) < BUBBLE_IN){
    const a = cand.includes(o), b = cand.includes(o.blk);
    if(a !== b) cand.push(a ? o.blk : o);
  }
  // slots: ragdolls and tackle bodies first; a bubble body that can't stand down yet (not upright) holds one too.
  // The rest, nearest the runner first: a kept body steps out only for a nearer one; skipped joiners take no slot.
  const fixed = stay.filter(p => !upright(p.ph.bodies[0])), movable = stay.filter(p => !fixed.includes(p));
  let used = PHYS.length - movable.length, joins = 0;
  const rank = [...movable.map(p => [p, dist(p, ref)*KEEP_BIAS]), ...cand.map(p => [p, dist(p, ref)])].sort((a, b) => a[1] - b[1]);
  for(const [p] of rank){
    if(p.ph){ if(used < BODY_CAP) used++; else physOff(p); }   // over the cap: the farthest steps out
    else if(used < BODY_CAP - BUBBLE_RESERVE && joins < BUBBLE_JOINS){ used++; joins++; promote(p); }
  }
}
// hard cap: tackles add bodies after the join pass, so shed bubble bodies (farthest from the runner first) until the count fits
function capTrim(){
  if(PHYS.length <= BODY_CAP) return;
  const ref = refPoint(), up = p => upright(p.ph.bodies[0]) ? 0 : 1;   // upright ones step out first (no visible pop), farthest first within each
  const bub = PHYS.filter(p => p.ph.bubble).sort((a, b) => up(a) - up(b) || dist(b, ref) - dist(a, ref));
  while(PHYS.length > BODY_CAP && bub.length) physOff(bub.shift());
}
let phAcc = 0, phClock = 0;
export function physStep(dt){
  if(!PW) return;
  bubbleUpdate(dt); capTrim();
  for(const p of [...PHYS]){
    const ph = p.ph; ph.t += dt;
    // dead ball or lying on the turf: stop fighting, let go, settle
    if(S.phase !== 'live' && ph.grips.length && (ph.deadT = (ph.deadT || 0) + dt) > 0.25) physUngrip(p);
    ph.rest = ph.bal <= 0 && !ph.getUp && (S.phase !== 'live' || physDown(p));
    if(ph.t > ph.ttl){ ph.getUp = true; ph.ttl = Infinity; }
    if(ph.getUp){ ph.bal = Math.min(1, ph.bal + dt*1.2); const tb = ph.bodies[0];
      if(ph.bal >= 1 && tb.quaternion.vmult(new CANNON.Vec3(0, 1, 0)).y > UPRIGHT_Y && tb.angularVelocity.length() < UPRIGHT_W){ physOff(p); continue; } }
  }
  phAcc = Math.min(phAcc + dt, 0.05);
  while(phAcc >= PH_DT){
    phAcc -= PH_DT;
    for(const p of PHYS){
      const ph = p.ph, c = ball.state === 'held' ? ball.holder : null;
      physMuscles(p, ph); if(ph.fallT > SETTLE_T) physSettle(ph);
      for(const g of ph.grips) if(g.on.team !== p.team) g.on.hitT = phClock;   // his hands on the runner count as contact
      if(ph.reach){ ph.reach.t += PH_DT; physReach(p); }
      if(p.latch && p.latch.ph && S.phase === 'live'){   // tackler: plant against his motion and drive through him
        const r = p.latch.ph.bodies[0], t = ph.bodies[0], dx = r.position.x - t.position.x, dz = r.position.z - t.position.z, l = Math.hypot(dx, dz) || 1;
        const sg = S.pile && S.pile.state === 'pushing' && S.pile.pushersO > S.pile.pushersD ? PLANT_HOLD : 1;   // feature (pile-push)
        const F = ph.reach || p.grip === 'wrap' ? ph.M*p.acc*(p.rTkl/80)*1.25*sg : 0;   // arm tackle: just hanging on, dragging his weight
        t.applyForce(new CANNON.Vec3(dx/l*F, 0, dz/l*F));
        if(ph.reach) physLegs(p, ph, r.velocity.x + dx/l*3, r.velocity.z + dz/l*3, p.acc*1.2, BODY_H, 1.0);   // still reaching: run through him
        else physLegs(p, ph, 0, 0, PLANT_A*gripK(p)*sg, BODY_H, 1.0);   // got him: plant, low pad level, can't lift him
      } else if(ph.drv && ph.drv.until > phClock && S.phase === 'live' && p !== c){   // pile push: a wanted velocity and leg force from pile.js
        physLegs(p, ph, ph.drv.vx, -ph.drv.vy, ph.drv.a); if(ph.bubble) physYaw(p, ph);
      } else if(p === c) physLegs(p, ph, p.vx, -p.vy, p.acc*(p.rBrk/75), 1.3*BODY_H, DEF.some(d => d.latch === p) ? 1.0 : 1.3);   // runner: where his steering wants to go
      else if(ph.bubble){ physLegs(p, ph, p.wx ?? p.vx, -(p.wy ?? p.vy), p.acc); physYaw(p, ph); }   // his intent, not what the collisions left of it
      else physLegs(p, ph, p.vx, -p.vy, p.acc);
    }
    PW.step(PH_DT); phClock += PH_DT;
    for(const q of PW.contacts){ const a = q.bi.pl, b = q.bj.pl; if(a && b && a.team !== b.team) a.hitT = b.hitT = phClock;   // opposing bodies touching
      if(a && b && a !== b){ if(PROP_PART[q.bi.pi]) a.ph.propT = phClock; if(PROP_PART[q.bj.pi]) b.ph.propT = phClock; } }   // a down-counting part resting on another player
    // speed rail: no part moves faster than a sprinter or gets launched skyward
    for(const p of PHYS) for(const b of p.ph.bodies){
      const v = b.velocity, sp = Math.hypot(v.x, v.y, v.z); if(sp > 10){ v.x *= 10/sp; v.y *= 10/sp; v.z *= 10/sp; }
      if(v.y > 3) v.y = 3;
      const w = b.angularVelocity, ws = w.length(); if(ws > 14){ w.x *= 14/ws; w.y *= 14/ws; w.z *= 14/ws; }
    }
  }
  for(const p of PHYS){ const ph = p.ph, t = ph.bodies[0]; physMeasure(p, ph, dt); p.x = t.position.x; p.y = 50 - t.position.z;
    if(!(ball.state === 'held' && ball.holder === p)){ p.vx = t.velocity.x; p.vy = -t.velocity.z; } }
}
const PROP_PART = PARTS.map(d => !(d.n === 'snL' || d.n === 'snR' || d.n === 'faL' || d.n === 'faR'));
// once per frame: time off his feet (fallT), propped time (propFor), and what the sim reads: spine.y (tilt), torso top (topY, yd), touched
function physMeasure(p, ph, dt){
  const t = ph.bodies[0], q = t.quaternion, he = t.shapes[0].halfExtents;
  const sy = q.vmult(new CANNON.Vec3(0, 1, 0)).y, ex = q.vmult(new CANNON.Vec3(he.x, 0, 0)), ey = q.vmult(new CANNON.Vec3(0, he.y, 0)), ez = q.vmult(new CANNON.Vec3(0, 0, he.z));
  ph.spineY = sy; ph.topY = t.position.y + Math.abs(ex.y) + Math.abs(ey.y) + Math.abs(ez.y);
  ph.touched = physTouched(p);
  ph.fallT = ph.bal <= 0 && !ph.getUp ? (ph.fallT || 0) + dt : 0;   // time off his feet, on the turf or not (a body propped on others settles too)
  const slow = Math.hypot(t.velocity.x, t.velocity.y, t.velocity.z) < PROP_V;
  ph.propFor = ph.bal <= 0 && !physDown(p) && t.position.y < PROP_Y*BODY_H && slow && phClock - (ph.propT ?? -99) < PROP_FRESH ? (ph.propFor || 0) + dt : 0;
}
// settle: roll the spine toward the horizontal plane (its own heading kept), damped
function physSettle(ph){
  const tb = ph.bodies[0], s = tb.quaternion.vmult(new CANNON.Vec3(0, 1, 0)), h = Math.hypot(s.x, s.z);
  if(h < 0.05) return;   // spine near vertical: no horizontal heading to roll toward (the heading could seed a nudge; left out, it tips over by itself)
  const ax = s.y*s.z/h - 0, az = -s.y*s.x/h;   // spine x (heading, 0): rotation axis, in x and z
  tw.set(ax, 0, az); tb.quaternion.conjugate(qc); qc.vmult(tw, rv); qc.vmult(tb.angularVelocity, dw);
  const I = tb.inertia; tw.set(I.x*(SETTLE_K*rv.x - 2*6*dw.x), I.y*(SETTLE_K*rv.y - 2*6*dw.y), I.z*(SETTLE_K*rv.z - 2*6*dw.z));
  tb.quaternion.vmult(tw, tw); tb.torque.vadd(tw, tb.torque);
}
// geometry: down when any part but a hand or foot touches the turf (head, knee, elbow end of the forearm, upper arm,
// thigh/hip, torso). Hand end of the forearm and the shins' foot end never count.
// how far part i is above its down threshold (yd; under 0 = on the turf): the knee end of a shin (0.14) or the elbow end of a forearm (ELBOW_DOWN_Y), else the box's lowest corner (0.06)
function partClear(ph, i){
  const b = ph.bodies[i], n = PARTS[i].n, he = b.shapes[0].halfExtents;
  if(n === 'snL' || n === 'snR' || n === 'faL' || n === 'faR'){   // one end only; local +y is the knee / elbow end
    const end = b.pointToWorldFrame(new CANNON.Vec3(0, he.y, 0));
    return end.y - (n[0] === 's' ? 0.14*BODY_H : ELBOW_DOWN_Y);
  }
  const q = b.quaternion, ex = q.vmult(new CANNON.Vec3(he.x, 0, 0)), ey = q.vmult(new CANNON.Vec3(0, he.y, 0)), ez = q.vmult(new CANNON.Vec3(0, 0, he.z));
  return b.position.y - Math.abs(ex.y) - Math.abs(ey.y) - Math.abs(ez.y) - 0.06;
}
export function physDown(p){
  const ph = p.ph; if(!ph) return false;
  for(let i = 0; i < PARTS.length; i++) if(partClear(ph, i) < 0) return true;
  return false;
}
// B-038 (sim only, via physPose.kind): which kind of part is lowest on the turf: 'leg' (shin, thigh: knees first), 'arm', 'body' (torso, head), '' (none down)
function physDownKind(p){
  let best = -1, bm = 0;
  for(let i = 0; i < PARTS.length; i++){ const m = partClear(p.ph, i); if(m < bm){ bm = m; best = i; } }
  return best < 0 ? '' : /^(sn|th)/.test(PARTS[best].n) ? 'leg' : /^(fa|ua)/.test(PARTS[best].n) ? 'arm' : 'body';
}
// a defender touched him within CONTACT_T s
export const physTouch = p => { p.hitT = phClock; };   // a hand on him from an animated defender counts as contact
export const physTouched = (p, w = CONTACT_T) => phClock - (p.hitT ?? -99) <= w;   // w: how recent (rules.js asks for a shorter window)
// the runner's down: a part is on the turf and he was touched (an untouched stumble isn't down, he gets up)
// sim.js reads body state only through these (B-008/B-010): pose {fallT s off his feet, spineY torso up-axis y (1 upright, 0 flat), topY torso top yd, touched}, and the torso's horizontal speed yd/s
export const physPose = p => ({fallT:p.ph.fallT || 0, spineY:p.ph.spineY, topY:p.ph.topY, touched:p.ph.touched, bal:p.ph.bal, viol:p.ph.viol || 0, vy:p.ph.bodies[0].velocity.y,
  violOver: th => PARTS.filter((d, i) => (p.ph.violP[i] || 0) > th).map(d => d.n),   // B-038: names of the joints past their limit by over th rad (sim jointViol, last substep)
  get kind(){ return physDownKind(p); }});   // computed only when read (the sim does; normal play never does)
export const physSpeed = p => p.ph ? Math.hypot(p.ph.bodies[0].velocity.x, p.ph.bodies[0].velocity.z) : 0;
export const physPropped = p => !!p.ph && (p.ph.propFor || 0) >= PROP_T;
export const physDownC = p => (physDown(p) || physPropped(p)) && physTouched(p);
// pile.js drives a body through his legs for DRIVE_T s (vx, vy game yd/s; a = leg acceleration): a push is a wanted velocity, never a position
export const physDrive = (p, vx, vy, a) => { if(p.ph) p.ph.drv = {vx, vy, a, until: phClock + DRIVE_T}; };
export const physBall = p => { const v = p.ph.bodies[PI_.faR].pointToWorldFrame(new CANNON.Vec3(...bodyV([0, -0.08, 0.13]))); return tv.set(v.x, v.y, v.z); };
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
// a rig joint's world position from its body (the frames check compares it with the animated rig's joint, B-036); uses the mesh, which carries the visual yaw
export function physJoint(p, j, out){
  const i = PARTS.findIndex(q => q.j === j), m = p.ph.meshes[i], c = tv2.set(...PARTS[i].c).applyQuaternion(m.quaternion);
  return out.set(m.position.x - c.x, m.position.y - c.y, m.position.z - c.z);
}
export const physPart = k => PARTS.findIndex(q => q.j === k);   // B-044: index of a rig joint's part in p.ph.meshes / bodies
// B-044: where joint k's constraint pivot sits in the world, from the parent body (parent = true: the socket the child should hang from) or the child body (the child's own end); the gap between the two is the joint pulled apart. Uses the meshes (they carry the visual yaw).
export function physSocket(p, k, out, parent = true){
  const i = physPart(k), c = p.ph.joints[i]; if(!c) return null;
  const m = p.ph.meshes[parent ? PI_[PARTS[i].p] : i], v = parent ? c.pvA : c.pvB;
  return out.set(...v).applyQuaternion(m.quaternion).add(m.position);
}
const VIS_TAU = 0.12, VIS_END = 0.7, vq = new THREE.Quaternion(), vY = new THREE.Vector3(0, 1, 0), vp = new THREE.Vector3();
export function physRender(){
  for(const p of PHYS){
    const ph = p.ph, v = ph.vis;
    if(v && ph.t > VIS_END){ ph.vis = null; }
    const w = ph.vis ? Math.exp(-ph.t/VIS_TAU) : 0, a = w*(v ? v.dyaw : 0);
    ph.bodies.forEach((b, i) => {
      const m = ph.meshes[i]; m.position.set(b.position.x, b.position.y, b.position.z); m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      if(!w) return;
      // visual only: turn about his promote spot and shift, both easing to zero (the bodies keep p.x and p.face)
      vp.set(m.position.x - v.px, 0, m.position.z - v.pz).applyAxisAngle(vY, a);
      m.position.set(v.px + vp.x + w*v.ox, m.position.y, v.pz + vp.z + w*v.oz);
      m.quaternion.premultiply(vq.setFromAxisAngle(vY, a));
    });
  }
}

// feature (sim-runner): body counters for the sim runner and the ?debug line
export function physCount(){ return {players: PHYS.length, bodies: PW ? PW.bodies.length - 1 : 0}; }
