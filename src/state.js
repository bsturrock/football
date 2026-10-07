import { resetCam } from './camera.js';
import { assignFits } from './defense.js';
import { clearCallouts, hideBanner, updateHUD } from './hud.js';
import { drawFits, drawRoutes, routeGroup } from './markers.js';
import { pileReset } from './pile.js';
import { physClear } from './physics.js';
import { chooseForm, formByName, lineUp } from './formations.js';
import { FRONTS, GAP_X, SS_ROLL, alignDefense } from './fronts.js';
import { DEF_CALLS, PLAYS, orient } from './playbook.js';
import { CBs, DEF, DL, EXTRA, LBs, OFF, OL, QB, RB, RECV, ROUTE_KEYS, SFs, TE, WRs } from './players.js';
import { persName, subIn } from './roster.js';
import { fdLine, losLine } from './scene.js';
import { $, HW, clamp, rand } from './util.js';

// ---------- state ----------
export const S = {flip:1, form:null, score:0, tds:0, drive:1, los:25, down:1, toGo:10, play:0, phase:'presnap', runMode:false,
           clock:0, deadT:0, charging:false, chargeT:0, over:false, ctrl:QB, cpu:true, preT:0, overT:0, cam:'tv', prog:-Infinity, offPers:null};
export const ball = {state:'pre', holder:null, fx:0, fy:0, tx:0, ty:0, t:0, dur:1, apex:1, thrownAt:0, target:null};
export function selectPlay(i){
  S.play = i;
  PLAYS.forEach((_, j) => $('play'+j).setAttribute('aria-pressed', String(j===i)));
  if(S.phase !== 'presnap') return;
  S.form = pickForm(PLAYS[i]);   // drawn once; formation() and setupPlay(keep) reuse it
  if(S.offPers && S.form.pers !== S.offPers){ setupPlay(true); return; }   // the play's formation brings other personnel: the same defense and side, new offense
  formation(); assignRoutes();
}
// the offense lines up in the formation (src/formations.js) for the called play, mirrored by S.flip; the play's own fields are
// re-oriented to match (playbook.js orient)
function formation(){
  const play = PLAYS[S.play], form = S.form;   // set by selectPlay / setupPlay
  orient(play, form.under, S.flip); lineUp(form, S.los, S.flip, place, {OL, QB, RB, TE, WRs, EXTRA});
}
// the formation for a play, in this order: a forced ?form=, the forced personnel's formation in the play's list, the current formation when the
// list has it (not on a fresh setup), else one at random from the list. A play without a list uses the personnel's. Drawn once per play call
// (B-007-10). A forced personnel the list has no formation for falls back to the rest (the sim rejects that pair up front).
function pickForm(play, fresh){
  const named = formByName(forced('form')); if(named) return named;
  const pers = persName('off', forced('pers'));
  if(!play.forms) return chooseForm(false, null, pers);
  const list = play.forms.map(formByName), byPers = pers ? list.find(f => f.pers === pers) : null;
  const hint = S.formHint && list.find(f => f.name === S.formHint);   // B-007-13: the CPU's formation choice (after a forced form or personnel)
  return byPers || hint || (!fresh && S.form && list.includes(S.form) ? S.form : null) || list[Math.floor(Math.random()*list.length)];
}
// personnel for the next play: forced by the sim (?pers=, ?dpers=), else the page URL, else 11 and nickel
const URLQ = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const forced = key => (S.force && S.force[key]) || URLQ.get(key);
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
  p.x = x; p.y = y; p.vx = p.vy = 0; p.stun = 0; p.latch = null; p.tkCool = 0; p.downP = 0; p.slow = 1; p.latAcc = 0; p.svx = 0; p.svy = 0; p.tripT = 0; p.reachCool = 0; p.bt = null; p.freeFrom = null; p.freeT = 0; p.beatT = 0; p.locked = false; p.ruled = false; p.accel = 0; p.falling = false; p.slip = 0; p.grip = null; p.fire = 0; p.fireDelay = 0;
  p.act = null; p.actT = 0; p.eng = 0; p.faceAt = null; p.holeX = null; p.rd = null; p.ofLane = null; p.ofT = 0; p.stam = 1; p.churn = false; p.rx = x; p.ry = y; p.face = p.team === 'O' ? Math.PI : 0;
}
// keep: a play change before the snap that needs other personnel (selectPlay) redoes the setup with the same defense (call, blitzer, box safety,
// cushions, read delays), side and chosen formation
export function setupPlay(keep = false){
  physClear();
  const form0 = keep ? S.form : S.form = pickForm(PLAYS[S.play], true); S.offPers = form0.pers;
  // the defensive call and its front first: the front brings its personnel (a ?dpers= only reshapes a nickel-front call)
  const dp = forced('dpers') ? persName('def', forced('dpers')) : null;   // a forced ?dpers= limits the random call to fronts of that personnel and nickel-front calls (they reshape to it)
  const pool = dp ? DEF_CALLS.filter(c => c.front === 'nickel' || FRONTS[c.front].pers === dp) : DEF_CALLS;
  const call = S.defCall = keep ? S.defCall : (S.force && S.force.front && DEF_CALLS.find(c => c.name === S.force.front)) || pool[Math.floor(Math.random()*pool.length)], fr = FRONTS[call.front];   // feature (sim-force)
  subIn(form0.pers, call.front === 'nickel' && dp ? dp : fr.pers);   // dead ball: the formation's personnel and the defense's take the field
  const L = S.los;
  S.phase = 'presnap'; S.runMode = false; S.charging = false; S.ctrl = QB; S.preT = 0; S.prog = -Infinity; S.read = null; pileReset();
  const sd = String(forced('side') || '').toUpperCase();   // one side per play (a play change before the snap keeps it): ?side=L|R, else the coin
  if(!keep) S.flip = sd === 'L' ? -1 : sd === 'R' ? 1 : Math.random() < 0.5 ? -1 : 1;
  formation();
  DL.forEach(d => { d.mode = 'rush'; });
  // a corner lines up on the receiver of his number; the spare one (nickel against 12, 21 or 22: no third WR) takes the second tight end,
  // else the fullback, from a weak slot nine yards out
  const spare = [...EXTRA].sort((a, b) => (a.pos === 'TE' ? 0 : 1) - (b.pos === 'TE' ? 0 : 1))[0] || RB;
  CBs.forEach((c, i) => {
    const w = WRs[i] || spare;
    if(WRs[i]) place(c, w.x - Math.sign(w.x)*0.6, L + (i===2 ? 5 : 6)); else place(c, -S.flip*9, L + 5);
    c.mode = 'cover'; c.assign = w; if(!keep) c.cushion = rand(1.0, 2.4);
  });
  SFs.forEach((s, i) => { s.side = i ? 1 : -1; place(s, s.side*10, L+13); s.mode = 'deep'; });
  // react: delay before breaking on a thrown ball; read: delay after the handoff before chasing the runner
  DEF.forEach(d => { d.fit = null; if(!keep){ d.react = rand(0.15, 0.45); d.read = d.role === 'DL' ? rand(0.2, 0.35) : rand(0.25, 0.5); } });

  // defensive call -> front -> run fits. Every defender gets a job (see RUN FITS in defense.js); placement is the alignment.
  const blitzer = keep ? S.blitzer : S.blitzer = call.blitz ? Math.floor(Math.random()*2) : -1;
  S.front = call.front;
  const inBox = alignDefense(fr, call, S.flip, L, {DL, LBs}, place, blitzer);
  LBs.forEach((b, i) => {
    b.assign = i < 2 ? (i ? RB : TE) : (EXTRA[i-2] || RB); b.mode = i === blitzer ? 'rush' : 'cover'; b.cushion = 0.6;
  });
  DEF.forEach(d => { d.job = {role:'gap', gx:clamp(d.x, -GAP_X.C, GAP_X.C), side:Math.sign(d.x) || 1}; });   // a default job for a body the front has no slot for; assignFits overwrites the rest
  const boxS = keep ? S.boxS : S.boxS = fr.roll ? SFs.find(s => s.side === S.flip) : call.box ? SFs[Math.floor(Math.random()*2)] : null;   // a safety who rolls into the box: the strong one in a bear
  if(boxS) place(boxS, boxS.side*SS_ROLL.x, L + SS_ROLL.d);
  S.box = inBox + (boxS ? 1 : 0);
  assignFits(call, boxS);
  S.handoffAt = Infinity;
  drawFits();
  RB.auto = false;
  OFF.forEach(o => { o.blk = null; o.dbl = null; o.ruled = false; o.lane = null; o.via = null; o.pull = null; o.rr = null; o.climbing = false; o.push = o.role === 'OL' ? 2.5 : o.pos === 'TE' ? 1.4 : o.pos === 'RB' || o.pos === 'FB' ? 0.8 : o.role === 'WR' ? 0.5 : 0; });
  S.blkEv = []; S.blkStunt = false;   // B-007-9: stunt re-read events (blockrules.js)
  S.pulls = [];   // feature (pulls): B-007-8, the pull log resets with the blockers
  ball.state = 'pre'; ball.holder = null; ball.target = null;
  losLine.position.z = 50 - L;
  fdLine.position.z = 50 - Math.min(100, L + S.toGo); fdLine.visible = L + S.toGo < 100;
  assignRoutes(); hideBanner(); clearCallouts(); updateHUD(); resetCam();
}
