import { setHint } from './hud.js';
import { ballPos, canThrow, charge, throwArc, throwTarget } from './input.js';
import { ARC_N, aimRing, arcGeo, arcLine, ballMesh, ctrlRing, fitGroup, landRing, routeGroup } from './markers.js';
import { physBall } from './physics.js';
import { PLAYS } from './playbook.js';
import { ALL, C, JOINTS, QB, RB } from './players.js';
import { toWorld } from './scene.js';
import { S, ball } from './state.js';
import { $, clamp } from './util.js';

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
    if(p.role === 'OL' || p.role === 'DL') Object.assign(T, {lean:1.2, hipL:-1.3, hipR:-1.1, kneeL:1.7, kneeR:1.5, drop:0.42, shR:-1.25, elR:0, shL:-0.5, elL:-0.6});
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
  else if(p.bt && p.team === 'D' && p.bt.phase === 'move' && p.bt.move === 'speed'){ T.shL = -1.3; T.shR = -2.9; T.elL = -0.5; T.elR = -0.2; T.twist = 0.4; }  // swim
  else if(p.bt && p.team === 'D' && p.bt.phase === 'move'){ arms(-1.7, -1.7, -0.1); T.lean = 0.9; }                                // bull rush
  else if(p.bt && p.team === 'D' && p.bt.phase === 'recover'){ arms(-1.0, -1.0, -0.8); T.lean = 0.2; }                             // knocked upright
  else if(p.bt || p.eng > 0){ arms(-1.6, -1.6, -0.3); T.lean = Math.max(T.lean, 0.5); }
  return T;
}
function animate(p, dt){
  // a runner held up keeps churning his legs at full stride whatever his speed
  const sp = p.churn && p.ph && !p.falling && !(p.latch && p.latch.falling) ? Math.max(5.5, Math.hypot(p.vx, p.vy)*1.3) : Math.hypot(p.vx, p.vy);
  p.stride += sp > 0.3 ? 2*Math.PI*(1.1 + 0.16*sp)*dt : 0;   // cadence rises with speed (~2.2 strides/s flat out)
  if(p.actT > 0){ p.actT -= dt; if(p.actT <= 0) p.act = null; }
  if(p.eng > 0) p.eng -= dt; else if(p.team === 'O') p.bt = null;
  if(p.beatT > 0) p.beatT -= dt;
  const t = p.faceAt;   // blockers square up to their man instead of facing where they move
  if(!p.ph && p.act !== 'down' && p.act !== 'dive' && p.act !== 'fall' && (t || sp > 0.4)){
    const d = (t ? Math.atan2(t.x - p.x, p.y - t.y) : Math.atan2(p.vx, -p.vy)) - p.face;
    p.face += Math.atan2(Math.sin(d), Math.cos(d))*Math.min(1, dt*14);
  }
  const T = targetPose(p, sp), P = p.pose, k = 1 - Math.exp(-dt*16), J = p.j;
  for(const j of JOINTS) P[j] += (T[j] - P[j])*k;
  J.torso.rotation.set(P.lean, P.twist, 0);
  J.hipL.rotation.x = P.hipL; J.hipR.rotation.x = P.hipR; J.kneeL.rotation.x = P.kneeL; J.kneeR.rotation.x = P.kneeR;
  J.shL.rotation.set(P.shL, 0, 0.12); J.shR.rotation.set(P.shR, 0, -0.12); J.elL.rotation.x = P.elL; J.elR.rotation.x = P.elR;
  p.body.position.y = P.bob - P.drop + Math.abs(P.pitch)*0.15;
  p.body.rotation.x = P.pitch;
  p.mesh.position.set(p.x, 0, 50 - p.y); p.mesh.rotation.y = p.face;
  p.mesh.updateMatrixWorld(true);
}
const tmpV = new THREE.Vector3();
const handPos = (p, x, y, z) => p.mesh.localToWorld(tmpV.set(x, y, z));
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
    else ballMesh.position.copy(c.j.elR.localToWorld(tmpV.set(0, -0.28, 0.13)));   // in the ball hand, moving with the arm
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
  else if(S.phase === 'presnap') setHint(`<b>${S.defCall.name}:</b> ${S.defCall.note} · Pick a play <kbd>1–${PLAYS.length}</kbd> · <kbd>Click</kbd> to hike`);
  else if(S.runMode && S.phase === 'live' && S.ctrl === RB && !(ball.state === 'held' && ball.holder === RB)) setHint('Handoff coming · <kbd>WASD</kbd> takes over once he has the ball');
  else if(S.runMode && S.phase === 'live' && S.ctrl.auto) setHint('Following the play · <kbd>WASD</kbd> to take over, <kbd>Shift</kbd> to sprint');
  else if(aiming || (ball.state === 'pitch' && !S.runMode)) setHint('<kbd>WASD</kbd> drop back · Aim with the mouse · <kbd>Hold</kbd> for more arc, release to throw');
  else if(ball.state === 'air') setHint('<kbd>WASD</kbd> to adjust the receiver, or let him run to the ball');
  else if(S.phase === 'live') setHint('<kbd>WASD</kbd> to run · <kbd>Shift</kbd> to sprint');
  else if(S.phase === 'over') setHint('<kbd>Click</kbd> to start a new game');
  else setHint('Next play…');
}
