import { separate } from './blocking.js';
import { defenseAI } from './defense.js';
import { setDrillBar } from './hud.js';
import { giveBall, snap } from './input.js';
import { ballMesh, ctrlRing } from './markers.js';
import { offenseAI } from './offense.js';
import { physStep } from './physics.js';
import { DEF_CALLS, PLAYS } from './playbook.js';
import { ALL, DL, LG, LT, OL, QB, RB, RG, RT, C } from './players.js';
import { camera } from './scene.js';
import { S, selectPlay, setupPlay } from './state.js';

// ---------- blocking drill (B-019) ----------
// ?drill=1v1 | line. One run-block rep after another on the game's own code: setupPlay lines the offense and the front up, snap() resolves
// the block rules against the whole front, then only the drilled bodies run offenseAI / defenseAI / separate (the rest are hidden and parked
// off the field). No drill-only blocking or defense logic. A rep is: line up (PRE_S), snap, play out (REP_S), line up again.
// B-037 (double-pose): add &play=<play name> to force another play (a combo play forms doubles; the 1v1 and line views stay on the men over the linemen).
// States: presnap --PRE_S--> live --REP_S--> presnap (new setupPlay). A mode switch restarts the rep from any state.
const PRE_S = 1.2, REP_S = 4.5;
const PLAY_Q = new URLSearchParams(location.search).get('play');   // B-037 (double-pose): ?play=<name> forces a play (e.g. Inside Zone: a combo, so doubles form); an unknown name gives {"error":...} in <pre id="checkout"> (B-040) and the drill runs Iso
const FORCED = PLAYS.find(p => p.name.toLowerCase() === String(PLAY_Q).toLowerCase());
export const drillError = PLAY_Q && !FORCED ? 'unknown play ' + PLAY_Q : null;   // B-042 (axis-glide): main.js writes it as the frames line instead of running; a normal page shows it on the drill panel and runs Iso
const PLAY = FORCED ? FORCED.name : 'Iso';   // Iso (the default): a man-blocking run, every lineman takes the man on him (no doubles, no pulls); a forced play is whatever ?play names
const CAM = new URLSearchParams(location.search).get('cam');
const SIDE = CAM === 'side';   // B-042: ?cam=behind (default, as before) | side
const LOS_CAM = {x:9, y:1.6, z:2.5};   // B-052 ?cam=los camera offset from the line's centre (yd): toward the right end, up, a little behind the offense
const LOS = CAM === 'los';   // B-052: ?cam=los, the broadcast photo angle: from the line's right end, near profile with both rows showing (offense left); LOS_CAM below
const note = m => (drillError ? 'Unknown play "' + PLAY_Q + '": running Iso. ' : '') + NOTES[m];
const OL_BY_NAME = {LT, LG, C, RG, RT};
const NOTES = {
  '1v1': 'One lineman against the defender over him. Watch: does he stay square and locked on the man, how does the defender rotate or shed, does the block drive him back.',
  line: 'Five linemen against the four down linemen. Watch: tackles against the ends, guards and center against the tackles; the lineman with nobody on him climbs.'
};
const q = new URLSearchParams(location.search);
let mode = q.get('drill') === 'line' ? 'line' : '1v1', t = 0, parts = {off:[], def:[]};
const lineman = OL_BY_NAME[(q.get('ol') || '').toUpperCase()] || LG;   // 1v1: ?ol=LT|LG|C|RG|RT, default the left guard
const call = (DEF_CALLS.find(c => c.name.toLowerCase() === String(q.get('front') || 'Base').toLowerCase()) || DEF_CALLS[0]).name;   // ?front=<defensive call name>, default Base

function newRep(){
  t = 0;
  S.force = {play:PLAY, front:call}; S.cpu = true;
  selectPlay(PLAYS.findIndex(p => p.name === PLAY)); setupPlay();
  if(mode === '1v1'){
    const d = DL.reduce((a, b) => Math.hypot(b.x - lineman.x, b.y - lineman.y) < Math.hypot(a.x - lineman.x, a.y - lineman.y) ? b : a);
    parts = {off:[lineman], def:[d]};
  } else parts = {off:[...OL], def:[...DL]};
  ALL.forEach(p => { p.mesh.visible = parts.off.includes(p) || parts.def.includes(p); });
  if(LOS && mode === 'line') QB.mesh.visible = true;   // B-052: the photo angle also shows the QB under center (looked at only: he is not a drilled man and never runs)
}
// snap with the full front on the field (the block rules read all of it), then take everyone else off
function liveSnap(){
  snap();
  const on = [...parts.off, ...parts.def];
  ALL.filter(p => !on.includes(p)).forEach((p, i) => { p.x = p.rx = -9 + i*0.9; p.y = p.ry = -10; p.vx = p.vy = 0; });   // dead ball behind the end line, 0.9 apart (separate() pushes under SEP_R 0.56)
  // the defense needs a ball target: the play's handoff spot (RB.route[0]; Iso: behind the line between the guards), held fixed; the ball and control ring are scaled to nothing in drillStart so nothing floats there
  QB.mesh.visible = false;   // B-054: the rep is live, the LOS-pose QB (drillStart) goes back to hidden like every other parked man
  const h = RB.route[0]; RB.x = RB.rx = h.x; RB.y = RB.ry = h.y; RB.vx = RB.vy = 0;
  giveBall(RB);   // as in a game: ball held, handoffAt set, the blockers re-read the front once more (it sees the parked men, so the clearing below comes after)
  parts.off.forEach(o => { if(o.blk && !parts.def.includes(o.blk)) o.blk = null; if(!FORCED || (o.dbl && !parts.off.includes(o.dbl.mate))) o.dbl = null; });   // B-037 (double-pose): a forced play keeps the doubles the block rules formed
}
export function setMode(m){
  mode = m; const u = new URL(location.href); u.searchParams.set('drill', m); history.replaceState(null, '', u);
  setDrillBar(mode, note(mode)); newRep();
}
export function drillStart(){
  S.drill = true; ballMesh.scale.setScalar(0); ctrlRing.scale.setScalar(0);   // the ball (in hidden hands) and the ring (under hidden QB/RB) would float on empty grass
  setDrillBar(mode, note(mode), setMode); newRep(); }
export function drillTick(dt){
  t += dt;
  if(S.phase === 'presnap'){ if(t >= PRE_S) liveSnap(); }
  else {
    S.clock += dt;
    const inp = {x:0, y:0, on:false};
    parts.off.forEach(o => offenseAI(o, dt, inp));
    parts.def.forEach(d => defenseAI(d, dt));
    separate();
    if(t >= PRE_S + REP_S) newRep();
  }
  physStep(dt);
}
const look = new THREE.Vector3(), pos = new THREE.Vector3(), want = new THREE.Vector3(), tgt = new THREE.Vector3();
let snapCam = true;
// framed on the rep: the drilled men's centre, close and low from the offense's side; the line view stands back
export function drillCamera(dt){
  const on = [...parts.off, ...parts.def];
  if(!on.length) return;
  const cx = on.reduce((a, p) => a + p.x, 0)/on.length, cy = on.reduce((a, p) => a + p.y, 0)/on.length;
  if(camera.fov !== 40){ camera.fov = 40; camera.updateProjectionMatrix(); }
  const line = mode === 'line';
  tgt.set(cx, 1, 50 - cy);
  if(LOS){ want.set(cx + LOS_CAM.x, LOS_CAM.y, 50 - cy + LOS_CAM.z); tgt.set(cx - 1, 0.6, 50 - cy - 0.5); }   // B-052
  else if(SIDE) want.set(cx + (line ? 13 : 7), line ? 2.4 : 2, 50 - cy);   // B-042 ?cam=side: side-on at the line, both teams in view
  else want.set(cx + (line ? 3 : 5), line ? 8 : 4.2, 50 - cy + (line ? 14 : 7));
  const k = snapCam ? 1 : 1 - Math.exp(-dt*3); snapCam = false;
  look.lerp(tgt, k); pos.lerp(want, k);
  camera.position.copy(pos); camera.lookAt(look);
}
