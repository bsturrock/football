import { setHint } from './hud.js';
import { ballPos, canThrow, charge, throwArc, throwTarget } from './input.js';
import { ARC_N, aimRing, arcGeo, arcLine, ballMesh, ctrlRing, fitGroup, landRing, routeGroup } from './markers.js';
import { physBall } from './physics.js';
import { PLAYS } from './playbook.js';
import { ALL, BODY_H, C, JOINTS, QB, RB, bodyV } from './players.js';
import { toWorld } from './scene.js';
import { S, ball } from './state.js';
import { $, FACE_RATE, clamp, faceYaw } from './util.js';

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
  if(p.act === 'celebrate'){ arms(-3.0, -3.0, -0.1); T.bob = Math.abs(Math.sin(performance.now()/120))*0.35; return T; }
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
const engaged = p => !!p.bt || p.eng > 0;
const driving = p => !!p.bt && (p.bt.phase === 'recover' || Math.hypot(p.vx, p.vy) > DRIVE_V) && (p.team === 'O' || p.bt.phase === 'move' || p.bt.phase === 'recover');
function engagedPose(T, p, s, cs){
  const ph = p.x*1.7 + p.y*2.3, w = performance.now()/1000, fight = Math.sin(w*9 + ph), fight2 = Math.sin(w*7.3 + ph*1.9);
  const ph2 = p.bt && p.team === 'D' ? p.bt.phase : null, mv = p.bt && p.bt.move;
  const churn = driving(p) ? 1 : 0, ch = 0.3*churn;
  const low = {lean:0.8, drop:0.34, hipL:-1.05 + ch*s, hipR:-0.95 - ch*s, kneeL:1.55 + 0.3*churn*Math.max(0, cs), kneeR:1.45 + 0.3*churn*Math.max(0, -cs), twist:0, bob:0};
  Object.assign(T, low);
  const reach = (lean, el, l = 0, r = 0) => { T.shL = -(1.45 + lean) + l; T.shR = -(1.45 + lean) + r; T.elL = el; T.elR = el; };   // arm angle = reach + lean puts the hand level with the other man's chest
  if(p.team === 'O'){
    if(p.bt && p.bt.phase === 'recover'){ T.lean = 0.9; T.drop = 0.38; }   // driving him: lower, pushing
    reach(T.lean, -0.8, 0.07*fight, -0.07*fight);                            // punched in, hands inside the pads
  } else if(ph2 === 'move' && mv === 'speed'){                               // swim: near arm clubs the blocker, far arm goes over the top
    T.lean = 0.7; T.twist = 0.4; T.drop = 0.3;
    T.shL = -(1.45 + T.lean) + 0.1*fight; T.elL = -0.8; T.shR = -3.0 + 0.15*fight2; T.elR = -0.2;
  } else if(ph2 === 'move'){                                                 // bull rush: head down, both hands driving, legs churning
    T.lean = 0.95; T.drop = 0.37; reach(T.lean, -0.4, 0.03*fight, -0.03*fight);
  } else if(ph2 === 'recover'){                                              // driven back: sitting higher, hands still on the blocker, legs scuffling
    T.lean = 0.55; T.drop = 0.22; T.hipL = -0.85 + 0.25*s; T.hipR = -0.75 - 0.25*s; T.kneeL = 1.1 + 0.3*Math.max(0, cs); T.kneeR = 1.0 + 0.3*Math.max(0, -cs);
    reach(T.lean, -1.0, 0.1*fight, -0.1*fight2);
  } else reach(T.lean, -0.9, 0.1*fight, -0.1*fight2);                        // set / fighting the hands: hands working on his chest plate
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
  J.head.rotation.x = -ENG_HEAD*P.lean*p.engW;   // head up while engaged: eyes on his man, not the turf
  J.torso.rotation.set(P.lean, P.twist, 0);
  J.hipL.rotation.x = P.hipL; J.hipR.rotation.x = P.hipR; J.kneeL.rotation.x = P.kneeL; J.kneeR.rotation.x = P.kneeR;
  J.shL.rotation.set(P.shL, 0, 0.12); J.shR.rotation.set(P.shR, 0, -0.12); J.elL.rotation.x = P.elL; J.elR.rotation.x = P.elR;
  p.body.position.y = (P.bob - P.drop + Math.abs(P.pitch)*0.15)*BODY_H;   // B-021: poses are in rig yards
  p.body.rotation.x = P.pitch;
  // drawn position eases to the simulated one: contact shoves and block pushes read as motion, not a twitch
  const k2 = 1 - Math.exp(-dt*22);
  p.rx = p.rx == null ? p.x : p.rx + (p.x - p.rx)*k2; p.ry = p.ry == null ? p.y : p.ry + (p.y - p.ry)*k2;
  p.mesh.position.set(p.rx, 0, 50 - p.ry); p.mesh.rotation.y = p.face;
  p.mesh.updateMatrixWorld(true);
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
