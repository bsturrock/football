import { setHint } from './hud.js';
import { ballPos, canThrow, charge, throwArc, throwTarget } from './input.js';
import { ARC_N, aimRing, arcGeo, arcLine, ballMesh, ctrlRing, fitGroup, landRing, routeGroup } from './markers.js';
import { physBall, physOn, physRender, physJoint } from './physics.js';
import { PLAYS } from './playbook.js';
import { ALL, BODY_H, C, G, JOINTS, QB, RB, bodyV } from './players.js';
import { toWorld } from './scene.js';
import { S, ball } from './state.js';
import { $, BLOCK_D, BODY_W, FACE_RATE, LOCK_D, clamp, faceLean, faceYaw } from './util.js';

// ---------- animation ----------
// joint signs: negative hip/shoulder = swing forward, positive knee = bend, positive lean/pitch = tip forward
function targetPose(p, sp){
  // Gait: each leg's phase runs stance -> push-off -> swing -> reach. Thigh swings fore/aft around a slightly
  // forward centre; the knee folds while the leg swings through (thigh moving forward, cos > 0, peak as it
  // passes under the hip) and straightens as the thigh reaches forward for the next plant. Arms pump opposite
  // the legs with elbows near 90°, the torso counter-rotates a touch, and there's a small float at mid-stride.
  const r = Math.min(1, sp/6.5), s = Math.sin(p.stride), cs = Math.cos(p.stride);
  const thigh = sn => -(0.95*sn + 0.25)*r, knee = cn => 0.12 + (0.15 + 1.7*Math.max(0, cn))*r;
  const T = {lean:0.1 + 0.3*r + clamp(p.accel*0.035, -0.25, 0.3), twist:0.14*s*r,
    hipL:thigh(s), hipR:thigh(-s), kneeL:knee(cs), kneeR:knee(-cs),
    shL:1.0*s*r, shR:-1.0*s*r, elL:-0.3 - 1.15*r + 0.25*s*r, elR:-0.3 - 1.15*r - 0.25*s*r,
    drop:0.04*r, pitch:0, bob:Math.abs(cs)*0.07*r};
  const arms = (l, rt, el) => { T.shL = l; T.shR = rt; T.elL = T.elR = el; };
  if(S.phase === 'presnap'){
    if(p.role === 'OL' || p.role === 'DL' || p.pos === 'TE') Object.assign(T, {lean:1.2, hipL:-1.3, hipR:-1.1, kneeL:1.7, kneeR:1.5, drop:0.42, shR:-1.25, elR:0, shL:-0.5, elL:-0.6});
    else if(p.pos === 'FB') Object.assign(T, {lean:0.75, hipL:-0.8, hipR:-0.7, kneeL:1.3, kneeR:1.2, drop:0.28}), arms(-0.9, -0.9, -0.6);   // fullback: low, hand near the ground
    else if(p === QB && PLAYS[S.play].under){ Object.assign(T, {lean:0.75, hipL:-0.7, hipR:-0.6, kneeL:1.1, kneeR:1.0, drop:0.3}); arms(-1.0, -1.0, -0.5); }   // under center
    else if(p === QB){ Object.assign(T, {lean:0.2, hipL:-0.3, hipR:-0.3, kneeL:0.5, kneeR:0.5, drop:0.08}); arms(-0.9, -0.9, -0.9); }
    else { Object.assign(T, {lean:0.45, hipL:-0.55, hipR:-0.35, kneeL:0.9, kneeR:0.7, drop:0.15}); arms(-0.3, -0.3, -0.7); }
    return T;
  }
  if(p.act === 'down'){ Object.assign(T, {pitch:p.fallDir*1.45, lean:0, hipL:0.2, hipR:-0.2, kneeL:0.3, kneeR:0.3, bob:0}); arms(-2.6, -2.4, -0.3); return T; }
  if(p.act === 'dive'){ Object.assign(T, {pitch:1.4, lean:0.1, hipL:0.3, hipR:0.1, kneeL:0.3, kneeR:0.5, bob:0}); arms(p.ph ? -1.6 : -2.9, p.ph ? -1.6 : -2.9, p.ph ? -0.6 : -0.1); return T; }
  if(p.act === 'wrap'){ arms(-1.5, -1.5, -1.3); T.lean = 0.7; T.drop = 0.25; T.bob = 0; return T; }   // hanging on to the runner
  if(p.act === 'fall'){ arms(-1.3, -1.1, -0.9);   // brace: hands out in front, elbows soft
    Object.assign(T, {lean:0, bob:0, kneeL:0.4, kneeR:0.2}); return T; }
  if(p.act === 'celebrate'){ arms(-3.0, -3.0, -0.1); T.bob = Math.abs(Math.sin(nowMs()/120))*0.35; return T; }
  const holding = ball.state === 'held' && ball.holder === p;
  if(p === QB && S.charging){ T.twist = -0.7; T.shR = 2.6; T.elR = -1.4; T.shL = -1.3; T.elL = -0.3; }
  else if(p === QB && p.act === 'throw'){ T.twist = 0.5; T.lean = 0.45; T.shR = -1.7; T.elR = -0.2; T.shL = 0.3; }
  else if(holding && p === QB && !S.runMode) arms(-0.9, -0.9, -1.1);
  else if(holding){ T.shR = -0.4 - 0.45*s*r; T.elR = -1.85 + 0.2*s*r; if(p.churn) T.lean = 0.55; }   // ball tucked high and tight, the arm still pumps; drive the legs when someone is hanging on
  else if(ball.state === 'air' && ball.t > 0.5 && Math.hypot(ball.tx - p.x, ball.ty - p.y) < 3.5 && (p === ball.target || p.team === 'D')) arms(-2.7, -2.7, -0.2);
  else if(engaged(p)) engagedPose(T, p, s, cs);
  else if(p.fire > 0 && (p.role === 'OL' || p.role === 'DL' || p.pos === 'TE')){ arms(-1.3, -1.3, -0.5); T.lean = 0.95; T.drop = 0.3; }   // out of the stance: low and violent
  return T;
}
// ---------- engaged block pose (B-028) ----------
// While a battle lives (p.bt on both men; the blocker also while p.eng > 0) both men sit low: knees bent, back flat, head up, arms reaching
// along the pair axis (they face each other, so straight ahead) with the hands on the other man's chest plate. The blocker churns his legs
// while the pair is moving; the defender fights the hands, and swim (move 'speed') and bull (move 'power') keep their own arms; a defender
// whose blocker won the get-off (phase 'recover') is driven back, sitting higher. Visual only: reads battle state, never writes it.
const ENG_K = 24, ENG_HEAD = 0.6, DRIVE_V = 0.8, CHURN_SP = 6;   // pose blend rate (95% in 0.125 s), head-up share of the lean, pair speed (yd/s) that counts as driving, stride speed (yd/s) the legs churn at
// B-031: the pair is solved together. A man's hands go to his partner's chest plate at the drawn distance between them (two-bone arm solve from his shoulder),
// so spacing, lean and reach agree whatever the phase; the heads sit over opposite shoulders so the helmets pass each other; the blocker's hands go inside the
// defender's. All in yards: SH_Y/SH_Z the shoulder on the torso axis, ARM_A/ARM_B upper arm and forearm, PAD_Y/PAD_D where the hands land: a point on the partner's torso, low enough to stay under his chin, and the torso's half depth.
const SH_Y = 0.62*BODY_H, ARM_A = 0.42*BODY_H, ARM_B = 0.4*BODY_H, PAD_Y = 0.4*BODY_H, PAD_D = 0.21*BODY_W, SH_X = 0.5*BODY_W;
// B-037 second doubler (yd, 1/s unless noted). His second-man weight dblK (0..1) scales an extra draw offset: more push (the defender gives him no ground) and a spread away from the first blocker.
//   state              event                                          next                test / report
//   plain 1v1          he becomes second man (secondOf)               easing in           dbl fields, dblFrames
//   easing in          dblK rises to 1: at the pose rate on a fresh double, at DBL_K when he led the battle (hadBt) and it moved to the other doubler
//   steady second      axis turns (cosine < TURN_COS), partner or spread side changes
//                                                                     carry: the old offset is carried and worked off at CARRY_K, so he glides   dblJumpMax, dblOffsetJumpMax
//   steady second      his double ends: he climbs (no partner) or the battle comes to him (isSecond false)       easing out
//   easing out         dblK falls to 0 at DBL_K                       plain 1v1 (or the new battle man, whose base offset is B-031's)
//   any                presnap, or he becomes a physics body          everything reset to 0
const DBL_SPREAD = 0.4;   // sideways draw offset away from the first blocker
const DBL_PUSH_K = 1;     // his extra share of the engage push (the defender does not give ground to him, so the full gap is his)
const DBL_K = 2;          // rate his weight dblK fades out when the double ends, and eases in when he led the battle and it moved to the other doubler; also his yaw fade when his partner goes
const DBL_YAW = 0.3;      // yawK above which he is square to his man (the fades below it are the 1v1 ramp, not measured)
const DBLK_MIN = 0.05;    // second-man weight below which a man is a plain 1v1 (no carry, not measured)
const SQUARE_YAW = 0.9;    // yawK above which a man counts as square for the B-040 jump metric
const CARRY_K = 2;        // rate a drawn jump from a changed partner, a turned axis or a flipped spread side is worked off
const CARRY_K1 = 6;       // B-040: the same for a plain 1v1 man (his carry must not lag the bodies)
const TURN_COS = 0.97;    // axis turn (cosine) that counts as such a jump
const SEC_ENGW = 0.5;     // engaged share he keeps the second-man role at through a frame where the sim's p.eng lapses
const SIDE_R = SH_X - 0.02;   // his hand point's distance from the defender's axis
const HAND_IN = 0.12, HAND_OUT = 0.36, ENG_ROLL = 0.6, HEAD_TILT = 0.15, HEAD_TURN = 0.2, HAND_PRESS = -0.13;   // hand sideways offsets from the pair axis (blocker inside, defender outside), head tilt and turn (rad, about his own neck), how far the hand presses into the chest (yd)
// arm solver limits: closest and farthest reach kept off the straight and folded extremes (yd), elbow range (rad), sideways angle range (rad), asin clamp for the first guess, Newton steps and stop error (yd), finite difference step, singular limit; free-arm sideways angle (rad)
const REACH_MIN = 0.03, REACH_MAX = 0.02, EL_MIN = -2.7, EL_MAX = -0.05, ARM_Z_MAX = 1.2, ARM_Z_GUESS = 0.9, NEWTON_N = 5, NEWTON_ERR = 0.002, FD_H = 1e-3, DET_MIN = 1e-6, ARM_Z_FREE = 0.12;
let frameClock = null;   // ms; the ?frames check sets it so the fight wiggle is the same every run (a normal page keeps real time)
export const setFrameClock = t => { frameClock = t; };
const nowMs = () => frameClock ?? performance.now();
const engaged = p => !!p.bt || p.eng > 0;
// B-037: a double team's second man (p.eng only, p.dbl.state 'double') is partnered with the defender too, for yaw, push and hands; the defender stays paired with his battle blocker bt.o
const secondOf = p => p.team === 'O' && !p.bt && (p.eng > 0 || p.engW > SEC_ENGW) && p.dbl && p.dbl.state === 'double' && p.dbl.d && p.dbl.d.bt && p.dbl.d.bt.o && p.dbl.d.bt.o !== p ? p.dbl.d : null;
const partnerOf = p => p.team === 'D' ? (p.bt && p.bt.o) : ALL.find(d => d.team === 'D' && d.bt && d.bt.o === p) || secondOf(p);
const isSecond = (p, q) => !!q && p.team === 'O' && q.bt && q.bt.o !== p;
const driving = p => p.team === 'O' ? (!!p.bt && p.bt.phase === 'recover') || Math.hypot(p.vx, p.vy) > DRIVE_V : !!p.bt && (p.bt.phase === 'move' || p.bt.phase === 'recover') && Math.hypot(p.vx, p.vy) > DRIVE_V;   // offense: by speed (also a double team's second man, p.eng only); defense: his battle's move or recover phase while moving
// shoulder swing (about x, total with the torso's lean), sideways angle (about z) and elbow angle that put the hand at (lat, up, fwd) from the shoulder. The rig
// turns the shoulder as Rx(swing)*Rz(side) and the forearm bends about the tilted x axis, so the hand is found by a few Newton steps on that forward chain
// (started from the in-plane two-bone answer), not by a closed form; an unreachable point gives the arm's nearest pose.
const afk = [0, 0, 0], afk2 = [0, 0, 0], aX = [0, 0, 0], aY = [0, 0, 0], aE = [0, 0, 0], aD = [0, 0, 0], aJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], aRes = {sh:0, el:0, z:0};   // scratch: no per-frame allocation
function armFK(th, z, el, o){
  const sz = Math.sin(z), cz = Math.cos(z), sx = Math.sin(th), cx = Math.cos(th);
  const fy = -ARM_B*Math.cos(el), fz = -ARM_B*Math.sin(el);                    // forearm in the shoulder's frame (elbow bends about its x)
  const ux = ARM_A*sz, uy = -ARM_A*cz, fx = -fy*sz, fyz = fy*cz;               // Rz(z) of the upper arm (0, -A) and the forearm (0, fy): (x, y) parts, z unchanged
  o[0] = ux + fx; o[1] = (uy + fyz)*cx - fz*sx; o[2] = (uy + fyz)*sx + fz*cx;   // then Rx(th): (x, y, z) -> (x, y cos - z sin, y sin + z cos)
}
const det3 = (m, c, e) => {   // determinant of m with column c replaced by e
  const a = (i, j) => j === c ? e[i] : m[i][j];
  return a(0, 0)*(a(1, 1)*a(2, 2) - a(1, 2)*a(2, 1)) - a(0, 1)*(a(1, 0)*a(2, 2) - a(1, 2)*a(2, 0)) + a(0, 2)*(a(1, 0)*a(2, 1) - a(1, 1)*a(2, 0));
};
function armTo(lean, lat, up, fwd){
  const r0 = Math.hypot(lat, up, fwd), r = clamp(r0, Math.abs(ARM_A - ARM_B) + REACH_MIN, ARM_A + ARM_B - REACH_MAX);
  const alpha = Math.acos(clamp((ARM_A*ARM_A + r*r - ARM_B*ARM_B)/(2*ARM_A*r), -1, 1)), elbow = Math.acos(clamp((ARM_A*ARM_A + ARM_B*ARM_B - r*r)/(2*ARM_A*ARM_B), -1, 1));
  const k = Math.min(1, r/r0), tx = lat*k, ty = up*k, tz = fwd*k;
  aX[0] = Math.atan2(-fwd, -up) + alpha; aX[1] = Math.asin(clamp(lat/r, -ARM_Z_GUESS, ARM_Z_GUESS)); aX[2] = -(Math.PI - elbow);
  for(let it = 0; it < NEWTON_N; it++){
    armFK(aX[0], aX[1], aX[2], afk);
    aE[0] = afk[0] - tx; aE[1] = afk[1] - ty; aE[2] = afk[2] - tz; if(Math.hypot(aE[0], aE[1], aE[2]) < NEWTON_ERR) break;
    for(let j = 0; j < 3; j++){ aY[0] = aX[0]; aY[1] = aX[1]; aY[2] = aX[2]; aY[j] += FD_H; armFK(aY[0], aY[1], aY[2], afk2); for(let i = 0; i < 3; i++) aJ[i][j] = (afk2[i] - afk[i])/FD_H; }
    const det = det3(aJ, -1, aE); if(Math.abs(det) < DET_MIN) break;
    for(let c = 0; c < 3; c++) aD[c] = det3(aJ, c, aE)/det;                  // J dx = e by Cramer's rule
    aX[0] -= aD[0]; aX[1] = clamp(aX[1] - aD[1], -ARM_Z_MAX, ARM_Z_MAX); aX[2] = clamp(aX[2] - aD[2], EL_MIN, EL_MAX);
  }
  aRes.sh = aX[0] - lean; aRes.el = aX[2]; aRes.z = aX[1]; return aRes;
}
const eV = new THREE.Vector3();
// the hand target of one arm (side +1 left, -1 right): a point on the partner's chest plate, in this man's rig frame. The partner's plate is a point of his own rig
// (his sideways u, up the torso PAD_Y, front PAD_D), carried to the world by his mesh and back by this man's.
function handAt(p, q, side, hand){
  const ql = q.pose.lean, qt = q.pose.twist, qr = q.roll || 0, u0 = -side*hand, u = u0*Math.cos(qr) - PAD_Y*Math.sin(qr), yy = u0*Math.sin(qr) + PAD_Y*Math.cos(qr);   // his roll tilts the plate sideways (B-042)
  const f = yy*Math.sin(ql) + PAD_D*Math.cos(ql) - HAND_PRESS;
  eV.set(u*Math.cos(qt) + f*Math.sin(qt), q.body.position.y + BODY_H + yy*Math.cos(ql) - PAD_D*Math.sin(ql), -u*Math.sin(qt) + f*Math.cos(qt));
  return p.mesh.worldToLocal(q.mesh.localToWorld(eV));
}
// the second doubler's hand target: the defender's near side (the side facing p), a SIDE_R out from his axis, the two hands HAND_IN either side of that point along his side
const sV = new THREE.Vector3();
function handAtSide(p, q, side, hand){
  const l = q.mesh.worldToLocal(sV.copy(p.mesh.position)), n = Math.hypot(l.x, l.z) || 1, nx = l.x/n, nz = l.z/n;
  eV.set(nx*SIDE_R - nz*side*hand, q.body.position.y + BODY_H + PAD_Y, nz*SIDE_R + nx*side*hand);
  return p.mesh.worldToLocal(q.mesh.localToWorld(eV));
}
function engagedPose(T, p, s, cs){
  const ph = p.x*1.7 + p.y*2.3, w = nowMs()/1000, fight = Math.sin(w*9 + ph), fight2 = Math.sin(w*7.3 + ph*1.9);
  const ph2 = p.bt && p.team === 'D' ? p.bt.phase : null, mv = p.bt && p.bt.move;
  const churn = driving(p) ? 1 : 0, ch = 0.3*churn;
  const low = {lean:0.8, drop:0.34, hipL:-1.05 + ch*s, hipR:-0.95 - ch*s, kneeL:1.55 + 0.3*churn*Math.max(0, cs), kneeR:1.45 + 0.3*churn*Math.max(0, -cs), twist:0, bob:0};
  Object.assign(T, low);
  const q = partnerOf(p), sec = isSecond(p, q);
  // hands on the partner's chest plate at the drawn distance; l and r wiggle the swing (fighting the hands)
  const reach = (lean, l = 0, r = 0) => {
    const tw = p.pose.twist, ct = Math.cos(tw), st = Math.sin(tw), hand = p.team === 'O' ? HAND_IN : HAND_OUT;
    for(let side = 1; side >= -1; side -= 2){
      const t = q ? (sec ? handAtSide(p, q, side, hand) : handAt(p, q, side, hand)) : eV.set(-side*hand, BODY_H, BLOCK_D - PAD_D);
      const cr = Math.cos(p.roll || 0), sr = Math.sin(p.roll || 0), ax = side*SH_X*cr - SH_Y*sr, ay = side*SH_X*sr + SH_Y*cr;   // roll, then twist, then lean (the torso's Euler order)
      const sx = ax*ct, sz = -ax*st*Math.cos(lean) + ay*Math.sin(lean), sy = BODY_H + p.body.position.y + ay*Math.cos(lean) + ax*st*Math.sin(lean);   // shoulder in the rig frame
      const x = t.x - sx, z = t.z - sz, y = t.y - sy;
      const lat = x*ct - z*st, a = armTo(lean, lat*cr + y*sr, y*cr - lat*sr, x*st + z*ct);   // the shoulder frame is rolled with the torso
      if(side > 0){ T.shL = a.sh + l; T.elL = a.el; T.armZL = a.z; } else { T.shR = a.sh + r; T.elR = a.el; T.armZR = a.z; }
    }
  };
  if(p.team === 'O'){
    if(p.bt && p.bt.phase === 'recover'){ T.lean = 0.9; T.drop = 0.38; }   // driving him: lower, pushing
    reach(T.lean, 0.07*fight, -0.07*fight);                               // punched in, hands inside the pads
  } else if(ph2 === 'move' && mv === 'speed'){                               // swim: near arm clubs the blocker, far arm goes over the top
    T.lean = 0.7; T.twist = 0.25; T.drop = 0.3;
    reach(T.lean, 0.1*fight); T.shR = -3.0 + 0.15*fight2; T.elR = -0.2;
  } else if(ph2 === 'move'){                                                 // bull rush: head down, both hands driving, legs churning
    T.lean = 0.95; T.drop = 0.37; reach(T.lean, 0.03*fight, -0.03*fight);
  } else if(ph2 === 'recover'){                                              // driven back: sitting higher, hands still on the blocker, legs scuffling
    T.lean = 0.55; T.drop = 0.22; T.hipL = -0.85 + 0.25*s; T.hipR = -0.75 - 0.25*s; T.kneeL = 1.1 + 0.3*Math.max(0, cs); T.kneeR = 1.0 + 0.3*Math.max(0, -cs);
    reach(T.lean, 0.1*fight, -0.1*fight2);
  } else reach(T.lean, 0.1*fight, -0.1*fight2);                           // set / fighting the hands: hands working on his chest plate
}
function animate(p, dt){
  // a runner held up keeps churning his legs at full stride whatever his speed
  const sp0 = p.churn && p.ph && !p.falling && !(p.latch && p.latch.falling) ? Math.max(5.5, Math.hypot(p.vx, p.vy)*1.3) : Math.hypot(p.vx, p.vy);
  const eng = !p.ph && p.act !== 'down' && p.act !== 'fall' && p.act !== 'dive' && engaged(p), sp = eng && driving(p) ? Math.max(sp0, CHURN_SP) : sp0;   // a driven pair's legs churn however slowly it moves
  p.stride += sp > 0.3 ? 2*Math.PI*(1.1 + 0.16*sp)*dt : 0;   // cadence rises with speed (~2.2 strides/s flat out)
  if(p.actT > 0){ p.actT -= dt; if(p.actT <= 0) p.act = null; }
  if(p.eng > 0) p.eng -= dt; else if(p.team === 'O') p.bt = null;
  if(p.beatT > 0) p.beatT -= dt;
  const fy = faceYaw(p, ball, S);   // blockers square up to their man (a blocked defender to his blocker, with the lean) instead of facing where they move
  if(!p.ph && p.act !== 'down' && p.act !== 'dive' && p.act !== 'fall' && (fy !== null || sp > 0.4)){
    const d = (fy !== null ? fy : Math.atan2(p.vx, -p.vy)) - p.face, e = Math.atan2(Math.sin(d), Math.cos(d));
    p.face += e*Math.min(1, dt*FACE_RATE);
  }
  const T = targetPose(p, sp), P = p.pose, k = 1 - Math.exp(-dt*(eng ? ENG_K : 16)), J = p.j;
  for(const j of JOINTS) P[j] += (T[j] - P[j])*k;
  p.engW = (p.engW || 0) + ((eng ? 1 : 0) - (p.engW || 0))*(1 - Math.exp(-dt*ENG_K));
  J.head.rotation.set(-ENG_HEAD*P.lean*p.engW, HEAD_TURN*p.engW, HEAD_TILT*p.engW);   // head up while engaged: eyes on his man, not the turf; B-042: the head stays on its neck socket and tilts to his right shoulder (B-031 slid it sideways off the neck), so the pair's helmets pass
  p.roll = ENG_ROLL*p.engW; J.torso.rotation.set(P.lean, P.twist, p.roll);   // B-042: engaged, he rolls to his right about the hips: the head (on its neck) and shoulders clear his partner's
  J.hipL.rotation.x = P.hipL; J.hipR.rotation.x = P.hipR; J.kneeL.rotation.x = P.kneeL; J.kneeR.rotation.x = P.kneeR;
  p.armZL = (p.armZL ?? ARM_Z_FREE) + ((T.armZL ?? ARM_Z_FREE) - (p.armZL ?? ARM_Z_FREE))*k; p.armZR = (p.armZR ?? -ARM_Z_FREE) + ((T.armZR ?? -ARM_Z_FREE) - (p.armZR ?? -ARM_Z_FREE))*k;   // sideways arm angles: 0.12 out free, the hand-placement angles engaged
  J.shL.rotation.set(P.shL, 0, p.armZL); J.shR.rotation.set(P.shR, 0, p.armZR); J.elL.rotation.x = P.elL; J.elR.rotation.x = P.elR;
  p.body.position.y = (P.bob - P.drop + Math.abs(P.pitch)*0.15)*BODY_H;   // B-021: poses are in rig yards
  p.body.rotation.x = P.pitch;
  // drawn position eases to the simulated one: contact shoves and block pushes read as motion, not a twitch
  const k2 = 1 - Math.exp(-dt*22);
  p.rx = p.rx == null ? p.x : p.rx + (p.x - p.rx)*k2; p.ry = p.ry == null ? p.y : p.ry + (p.y - p.ry)*k2;
  // B-031: an engaged man is drawn square to his partner (the sim's p.face keeps the leverage angle): the leaned torso then lies along the pair axis, not off it
  if(S.phase === 'presnap' || p.ph){ p.yawK = 0; p.pushX = p.pushY = 0; p.sprX = p.sprY = 0; p.dblK = 0; p.hadBt = false; p.carX = p.carY = 0; p.axQ = null; p.sgPrev = 0; p.sgFlip = false; p.dblJ = p.baseJ = 0; p.sq = null; }   // a new rep or a physics body: no stale yaw or push
  const q = p.engW > 0.01 && !p.ph && partnerOf(p);
  const dk = 1 - Math.exp(-dt*DBL_K), kd = !q && p.dblK > 0.01 ? dk : k;   // B-037: a second man whose double ends fades his square yaw, push and spread slowly (no pop); everything else at the pose rate
  const yk0 = p.yawK || 0;
  p.yawK = yk0 + (((q ? 1 : 0)) - yk0)*kd;
  if(q) p.sq = Math.atan2(q.rx - p.rx, p.ry - q.ry) + (p.team === 'D' ? faceLean(p, q, ball, S) : 0);   // square to the partner; a defender keeps B-022's leverage lean
  // and drawn pushed back along the pair axis so the pair is BLOCK_D apart on screen while the sim keeps LOCK_D; the push blends with the yaw (about 0.1 s at engage and shed)
  const sec2 = !!q && isSecond(p, q), px0 = p.pushX || 0, py0 = p.pushY || 0, sx0 = p.sprX || 0, sy0 = p.sprY || 0, w0 = p.dblK || 0, half = (BLOCK_D - LOCK_D)/2;
  if(q){ const ax = p.x - q.x, ay = p.y - q.y, al = Math.hypot(ax, ay) || 1; if((px0 || py0) && (px0*ax + py0*ay)/al < TURN_COS ) p.sgFlip = true; p.pushX = ax/al; p.pushY = ay/al; }   // a turned axis is a jump for every engaged man (B-040: the 1v1 carry too)
  // B-037: the second doubler is also drawn DBL_SPREAD sideways, away from the first blocker, so the two sets of shoulders clear each other (the defender's drawn spot is his own push from his battle blocker only)
  if(p.bt) p.hadBt = true; else if(!sec2 && !(p.dblK > 0.01)) p.hadBt = false;   // he led the battle: if it moves to the other doubler, his weight eases in
  p.dblK = (p.dblK || 0) + ((sec2 ? 1 : 0) - (p.dblK || 0))*(sec2 && !p.hadBt ? k : dk);   // eased with the yaw, so the extra push and the spread fade when the double ends (he climbs, or inherits the battle)
  if(sec2){ const o = q.bt.o, tx = -(p.pushY || 0), ty = p.pushX || 0, sg = p.dbl.ringS || Math.sign(tx*(p.x - o.x) + ty*(p.y - o.y)) || 1; if(p.sgPrev && sg !== p.sgPrev) p.sgFlip = true; p.sgPrev = sg; p.sprX = tx*sg; p.sprY = ty*sg; }
  const yk = p.yawK || 0, w1 = p.dblK || 0, ex = (px, sx) => px*half*DBL_PUSH_K + sx*DBL_SPREAD;
  p.dblJ = yk*Math.hypot(w1*ex(p.pushX || 0, p.sprX || 0) - w0*ex(px0, sx0), w1*ex(p.pushY || 0, p.sprY || 0) - w0*ex(py0, sy0));   // B-037 metric: the second man's extra offset (weight and axis) changed this frame
  p.baseJ = yk*half*Math.hypot((p.pushX || 0) - px0, (p.pushY || 0) - py0);   // the plain-1v1 control: the raw axis turned this frame, as drawn
  let off = (p.yawK || 0)*(BLOCK_D - LOCK_D)/2*(1 + DBL_PUSH_K*(p.dblK || 0)), spr = (p.yawK || 0)*(p.dblK || 0)*DBL_SPREAD, ox = (p.pushX || 0)*off + (p.sprX || 0)*spr, oy = (p.pushY || 0)*off + (p.sprY || 0)*spr;
  const pox = p.lastOx || 0, poy = p.lastOy || 0;
  if(p.axQ && q && (q !== p.axQ || p.sgFlip) && (p.yawK || 0) > DBL_YAW){ p.carX = pox - ox; p.carY = poy - oy; }   // B-037, B-040: a new partner or a turned axis (a shed or lock snap) turns the draw axis at once; the old offset is carried and fades, so he glides
  p.sgFlip = false;   // consumed, or not square / no partner: a flip never waits for a later frame
  if(q) p.axQ = q; const cd = Math.exp(-dt*(w1 > DBLK_MIN ? CARRY_K : CARRY_K1)); p.carX = (p.carX || 0)*cd; p.carY = (p.carY || 0)*cd;
  ox += p.carX; oy += p.carY; p.lastOx = ox; p.lastOy = oy;
  p.drawJ = yk0 > SQUARE_YAW && p.yawK > SQUARE_YAW ? Math.hypot(ox - pox, oy - poy) : 0;   // B-040 metric: the drawn offset changed this frame, carry included, while square both frames (the engage and shed yaw ramp is not measured; the sim spot's own move is rx, ry)
  p.mesh.position.set(p.rx + ox, 0, 50 - (p.ry + oy)); p.mesh.rotation.y = p.yawK > 0.001 && p.sq != null ? p.face + p.yawK*Math.atan2(Math.sin(p.sq - p.face), Math.cos(p.sq - p.face)) : p.face;
  p.mesh.updateMatrixWorld(true);
}
// ---------- pair check (B-031) ----------
// The ?frames=N check (main.js) calls pairCheck after every frame and pairReport at the end. On each frame where a defender is in a battle, the corners of every box of one
// man's rig (helmet, pads, torso, arms) are tested against the boxes of his partner's (shrunk PD_SHRINK yd; an arm's corners PD_HAND, since hands rest on the plate), in both directions. Reads the rig only. Fields of pairReport:
//   frames: engaged pair-frames; medDsim, medDrender: median hip-to-hip distance, simulated and drawn (yd)
//   headInBodyPct / padsInBodyPct / armInBodyPct: share of frames with a helmet corner in the partner's pads, torso or helmet / a pad or torso corner in the partner's pads, torso or helmet / an arm corner in his pads, torso or helmet
//   handoffs: engaged-to-body hand-offs (an engaged man, yawK > HO_ENG, becomes a physics body). handoffTorso, handoffShoulder, handoffMax: the largest drawn jump on that frame (yd, xz, beyond the torso body's own motion) of his torso joint,
//   of a shoulder joint (0.5 out to the side, so a facing snap shows), and the larger of the two (B-036: under 0.08)
//   (the drills never promote a man: add &handoff=N to force one engaged man into a physics body every N frames)
//   dblFrames, dblAnyPct, dblPadsPct, dblHeadPct (B-037): frames where the defender in a battle also has a second doubler; the share of them with any overlap / pads or torso in pads, torso or helmet / a helmet in a body, between the second man and the defender or the first blocker
//   dblJumpMax (B-037): the largest drawn jump of a second man in one frame on a frame where his weight moves while he is already square (yawK over DBL_YAW; gate dblK moved and, for a rise, he led the battle; a new battle's engage ramp is the 1v1 one), beyond the motion of his simulated spot (yd; under 0.08), watching the push and spread fade when a double ends
//   dblOffsetJumpMax: the largest one-frame change of a second man's extra offset (weight and raw axis, no carry; yd) on frames where he is square. dbl1v1JumpMax: the control, the same for every other square man's raw axis (the 1v1 pose's own turn)
//   dblFades (B-037): how many such frames were counted, by kind: climb (his double ended, no partner), inherit (the battle came to him), swap (he became second man while square)
//   dblJumpKind: the same largest jump by kind
//   headOffNeckMax (B-042, yd): the largest distance of any drawn man's head joint from its neck socket; limbStretchMax: the largest distance of any other joint from its rest socket on its parent, or scale away from 1 (both near 0)
//   headHeadPct: helmet corner in the partner's helmet; armArmPct: an arm corner in the partner's arm; anyPct: any of the above
// B-042: every frame, every drawn man: how far a joint sits from its rest socket on its parent (headOffNeckMax: the head; limbStretchMax: any other joint, and any scale away from 1). Rig rest in rig units, as players.js builds it.
const REST = {torso:[0, 1, 0], head:[0, 0.8, 0], shL:[0.5, 0.62, 0], shR:[-0.5, 0.62, 0], elL:[0, -0.42, 0], elR:[0, -0.42, 0], hipL:[0.2, 1, 0], hipR:[-0.2, 1, 0], kneeL:[0, -0.5, 0], kneeR:[0, -0.5, 0]};
const restV = Object.fromEntries(Object.entries(REST).map(([k, v]) => [k, bodyV(v)]));
const pd0 = {headOff:0, stretch:0};
function jointCheck(p){
  for(const k in restV){ const j = p.j[k], v = restV[k], d = Math.hypot(j.position.x - v[0], j.position.y - v[1], j.position.z - v[2]), sc = Math.max(Math.abs(j.scale.x - 1), Math.abs(j.scale.y - 1), Math.abs(j.scale.z - 1));
    if(k === 'head') pd0.headOff = Math.max(pd0.headOff, d); else pd0.stretch = Math.max(pd0.stretch, d); pd0.stretch = Math.max(pd0.stretch, sc); }
  const m = p.mesh.scale, b = p.body.scale; pd0.stretch = Math.max(pd0.stretch, Math.abs(m.x - 1), Math.abs(m.y - 1), Math.abs(m.z - 1), Math.abs(b.x - 1), Math.abs(b.y - 1), Math.abs(b.z - 1));
}
const PD_SHRINK = 0.03, PD_HAND = 0.06;
const HO_ENG = 0.3, HO_FULL = 0.95, HO_DT = 1/60, HO_JOINTS = ['torso', 'shL', 'shR'], hoPrev = new Map(), hoV = new THREE.Vector3(), hoV2 = new THREE.Vector3();
const pd = {offJump:0, ctrlJump:0, dblJk:{climb:0, inherit:0, swap:0}, dblN:{climb:0, inherit:0, swap:0}, dblJump:0, dbl:0, dblAny:0, dblPad:0, dblHead:0, handoffs:0, hoTorso:0, hoShoulder:0, frames:0, dSim:[], dRen:[], headBody:0, padBody:0, armBody:0, headHead:0, armArm:0, any:0};
const dblPrev = new Map();
const pdParts = ['helmet', 'pads', 'torso', 'upperArm', 'forearm'].map(k => [k, G[k]]);
const pdBox = new THREE.Box3(), pdV = new THREE.Vector3(), pdInv = new THREE.Matrix4();
function pdMeshes(p){ const o = []; p.mesh.traverse(m => { const k = m.isMesh && pdParts.find(q => q[1] === m.geometry); if(k){ if(!m.geometry.boundingBox) m.geometry.computeBoundingBox(); o.push([k[0], m]); } }); return o; }
const pdArm = k => k === 'upperArm' || k === 'forearm';
function pdInside(a, b){   // corners of a's parts inside b's parts
  const r = {head:0, pad:0, arm:0, hh:0, aa:0}, bm = pdMeshes(b).map(([k, m]) => [k, pdInv.copy(m.matrixWorld).invert().clone(), pdBox.copy(m.geometry.boundingBox).expandByScalar(-PD_SHRINK).clone(), pdBox.copy(m.geometry.boundingBox).expandByScalar(-PD_HAND).clone()]);
  for(const [ka, ma] of pdMeshes(a)){
    const bb = ma.geometry.boundingBox;
    for(let i = 0; i < 8; i++){
      pdV.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(ma.matrixWorld);
      for(const [kb, inv, box3, box6] of bm){
        const box = pdArm(ka) ? box6 : box3;
        if(!box.containsPoint(pdV.clone().applyMatrix4(inv))) continue;
        if(ka === 'helmet' && kb === 'helmet') r.hh++;
        else if(ka === 'helmet') r.head++;
        else if(ka === 'pads' || ka === 'torso') r.pad++;
        else if(pdArm(ka) && pdArm(kb)) r.aa++;
        else if(pdArm(ka)) r.arm++;
      }
    }
  }
  return r;
}
const HO_EVERY = Number(new URLSearchParams(location.search).get('handoff')) || 0;   // ?handoff=N: every N frames the first fully engaged man becomes a physics body (the drills never promote one)
let hoFrame = 0;
export function pairCheck(){
  if(HO_EVERY && ++hoFrame % HO_EVERY === 0){ const m = ALL.find(q => !q.ph && q.yawK > HO_FULL && q.mesh.visible); if(m){ physOn(m, {bal:0.5, ttl:1.5}); const b = m.bt; if(b) ALL.forEach(q => { if(q.bt === b) q.bt = null; }); } }   // his battle ends too, as physics.js promote() does
  physRender();   // the frames check does not run main's physRender; the meshes must be synced before they are read
  for(const p of ALL) if(!p.ph && S.phase !== 'presnap') jointCheck(p);
  for(const p of ALL){   // B-036: an engaged man who became a body this frame: his torso joint's drawn jump, less what the body itself moved
    const pr = hoPrev.get(p);
    if(p.ph && pr && pr.eng){
      const v = p.ph.bodies[0].velocity; pd.handoffs++;
      HO_JOINTS.forEach((j, i) => { const t = physJoint(p, j, hoV), d = Math.hypot(t.x - pr.xz[i][0] - v.x*HO_DT, t.z - pr.xz[i][1] - v.z*HO_DT); if(i) pd.hoShoulder = Math.max(pd.hoShoulder, d); else pd.hoTorso = Math.max(pd.hoTorso, d); });
    }
    if(p.ph) hoPrev.delete(p);
    else hoPrev.set(p, {xz:HO_JOINTS.map(j => { p.j[j].getWorldPosition(hoV2); return [hoV2.x, hoV2.z]; }), eng:p.yawK > HO_ENG});
  }
  for(const p of ALL){   // B-037: a second man's drawn jump per frame while his double fades out, beyond his own smoothed motion (the push and spread must fade when a double ends)
    const pr = dblPrev.get(p);
    if(pr && !p.ph && S.phase !== 'presnap' && Math.max(p.dblK, pr[4]) > DBLK_MIN && pr[5] > DBL_YAW && p.yawK > DBL_YAW && p.dblK !== pr[4] && (p.dblK < pr[4] || p.hadBt)){   // his weight moved while square to his man: a fade (climb: no partner, inherit: the battle came to him) or a swap's ease-in
      const j = Math.hypot(p.mesh.position.x - pr[0] - (p.rx - pr[2]), p.mesh.position.z - pr[1] + (p.ry - pr[3])), kind = p.dblK > pr[4] ? 'swap' : p.bt ? 'inherit' : 'climb';
      pd.dblJump = Math.max(pd.dblJump, j); pd.dblN[kind]++; pd.dblJk[kind] = Math.max(pd.dblJk[kind], j);
    }
    if(p.dblK > 0.001 && !p.ph && S.phase !== 'presnap') dblPrev.set(p, [p.mesh.position.x, p.mesh.position.z, p.rx, p.ry, p.dblK, p.yawK]); else dblPrev.delete(p);
  }
  for(const p of ALL){   // B-037: per-frame change of a square man's drawn offset: a second man's extra (weight and axis), every other engaged man's raw axis (the 1v1 control)
    if(p.ph || S.phase === 'presnap' || !(p.yawK > DBL_YAW)) continue;
    if(p.dblK > 0.001) pd.offJump = Math.max(pd.offJump, p.dblJ); else pd.ctrlJump = Math.max(pd.ctrlJump, p.drawJ);
  }
  for(const d of ALL){
    const b = d.team === 'D' && !d.ph && d.bt, o = b && b.o;
    if(!o || !o.mesh || !engaged(d)) continue;
    const ri = pdInside(d, o), rj = pdInside(o, d), n = k => (ri[k] + rj[k]) > 0;
    pd.frames++; pd.dSim.push(Math.hypot(d.x - o.x, d.y - o.y)); pd.dRen.push(Math.hypot(d.mesh.position.x - o.mesh.position.x, d.mesh.position.z - o.mesh.position.z));
    const s2 = ALL.find(x => x.team === 'O' && x.mesh && x.mesh.visible && secondOf(x) === d);   // B-037: the doubled defender's second man, against the defender and against the first blocker
    if(s2){
      const a = pdInside(d, s2), b = pdInside(s2, d), c = pdInside(o, s2), e = pdInside(s2, o), m = k => (a[k] + b[k] + c[k] + e[k]) > 0;
      pd.dbl++; pd.dblAny += m('head') || m('pad') || m('arm') || m('hh') || m('aa'); pd.dblPad += m('pad'); pd.dblHead += m('head');
    }
    pd.headBody += n('head'); pd.padBody += n('pad'); pd.armBody += n('arm'); pd.headHead += n('hh'); pd.armArm += n('aa'); pd.any += n('head') || n('pad') || n('arm') || n('hh') || n('aa');
  }
}
export function pairReport(){
  const med = a => a.length ? Math.round(1000*a.slice().sort((x, y) => x - y)[a.length >> 1])/1000 : null, f = pd.frames || 1, pc = n => Math.round(1000*n/f)/10;
  const r3 = x => Math.round(1000*x)/1000;
  return {handoffs:pd.handoffs, handoffTorso:r3(pd.hoTorso), handoffShoulder:r3(pd.hoShoulder), handoffMax:r3(Math.max(pd.hoTorso, pd.hoShoulder)), frames:pd.frames, headOffNeckMax:r3(pd0.headOff), limbStretchMax:r3(pd0.stretch), dblJumpMax:r3(pd.dblJump), dblOffsetJumpMax:r3(pd.offJump), dbl1v1JumpMax:r3(pd.ctrlJump), dblFades:pd.dblN, dblJumpKind:{climb:r3(pd.dblJk.climb), inherit:r3(pd.dblJk.inherit), swap:r3(pd.dblJk.swap)}, dblFrames:pd.dbl, dblAnyPct:Math.round(1000*pd.dblAny/(pd.dbl || 1))/10, dblPadsPct:Math.round(1000*pd.dblPad/(pd.dbl || 1))/10, dblHeadPct:Math.round(1000*pd.dblHead/(pd.dbl || 1))/10, medDsim:med(pd.dSim), medDrender:med(pd.dRen), headInBodyPct:pc(pd.headBody), padsInBodyPct:pc(pd.padBody), armInBodyPct:pc(pd.armBody), headHeadPct:pc(pd.headHead), armArmPct:pc(pd.armArm), anyPct:pc(pd.any)};
}
const tmpV = new THREE.Vector3();
const handPos = (p, x, y, z) => p.mesh.localToWorld(tmpV.set(...bodyV([x, y, z])));   // B-021: callers give rig units
export function syncScene(dt){
  ALL.forEach(p => animate(p, dt));
  // ball
  if(ball.state === 'pre') ballMesh.position.copy(handPos(C, 0, 0.15, 0.55));
  else if(ball.state === 'pitch'){
    const k = Math.min(ball.t, 1);
    const a = (ball.pf === C ? handPos(C, 0, 0.15, 0.55) : handPos(ball.pf, 0, 1.5, 0.45)).clone(), b = handPos(ball.pt, 0, 1.4, 0.4);
    ballMesh.position.lerpVectors(a, b, k); ballMesh.position.y += Math.sin(k*Math.PI)*0.6;
  } else if(ball.state === 'held'){
    const c = ball.holder;
    if(c === QB && S.charging) ballMesh.position.copy(handPos(c, -0.5, 2.3, -0.35));
    else if(c === QB && !S.runMode) ballMesh.position.copy(handPos(c, 0, 1.5, 0.45));
    else if(c.ph) ballMesh.position.copy(physBall(c));
    else ballMesh.position.copy(c.j.elR.localToWorld(tmpV.set(...bodyV([0, -0.28, 0.13]))));   // in the ball hand, moving with the arm
  }
  else if(ball.state === 'air'){
    const a = ballPos(Math.min(ball.t, 1)), b = ballPos(Math.min(ball.t + 0.02, 1.02));
    ballMesh.position.copy(toWorld(a.x, a.y, a.h)); ballMesh.lookAt(toWorld(b.x, b.y, b.h));
  }
  if(S.cpu){ routeGroup.visible = false; fitGroup.visible = false; }   // broadcast look: no playbook overlays
  // markers
  ctrlRing.visible = S.phase === 'live' || S.phase === 'presnap';
  ctrlRing.position.set(S.ctrl.x, 0.05, 50 - S.ctrl.y);
  landRing.visible = ball.state === 'air' && S.phase === 'live';
  landRing.position.set(ball.tx, 0.05, 50 - ball.ty);
  const aiming = canThrow();
  aimRing.visible = arcLine.visible = aiming;
  if(aiming){
    const {tx, ty, d} = throwTarget(), arc = throwArc(S.charging ? charge() : 0, d);
    aimRing.position.set(tx, 0.05, 50 - ty);
    const pos = arcGeo.attributes.position.array;
    for(let i = 0; i <= ARC_N; i++){
      const k = i/ARC_N, x = QB.x + (tx - QB.x)*k, y = QB.y + (ty - QB.y)*k, h = 2.0 - 0.6*k + 4*arc.apex*k*(1-k);
      pos[i*3] = x; pos[i*3+1] = h; pos[i*3+2] = 50 - y;
    }
    arcGeo.attributes.position.needsUpdate = true;
  }
  // dock
  $('plays').hidden = S.phase !== 'presnap';
  $('meter').hidden = !aiming;
  $('fill').style.width = (S.charging ? charge()*100 : 0) + '%';
  if(S.cpu && S.phase !== 'over') setHint(`CPU vs CPU · <b>${S.defCall ? S.defCall.name : ''}</b> · <kbd>C</kbd> take control · <kbd>V</kbd> camera`);
  else if(S.phase === 'presnap') setHint(`<b>${S.defCall.name}:</b> ${S.defCall.note} (${S.box} in the box) · Pick a play <kbd>1–${PLAYS.length}</kbd> · <kbd>Click</kbd> to hike`);
  else if(S.runMode && S.phase === 'live' && S.ctrl === RB && !(ball.state === 'held' && ball.holder === RB)) setHint('Handoff coming · <kbd>WASD</kbd> takes over once he has the ball');
  else if(S.runMode && S.phase === 'live' && S.ctrl.auto) setHint('Following the play · <kbd>WASD</kbd> to take over, <kbd>Shift</kbd> to sprint');
  else if(aiming || (ball.state === 'pitch' && !S.runMode)) setHint('<kbd>WASD</kbd> drop back · Aim with the mouse · <kbd>Hold</kbd> for more arc, release to throw');
  else if(ball.state === 'air') setHint('<kbd>WASD</kbd> to adjust the receiver, or let him run to the ball');
  else if(S.phase === 'live') setHint('<kbd>WASD</kbd> to run · <kbd>Shift</kbd> to sprint');
  else if(S.phase === 'over') setHint('<kbd>Click</kbd> to start a new game');
  else setHint('Next play…');
}
