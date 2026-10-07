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
const OL_ZONE_DBL = [['double','playside'],['on'],['down']];
const DUO_OL = [['double','playside'],['double','backside'],['on']], ISO_OL = [['on'],['down'],['backer','near']];
// Inside Zone: a lineman with nobody on him doubles the covered man beside him on the playside, else everyone blocks the man on him
const INSIDE_DBL = {LT:OL_ZONE_DBL, LG:OL_ZONE_DBL, C:OL_ZONE_DBL, RG:OL_ZONE_DBL, RT:OL_ZONE_DBL, TE:[['boxS'],['on'],['down']], ...EXTRAS, ...WR_ON};
// Outside Zone: the playside reaches the outside shade, the backside takes the man toward the hole; the C reaches too
const OZ_PS = [['reach'],['on'],['backer','near']], OZ_BS = [['down'],['backer','near']];
const OUTSIDE_ZONE = {LT:OZ_BS, LG:OZ_BS, C:OZ_PS, RG:OZ_PS, RT:OZ_PS, TE:[['boxS'],['reach'],['on']], ...EXTRAS, ...WR_DEEP};
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
  // B-007-10 batch 1. `forms`: the formations the play runs from (the first is the default; a form picks `alt.gun` or `alt.under`, which overlays run/shift/mesh/path).
  {name:'Inside Zone', run:'hand', scheme:'zone', shift:-1, hole:-1.1, forms:['11 Gun', '11 Under', '12 Under'],
   rules:{...INSIDE_DBL},   // doubles the covered man from the uncovered neighbour (['double','playside']), else the man on him
   path:[[-0.5,-3.3],[-1.1,1.5],[-1.1,8]],
   alt:{under:{shift:-1, mesh:[0.5,-2.6], path:[[-0.7,-3.0],[-1.1,0.5],[-1.1,8]]}}},   // under center: the old Dive, mirrored to the strong-side-away A gap
  {name:'Power Left', run:'hand', scheme:'man', hole:-3.6,
   rules:{LT:[['backer','ps']], LG:[['on'],['down']], C:[['on'],['down']], RG:[['pull','kick'],['edge']], RT:[['backer','mike']], TE:[['on'],['down']], ...EXTRAS, ...WR_ON},
   pulls:{RG:[]},   // RG pulls by rule (['pull','kick']); the empty list marks him a puller (carrier.js), the waypoints come from blockrules.js
   path:[[-0.3,-3.6],[-2.8,-1.4],[-3.6,0.8],[-3.8,8]]},   // patient: press the line, cut off the kick-out
  {name:'Outside Zone', run:'toss', scheme:'zone', shift:3, hole:8.5, forms:['11 Gun', '12 Under', '21 I'],   // aim: tight end's outside hip; he reads bounce / cut back
   rules:OUTSIDE_ZONE,
   path:[[5,-4.5],[8,-1.8],[8.5,2],[8.5,8]],
   alt:{under:{run:'hand', mesh:[2.0,-2.8], path:[[1.5,-5.5],[3.2,-3.9],[6.5,-1.8],[8.5,1.5],[8.5,8]]}}},   // from under center: the old Stretch (handoff)
  {name:'Duo', run:'hand', scheme:'man', hole:1.1, forms:['21 I', '12 Under', '22 Heavy'], mesh:[-0.5,-2.6],   // double teams at the point of attack, back picks his gap
   rules:{LT:DUO_OL, LG:DUO_OL, C:DUO_OL, RG:DUO_OL, RT:DUO_OL, TE:[['on'],['down']], ...EXTRAS, ...WR_ON},
   path:[[0.7,-3.0],[1.1,0.5],[1.1,8]]},
  {name:'Iso', run:'hand', scheme:'man', hole:-1.1, forms:['21 I', '22 Heavy'], mesh:[0.5,-2.6],   // the fullback leads into the middle backer, everybody blocks the man on him
   rules:{LT:ISO_OL, LG:ISO_OL, C:ISO_OL, RG:ISO_OL, RT:ISO_OL, TE:[['on'],['down']], FB:[['backer','mike'],['backer','ps'],['any']], TE2:[['on'],['reach']], ...WR_ON},
   path:[[-0.7,-3.0],[-1.1,0.5],[-1.1,8]]}
].filter(p => PASS_GAME || p.run);
// ---------- orientation ----------
// The plays above are written for the base side (tight end right) and, for under-center plays, the QB under center. orient() rewrites
// the live fields every other module reads (path, hole, shift, pulls, blocks, mesh, under) from that source: flip -1 mirrors paths and
// holes and swaps left/right blocker names (LT/RT, ...); the linemen stay where they are, so the blocker names swap instead. The rules
// (play.src.rules) are mirrored by resolveBlocks and read the defenders by where they stand, so they have no names to swap.
PLAYS.forEach(p => { p.src = {path:p.path, hole:p.hole, shift:p.shift, pulls:p.pulls, rules:p.rules, mesh:p.mesh, run:p.run, alt:p.alt}; });
const MIRROR = {LT:'RT', RT:'LT', LG:'RG', RG:'LG'};
export function orient(play, under, flip){
  const key = k => flip > 0 ? k : MIRROR[k] || k;
  const s = {...play.src, ...(play.src.alt && play.src.alt[under ? 'under' : 'gun'])}, pt = ([x, dy]) => [x*flip, dy];   // the form's variant overlays run / shift / mesh / path
  play.run = s.run;
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
