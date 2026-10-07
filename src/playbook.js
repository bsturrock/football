import { GRID_K } from './formations.js';
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
// B-030: Power / Counter playside. LG: double the nose with the center (uncovered), else the man on him; LT: join the guard's man even when covered, else down. need / not: the form's personnel (blockrules.js allowed)
const need = (r, n) => Object.assign(r, {need:n}), not = (r, n) => Object.assign(r, {not:n});
const PWR_LT = [['double','backside','cov'],['down']], PWR_LG = [['double','backside'],['on'],['down']];
export const DRAW_DELAY = 0.9;   // B-007-12: seconds from the snap to the Draw handoff
const DRAW_OL = [['pass'],['on'],['down']];   // 'pass' is held by offense.js (pass set until the handoff); the handoff re-read takes the man on him
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
  // B-030 Power / Counter (the reference "Who blocks whom"), written for the weak-side hole (-x) with the tight end +x, read against the front by blockrules.js. Per slot, so a scheme-knowledge rating can hang off each rule later.
  //   playside (LT, LG, C): the guard doubles the nose with the center when he is uncovered (odd), else takes the man on him; the tackle joins the guard's man ('cov': even front, the end man stays for the kick-out)
  //   or, with nobody to join, blocks down; the center blocks back (the nearest line man away from the hole, else the gap the puller left); the backside tackle / tight end block the man on them.
  // Power: no fullback = the backside guard kicks out (as before) and nobody wraps; with the kick-out man already taken (a second tight end on the edge) he wraps to the playside backer.
  {name:'Power', run:'hand', scheme:'man', hole:-3.6, forms:['21 I', '11 Under', '12 Under'], mesh:[-0.3,-2.8],
   rules:{LT:PWR_LT, LG:PWR_LG, C:[['back']], RG:[need(['pull','wrap','ps'], 'FB'), not(['pull','kick'], 'FB'), not(['pull','wrap','ps'], 'FB')], RT:[['on'],['backer','near']], TE:[['on'],['down']],   // RT: no 'down', the kick-out man is the fullback's
          FB:[['later'],['pull','kick'],['backer','ps']], TE2:[['on'],['reach']], ...WR_ON},
   pulls:{RG:[]},   // RG pulls by rule; the empty list marks him a puller (carrier.js), the waypoints come from blockrules.js
   path:[[-0.3,-3.6],[-2.8,-1.4],[-3.6,0.8],[-3.8,8]]},   // patient: press the line, cut off the kick-out
  // Counter (GT): the backside guard kicks out, the backside tackle wraps behind him, the fullback fills the backside the line left (no fullback: the gap stays open, the tight end keeps the man on him)
  {name:'Counter', run:'hand', scheme:'man', hole:-3.6, forms:['21 I', '12 Under'], mesh:[0.9,-2.7],
   rules:{LT:PWR_LT, LG:PWR_LG, C:[['back']], RG:[['later'],['pull','kick'],['edge']], RT:[['pull','wrap','ps'],['on'],['backer','near']], TE:[['on'],['down']],
          FB:[['back'],['backer','ps'],['any']], TE2:[['on'],['reach']], ...WR_ON},
   pulls:{RG:[], RT:[]},
   path:[[1.0,-3.4],[-1.5,-1.6],[-3.6,0.8],[-3.8,8]]},   // jab step away, then back across to the hole behind the pullers
  // Trap: the guard across from the hole pulls and traps the first down lineman beyond the center; the rest block the man on them
  {name:'Trap', run:'hand', scheme:'man', hole:1.1, forms:['11 Under', '21 I'], mesh:[0.7,-2.8],
   rules:{LT:[['on']], LG:[['pull','trap'],['on']], C:[['on']], RG:[['on']], RT:[['on']], TE:[['on'],['down']], ...EXTRAS, ...WR_ON},
   pulls:{LG:[]},
   path:[[0.7,-3.0],[1.1,0.5],[1.1,8]]},
  {name:'Outside Zone', run:'toss', scheme:'zone', shift:3, hole:8.5, forms:['11 Gun', '12 Under', '21 I'],   // aim: tight end's outside hip; he reads bounce / cut back
   rules:OUTSIDE_ZONE,
   path:[[5,-4.5],[8,-1.8],[8.5,2],[8.5,8]],
   alt:{under:{run:'hand', mesh:[2.0,-2.8], path:[[1.5,-5.5],[3.2,-3.9],[6.5,-1.8],[8.5,1.5],[8.5,8]]}}},   // from under center: the old Stretch (handoff)
  // B-007-12 batch 3. Toss: the QB pitches, the backside guard pulls to kick the edge, the fullback wraps to the backer, the strong receiver cracks the safety
  {name:'Toss', run:'toss', scheme:'man', hole:8.5, forms:['11 Gun', '21 I', '12 Under'],
   rules:{LT:[['down']], LG:[['pull','kick'],['down']], C:[['reach'],['on'],['down']], RG:[['reach'],['on']], RT:[['reach'],['on']], TE:[['boxS'],['reach'],['on']],
          FB:[['pull','wrap'],['backer','ps'],['any']], TE2:[['on'],['down']], WR0:[['corner']], WR1:[['deep'],['corner']], WR2:[['corner']]},
   pulls:{LG:[]},
   path:[[5,-4.5],[8,-1.8],[8.5,2],[8.5,8]]},
  // Draw: a pass set for DRAW_DELAY s (the defense reads pass), then the handoff and the OL turn to the man on them. offense.js holds the pass set until the handoff, main.js times it,
  // defense.js keeps the line rushing and the backers dropping until the handoff plus the read
  {name:'Draw', run:'hand', scheme:'man', hole:1.1, delay:DRAW_DELAY, forms:['11 Gun', '21 I'], mesh:[0.6,-5.4],
   rules:{LT:DRAW_OL, LG:DRAW_OL, C:DRAW_OL, RG:DRAW_OL, RT:DRAW_OL, TE:[['pass'],['on'],['down']], FB:[['backer','ps'],['any']], TE2:[['on'],['reach']], ...WR_ON},
   path:[[1.1,-2.5],[1.1,0.5],[1.1,8]]},
  {name:'Duo', run:'hand', scheme:'man', hole:1.1, forms:['21 I', '12 Under', '22 Heavy'], mesh:[-0.5,-2.6],   // double teams at the point of attack, back picks his gap
   rules:{LT:DUO_OL, LG:DUO_OL, C:DUO_OL, RG:DUO_OL, RT:DUO_OL, TE:[['on'],['down']], ...EXTRAS, ...WR_ON},
   path:[[0.7,-3.0],[1.1,0.5],[1.1,8]]},
  {name:'Iso', run:'hand', scheme:'man', hole:-1.1, forms:['21 I', '22 Heavy'], mesh:[0.5,-2.6],   // the fullback leads into the middle backer, everybody blocks the man on him
   rules:{LT:ISO_OL, LG:ISO_OL, C:ISO_OL, RG:ISO_OL, RT:ISO_OL, TE:[['on'],['down']], FB:[['backer','mike'],['backer','ps'],['any']], TE2:[['on'],['reach']], ...WR_ON},
   path:[[-0.7,-3.0],[-1.1,0.5],[-1.1,8]]}
].filter(p => PASS_GAME || p.run);
// ---------- orientation ----------
// B-021: x in the plays above is on the old 2.2 yd line grid (hole 1.1 = the A gap); orient() puts it on the new one (formations.js GRID_K, x0.61).
// The plays above are written for the base side (tight end right) and, for under-center plays, the QB under center. orient() rewrites
// the live fields every other module reads (path, hole, shift, pulls, blocks, mesh, under) from that source: flip -1 mirrors paths and
// holes and swaps left/right blocker names (LT/RT, ...); the linemen stay where they are, so the blocker names swap instead. The rules
// (play.src.rules) are mirrored by resolveBlocks and read the defenders by where they stand, so they have no names to swap.
PLAYS.forEach(p => { p.src = {path:p.path, hole:p.hole, shift:p.shift, pulls:p.pulls, rules:p.rules, mesh:p.mesh, run:p.run, alt:p.alt, delay:p.delay}; });
const MIRROR = {LT:'RT', RT:'LT', LG:'RG', RG:'LG'};
export function orient(play, under, flip){
  const key = k => flip > 0 ? k : MIRROR[k] || k;
  const s = {...play.src, ...(play.src.alt && play.src.alt[under ? 'under' : 'gun'])}, pt = ([x, dy]) => [x*flip*GRID_K, dy];   // the form's variant overlays run / shift / mesh / path
  play.run = s.run;
  play.path = s.path && s.path.map(pt);
  play.hole = s.hole === undefined ? undefined : s.hole*flip*GRID_K;
  play.shift = s.shift === undefined ? undefined : s.shift*flip*GRID_K;
  play.pulls = s.pulls && Object.fromEntries(Object.entries(s.pulls).map(([k, v]) => [key(k), v.map(pt)]));
  play.under = under; play.delay = s.delay;
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
