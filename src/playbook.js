import { cvs } from './scene.js';
import { selectPlay } from './state.js';
import { $ } from './util.js';

// Defensive calls. `front` names the table in fronts.js. The first five are today's calls, kept as aliases on the nickel front (their
// fits are fronts.js ALIAS); the rest are real fronts with their own personnel (4-3 base, 3-4 odd) and fits. blitz / box flags as before.
export const DEF_CALLS = [
  {name:'Base',             front:'nickel', note:'Linemen hold their gaps, linebackers read and fill'},
  {name:'Slant Left',       front:'nickel', stunt:'Slant L', note:'Whole line slants one gap to the weak side, the backers fill what it opens'},
  {name:'Slant Right',      front:'nickel', stunt:'Slant R', note:'Whole line slants one gap to the strong side, the backers fill what it opens'},
  {name:'Run Blitz',        front:'nickel', note:'One linebacker shoots his gap at the snap', blitz:true},
  {name:'Eight in the Box', front:'nickel', note:'A safety rolls down and the linebackers trigger fast', box:true},
  {name:'Nickel',           front:'nickel', note:'Four down, two linebackers, three corners'},
  {name:'4-3 Over',         front:'over',   note:'Line shifts to the tight end, Sam on the edge'},
  {name:'4-3 Under',        front:'under',  note:'Line shifts away from the tight end, Sam on him'},
  {name:'3-4 Odd',          front:'odd',    note:'Three linemen hold two gaps, four linebackers stand up'},
  {name:'Tex',              front:'under',  stunt:'Tex',  note:'Strong tackle crashes outside, the end loops behind him into the gap'},
  {name:'Loop',             front:'over',   stunt:'Loop', note:'Strong end crashes inside, the tackle loops behind him to the edge'},
  {name:'LB A-Gap Blitz',   front:'under',  stunt:'LB A-Gap Blitz', note:'A linebacker shoots an A gap at the snap'},
  {name:'LB B-Gap Blitz',   front:'odd',    stunt:'LB B-Gap Blitz', note:'A linebacker shoots a B gap at the snap'},
  {name:'Safety Blitz',     front:'nickel', stunt:'Safety Blitz', note:'The strong safety comes down through the C gap'},
  {name:'Bear',             front:'bear',   note:'Eight in the box: stacked middle, a safety rolled down', box:true}
];
// ---------- playbook ----------
// block rules (src/blockrules.js): per blocker a list of rules, the first that finds a defender wins; written for the base side
// (hole to -x for Power, tight end +x) and mirrored by flip. The corner / safety rules are the receivers' stalk blocks.
const WR_ON = {WR0:[['corner']], WR1:[['corner']], WR2:[['corner']]}, WR_DEEP = {WR0:[['corner']], WR1:[['corner']], WR2:[['deep']]};
const EXTRAS = {FB:[['backer','ps'],['any']], TE2:[['on'],['reach']]};
const OL_INSIDE = [['line'],['down'],['backer','near']], OL_DOUBLE = [['double','playside'],['double','backside'],['line'],['down'],['backer','near']], OL_OUTSIDE = [['reach'],['on'],['backer','near']];
const INSIDE = {LT:OL_INSIDE, LG:OL_INSIDE, C:OL_INSIDE, RG:OL_INSIDE, RT:OL_INSIDE, TE:[['boxS'],['on'],['down']], ...EXTRAS, ...WR_ON};
const OUTSIDE = {LT:OL_OUTSIDE, LG:OL_OUTSIDE, C:OL_OUTSIDE, RG:OL_OUTSIDE, RT:OL_OUTSIDE, TE:[['boxS'],['reach'],['on']], ...EXTRAS, ...WR_DEEP};
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
  // scheme 'man': linemen keep the defender the rules gave them; `pulls` are waypoints [x, yards from line] run first.
  // `rules`: blocker -> rule list (blockrules.js)
  {name:'Inside Zone', run:'hand', scheme:'zone', shift:-1, hole:-1.1,   // an uncovered lineman doubles a covered neighbour playside first (B-007-7)
   rules:{...INSIDE, LT:OL_DOUBLE, LG:OL_DOUBLE, C:OL_DOUBLE, RG:OL_DOUBLE, RT:OL_DOUBLE},
   path:[[-0.5,-3.3],[-1.1,1.5],[-1.1,8]]},
  {name:'Power Left', run:'hand', scheme:'man', hole:-3.6,
   rules:{LT:[['backer','ps']], LG:[['on'],['down']], C:[['on'],['down']], RG:[['edge']], RT:[['backer','mike']], TE:[['on'],['down']], ...EXTRAS, ...WR_ON},
   pulls:{RG:[[0.8,-1.8],[-2.6,-1.8]]},
   path:[[-0.3,-3.6],[-2.8,-1.4],[-3.6,0.8],[-3.8,8]]},   // patient: press the line, cut off the kick-out
  {name:'Outside Zone Right', run:'toss', scheme:'zone', shift:3, hole:8.5,   // aim: tight end's outside hip; he reads bounce / cut back
   rules:OUTSIDE,
   path:[[5,-4.5],[8,-1.8],[8.5,2],[8.5,8]]},
  {name:'HB Dive', under:true, run:'hand', scheme:'zone', shift:0, hole:1.1, mesh:[-0.5, -2.6],   // quick hit in the right A gap: everyone blocks the man in front
   rules:INSIDE,
   path:[[0.7,-3.0],[1.1,0.5],[1.1,8]]},   // passes on the QB's right, takes it on the way by
  {name:'HB Stretch', under:true, run:'hand', scheme:'zone', shift:3, hole:8.5, mesh:[2.0, -2.8],   // outside zone from under center: aim at the TE's hip, read bounce / cut back
   rules:OUTSIDE,
   path:[[1.5,-5.5],[3.2,-3.9],[6.5,-1.8],[8.5,1.5],[8.5,8]]}
].filter(p => PASS_GAME || p.run);
// ---------- orientation ----------
// The plays above are written for the base side (tight end right) and, for under-center plays, the QB under center. orient() rewrites
// the live fields every other module reads (path, hole, shift, pulls, blocks, mesh, under) from that source: flip -1 mirrors paths and
// holes and swaps left/right blocker names (LT/RT, ...); the linemen stay where they are, so the blocker names swap instead. The rules
// (play.src.rules) are mirrored by resolveBlocks and read the defenders by where they stand, so they have no names to swap.
PLAYS.forEach(p => { p.src = {path:p.path, hole:p.hole, shift:p.shift, pulls:p.pulls, rules:p.rules, mesh:p.mesh, under:!!p.under}; });
const MIRROR = {LT:'RT', RT:'LT', LG:'RG', RG:'LG'};
export function orient(play, under, flip){
  const key = k => flip > 0 ? k : MIRROR[k] || k;
  const s = play.src, pt = ([x, dy]) => [x*flip, dy];
  play.path = s.path && s.path.map(pt);
  play.hole = s.hole === undefined ? undefined : s.hole*flip;
  play.shift = s.shift === undefined ? undefined : s.shift*flip;
  play.pulls = s.pulls && Object.fromEntries(Object.entries(s.pulls).map(([k, v]) => [key(k), v.map(pt)]));
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
