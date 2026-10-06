import { resetCam } from './camera.js';
import { assignFits } from './defense.js';
import { clearCallouts, hideBanner, updateHUD } from './hud.js';
import { drawFits, drawRoutes, routeGroup } from './markers.js';
import { physClear } from './physics.js';
import { DEF_CALLS, PLAYS } from './playbook.js';
import { CBs, DEF, DL, LBs, OFF, OL, QB, RB, RECV, ROUTE_KEYS, SFs, TE, WRs } from './players.js';
import { fdLine, losLine } from './scene.js';
import { $, HW, clamp, rand } from './util.js';

// ---------- state ----------
export const S = {score:0, tds:0, drive:1, los:25, down:1, toGo:10, play:0, phase:'presnap', runMode:false,
           clock:0, deadT:0, charging:false, chargeT:0, over:false, ctrl:QB, cpu:true, preT:0, overT:0, cam:'tv', prog:-Infinity};
export const ball = {state:'pre', holder:null, fx:0, fy:0, tx:0, ty:0, t:0, dur:1, apex:1, thrownAt:0, target:null};
export function selectPlay(i){
  S.play = i;
  PLAYS.forEach((_, j) => $('play'+j).setAttribute('aria-pressed', String(j===i)));
  if(S.phase === 'presnap'){ formation(); assignRoutes(); }
}
// backfield set for the called play: shotgun (back beside the QB) or under center with a singleback
function formation(){
  const L = S.los, under = PLAYS[S.play].under;
  place(QB, 0, L - (under ? 1.2 : 4.5)); place(RB, under ? 0 : 1.8, L - (under ? 6.5 : 4.5));
}
function assignRoutes(){
  const play = PLAYS[S.play];
  RECV.forEach((w, i) => {
    w.wp = 0; w.route = []; w.go = false; w.goDir = {x:0, y:1};
    if(play.run) return;
    const r = play[ROUTE_KEYS[i]], inward = -Math.sign(w.x);
    w.route = r.pts.map(([dx, dy]) => ({x:clamp(w.x + dx*inward, -HW+1, HW-1), y:Math.min(109, S.los + dy)}));
    w.go = r.go;
  });
  if(play.path){ RB.route = play.path.map(([x, dy]) => ({x:clamp(x, -HW+1, HW-1), y:Math.min(109, S.los + dy)})); RB.go = true; }
  RECV.forEach(w => {
    if(!w.route.length) return;
    const b = w.route[w.route.length-1], a = w.route.length > 1 ? w.route[w.route.length-2] : {x:w.x, y:w.y};
    const l = Math.hypot(b.x-a.x, b.y-a.y) || 1; w.goDir = {x:(b.x-a.x)/l, y:(b.y-a.y)/l};
  });
  drawRoutes(); routeGroup.visible = true;
}
function place(p, x, y){
  p.x = x; p.y = y; p.vx = p.vy = 0; p.stun = 0; p.latch = null; p.tkCool = 0; p.downP = 0; p.slow = 1; p.latAcc = 0; p.svx = 0; p.svy = 0; p.tripT = 0; p.reachCool = 0; p.bt = null; p.freeFrom = null; p.freeT = 0; p.beatT = 0; p.locked = false; p.accel = 0; p.falling = false; p.slip = 0; p.grip = null; p.fire = 0; p.fireDelay = 0;
  p.act = null; p.actT = 0; p.eng = 0; p.faceAt = null; p.holeX = null; p.ofLane = null; p.ofT = 0; p.stam = 1; p.churn = false; p.rx = x; p.ry = y; p.face = p.team === 'O' ? Math.PI : 0;
}
export function setupPlay(){
  physClear();
  const L = S.los;
  S.phase = 'presnap'; S.runMode = false; S.charging = false; S.ctrl = QB; S.preT = 0; S.prog = -Infinity;
  OL.forEach((o, i) => { place(o, (i-2)*2.2, L-0.7); });
  place(WRs[0], -20, L-0.8); place(WRs[1], 20, L-0.8); place(WRs[2], -11, L-1.0);
  place(TE, 6.8, L-1.0); formation();
  [-5, -1.2, 1.2, 5].forEach((x, i) => place(DL[i], x, L+1.1));
  DL.forEach(d => { d.mode = 'rush'; });
  CBs.forEach((c, i) => {
    const w = WRs[i]; place(c, w.x - Math.sign(w.x)*0.6, L + (i===2 ? 5 : 6));
    c.mode = 'cover'; c.assign = w; c.cushion = rand(1.0, 2.4);
  });
  SFs.forEach((s, i) => { s.side = i ? 1 : -1; place(s, s.side*10, L+13); s.mode = 'deep'; });
  // react: delay before breaking on a thrown ball; read: delay after the handoff before chasing the runner
  DEF.forEach(d => { d.fit = null; d.react = rand(0.15, 0.45); d.read = d.role === 'DL' ? rand(0.2, 0.35) : rand(0.25, 0.5); });

  // defensive call -> run fits. Every defender gets a job (see RUN FITS below); placement is the alignment.
  const rnd = DEF_CALLS[Math.floor(Math.random()*DEF_CALLS.length)], call = S.defCall = (S.force && S.force.front && DEF_CALLS.find(c => c.name === S.force.front)) || rnd;   // feature (sim-force)
  const blitzer = call.blitz ? Math.floor(Math.random()*2) : -1;
  LBs.forEach((b, i) => {
    const side = i ? 1 : -1, blitz = i === blitzer;
    place(b, side*3.5, blitz ? L+3.5 : L+5);
    b.assign = i ? RB : TE; b.mode = blitz ? 'rush' : 'cover'; b.cushion = 0.6;
  });
  const boxS = call.box ? SFs[Math.floor(Math.random()*2)] : null;
  if(boxS) place(boxS, boxS.side*4.5, L+6);
  assignFits(call, boxS);
  S.handoffAt = Infinity;
  drawFits();
  RB.auto = false;
  OFF.forEach(o => { o.blk = null; o.lane = null; o.via = null; o.climbing = false; o.push = o.role === 'OL' ? 2.5 : o === TE ? 1.4 : o === RB ? 0.8 : o.role === 'WR' ? 0.5 : 0; });
  ball.state = 'pre'; ball.holder = null; ball.target = null;
  losLine.position.z = 50 - L;
  fdLine.position.z = 50 - Math.min(100, L + S.toGo); fdLine.visible = L + S.toGo < 100;
  assignRoutes(); hideBanner(); clearCallouts(); updateHUD(); resetCam();
}
