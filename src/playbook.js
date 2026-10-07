import { cvs } from './scene.js';
import { selectPlay } from './state.js';
import { $ } from './util.js';

export const DEF_CALLS = [
  {name:'Base',             note:'Linemen hold their gaps, linebackers read and fill'},
  {name:'Slant Left',       note:'Whole line slants one gap to your left'},
  {name:'Slant Right',      note:'Whole line slants one gap to your right'},
  {name:'Run Blitz',        note:'One linebacker shoots his gap at the snap', blitz:true},
  {name:'Eight in the Box', note:'A safety rolls down and the linebackers trigger fast', box:true}
];
// ---------- playbook ----------
// route points: [yards toward the middle, yards downfield from the line]
const PASS_GAME = false;
export const PLAYS = [
  {name:'Slants',        out:{pts:[[0,3],[7,9]], go:true},    slot:{pts:[[0,3],[7,9]], go:true},
                         te:{pts:[[0,10],[0,40]], go:true},   rb:{pts:[[-5,1],[-8,3]], go:false}},
  {name:'Verticals',     out:{pts:[[-2,10],[-2,45]], go:true}, slot:{pts:[[1,10],[2,45]], go:true},
                         te:{pts:[[0,10],[1,45]], go:true},   rb:{pts:[[-4,2],[-3,6]], go:false}},
  {name:'Curl / Out',    out:{pts:[[0,13],[1,11]], go:false},  slot:{pts:[[0,6],[-9,6]], go:true},
                         te:{pts:[[0,6],[1,5]], go:false},    rb:{pts:[[-5,1],[-8,3]], go:false}},
  {name:'Post / Corner', out:{pts:[[0,12],[8,30]], go:true},   slot:{pts:[[0,10],[-9,22]], go:true},
                         te:{pts:[[0,4],[14,6]], go:true},    rb:{pts:[[-6,2],[-8,12],[-8,35]], go:true}},
  // run plays: RB path points are [field x, yards from the line]; hand = handoff, toss = pitch.
  // under: QB under center, singleback 7 yards deep (otherwise shotgun with the back beside the QB)
  // mesh: [x, yards from line] where the QB opens to and meets the back on his path
  // scheme 'zone': linemen + TE each own a lane (start x + shift) and block whoever shows up in it, else climb.
  // scheme 'man': `blocks` names each blocker's defender; `pulls` are waypoints [x, yards from line] run first.
  // defender keys: DL0-3 and LB0-1 / S0-1 numbered left to right, CB0-2 = cornerback on WR0-2
  {name:'Inside Zone', run:'hand', scheme:'zone', shift:-1, hole:-1.1,
   blocks:{WR0:'CB0', WR1:'CB1', WR2:'CB2'},
   path:[[-0.5,-3.3],[-1.1,1.5],[-1.1,8]]},
  {name:'Power Left', run:'hand', scheme:'man', hole:-3.6,
   blocks:{LT:'LB0', LG:'DL1', C:'DL2', RG:'DL0', RT:'LB1', TE:'DL3', WR0:'CB0', WR1:'CB1', WR2:'CB2'},
   pulls:{RG:[[0.8,-1.8],[-2.6,-1.8]]},
   path:[[-0.3,-3.6],[-2.8,-1.4],[-3.6,0.8],[-3.8,8]]},   // patient: press the line, cut off the kick-out
  {name:'Outside Zone Right', run:'toss', scheme:'zone', shift:3, hole:8.5,   // aim: tight end's outside hip; he reads bounce / cut back
   blocks:{WR0:'CB0', WR1:'CB1', WR2:'S0'},
   path:[[5,-4.5],[8,-1.8],[8.5,2],[8.5,8]]},
  {name:'HB Dive', under:true, run:'hand', scheme:'zone', shift:0, hole:1.1, mesh:[-0.5, -2.6],   // quick hit in the right A gap: everyone blocks the man in front
   blocks:{WR0:'CB0', WR1:'CB1', WR2:'CB2'},
   path:[[0.7,-3.0],[1.1,0.5],[1.1,8]]},   // passes on the QB's right, takes it on the way by
  {name:'HB Stretch', under:true, run:'hand', scheme:'zone', shift:3, hole:8.5, mesh:[2.0, -2.8],   // outside zone from under center: aim at the TE's hip, read bounce / cut back
   blocks:{WR0:'CB0', WR1:'CB1', WR2:'S0'},
   path:[[1.5,-5.5],[3.2,-3.9],[6.5,-1.8],[8.5,1.5],[8.5,8]]}
].filter(p => PASS_GAME || p.run);
// ---------- orientation ----------
// The plays above are written for the base side (tight end right) and, for under-center plays, the QB under center. orient() rewrites
// the live fields every other module reads (path, hole, shift, pulls, blocks, mesh, under) from that source: flip -1 mirrors paths and
// holes and swaps left/right names (LT/RT, DL0/DL3, ...); the linemen stay where they are, so the blocker names swap instead.
PLAYS.forEach(p => { p.src = {path:p.path, hole:p.hole, shift:p.shift, pulls:p.pulls, blocks:p.blocks, mesh:p.mesh, under:!!p.under}; });
const MIRROR = {LT:'RT', RT:'LT', LG:'RG', RG:'LG'};
// nDL, nLB: linemen and linebackers on the field (DLi -> DL(n-1-i), LBi -> LB(n-1-i); the safeties are always two)
export function orient(play, under, flip, nDL, nLB){
  const N = {DL:nDL, LB:nLB, S:2};
  const key = k => { if(flip > 0) return k; const m = /^(DL|LB|S)(\d)$/.exec(k); return m ? m[1] + (N[m[1]] - 1 - m[2]) : (MIRROR[k] || k); };
  const s = play.src, pt = ([x, dy]) => [x*flip, dy];
  play.path = s.path && s.path.map(pt);
  play.hole = s.hole === undefined ? undefined : s.hole*flip;
  play.shift = s.shift === undefined ? undefined : s.shift*flip;
  play.pulls = s.pulls && Object.fromEntries(Object.entries(s.pulls).map(([k, v]) => [key(k), v.map(pt)]));
  play.blocks = s.blocks && Object.fromEntries(Object.entries(s.blocks).map(([k, v]) => [key(k), key(v)]));
  play.under = under;
  // under center the QB opens to a mesh point (a play written for shotgun gets one at the back's first path point)
  const mesh = under ? (s.mesh || (s.path && [s.path[0][0], -2.8])) : null;
  play.mesh = mesh ? pt(mesh) : undefined;
}
const playsEl = $('plays');
PLAYS.forEach((p, i) => {
  if(i === 0 || (p.run && !PLAYS[i-1].run)){
    const l = document.createElement('span'); l.className = 'group'; l.textContent = p.run ? 'Run' : 'Pass'; playsEl.appendChild(l);
  }
  const b = document.createElement('button'); b.className = 'play'; b.type = 'button'; b.id = 'play' + i;
  b.innerHTML = `<kbd>${i+1}</kbd>${p.name}`;
  b.addEventListener('click', () => { selectPlay(i); cvs.focus(); });
  playsEl.appendChild(b);
});
