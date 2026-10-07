// ---------- defensive fronts (B-007-4) ----------
// Pure data and functions (no imports): playbook.js lists the calls, state.js lines the front up, defense.js turns each defender's
// spec into a run-fit job. Everything is written in STRENGTH coordinates: +x is the strong side (the tight end's side), -x the weak
// side. S.flip (1: tight end right) mirrors it onto the field, so side=L and side=R are mirror images.
// Techniques (x from the center, the OL stand at 0, +-2.2, +-4.4 and the tight end at +-6.8):
//   0 = C, 1 = G shaded 0.7 in, 2 = G, 3 = G shaded 0.8 out, 4 = T, 4i = T shaded 0.7 in, 5 = T shaded 0.8 out,
//   7 = TE shaded 0.8 in, 9 = TE shaded 1.0 out
export const TECH = {'0':0, '1':1.5, '2':2.2, '3':3.0, '4':4.4, '4i':3.7, '5':5.2, '7':6.0, '9':7.8};
const tx = t => { const s = String(t), neg = s[0] === 'W', v = TECH[s.slice(1)]; if(v === undefined) throw new Error('technique ' + t); return neg ? -v : v; };
export const DL_DEPTH = 1.1, LB_DEPTH = 4.5, LB_DEPTH_WEAK = 5.0, EDGE_DEPTH = 1.5;   // yards past the line; weak side = x < 0
export const SS_ROLL = {x:4.5, d:6};   // the rolled-down safety (bear, eight in the box), strength x
// gaps, offense's view: A beside the center, B outside the guards, C outside the tackles, D outside the tight end. Names carry the
// strength: 'AS' = A gap strong, 'CW' = C gap weak. x is on the field.
const GAP_X = {A:1.1, B:3.3, C:5.6, D:8.2};
export function gapX(name, flip){
  const w = name[1] === 'W', side = (w ? -1 : 1)*flip;
  return {x:side*GAP_X[name[0]], side};
}
// Specs: dl [technique | strength x, role, gap(s)], lb [technique | strength x, depth, role, gap]; list order is left to right on the
// strong-is-right field. A two-gap lineman has two gaps ['BW','CW']: he holds until the read, then sheds to the one the ball is on.
// Jobs (defense.js): gap, force, alley, deep, support, two.
const T = (t, role, gap) => [tx(t), role, gap];
const B = (t, d, role, gap) => [typeof t === 'number' ? t : tx(t), d, role, gap];
export const FRONTS = {
  // today's alignment: four down at -5 -1.2 1.2 5, two backers at +-3.5 depth 5. The call decides the fits (ALIAS below).
  nickel: {pers:'nickel', box:6, note:'Four down, two backers, five defensive backs',
    dl:[[-5, 'force', 'CW'], [-1.2, 'gap', 'AW'], [1.2, 'gap', 'AS'], [5, 'gap', 'CS']],
    lb:[[-3.5, 5, 'gap', 'BW'], [3.5, 5, 'gap', 'BS']]},
  over: {pers:'base', box:7, note:'Line shifts strong; Sam on the edge, Will weak',
    dl:[T('W5', 'force', 'CW'), T('W1', 'gap', 'AW'), T('S3', 'gap', 'BS'), T('S9', 'force', 'DS')],
    lb:[B(-3.3, LB_DEPTH_WEAK, 'gap', 'BW'), B(0.8, LB_DEPTH, 'gap', 'AS'), B(4.6, LB_DEPTH, 'gap', 'CS')]},
  under: {pers:'base', box:7, note:'Line shifts weak; Sam on the tight end',
    dl:[T('W5', 'force', 'CW'), T('W3', 'gap', 'BW'), T('S1', 'gap', 'AS'), T('S5', 'gap', 'CS')],
    lb:[B(-1.5, LB_DEPTH_WEAK, 'gap', 'AW'), B(2.6, LB_DEPTH, 'gap', 'BS'), B('S7', EDGE_DEPTH, 'force', 'DS')]},
  odd: {pers:'odd', box:7, note:'Three down hold two gaps, four linebackers stand up',
    dl:[T('W5', 'two', ['BW', 'CW']), T('0', 'two', ['AW', 'AS']), T('S5', 'two', ['BS', 'CS'])],
    lb:[B('W9', EDGE_DEPTH, 'force', 'DW'), B(-2.0, LB_DEPTH_WEAK, 'gap', 'AW'), B(2.0, LB_DEPTH, 'gap', 'AS'), B('S9', EDGE_DEPTH, 'force', 'DS')]},
  bear: {pers:'base', box:8, roll:true, note:'Eight in the box: the line stacks the middle, a safety rolls down',
    dl:[T('W5', 'force', 'CW'), T('W2', 'gap', 'AW'), T('S2', 'gap', 'AS'), T('S9', 'force', 'DS')],
    lb:[B(-3.3, LB_DEPTH_WEAK, 'gap', 'BW'), B(3.3, LB_DEPTH, 'gap', 'BS'), B(5.6, LB_DEPTH, 'gap', 'CS')]}
};
// today's calls on the nickel front: [role, gap] for the four down linemen and the two backers, left to right (weak to strong)
export const ALIAS = {
  'Base':             [['force', 'CW'], ['gap', 'AW'], ['gap', 'AS'], ['gap', 'CS'], ['gap', 'BW'], ['gap', 'BS']],
  'Nickel':           [['force', 'CW'], ['gap', 'AW'], ['gap', 'AS'], ['gap', 'CS'], ['gap', 'BW'], ['gap', 'BS']],
  'Slant Left':       [['force', 'CW'], ['gap', 'BW'], ['gap', 'AW'], ['gap', 'BS'], ['gap', 'AS'], ['gap', 'CS']],
  'Slant Right':      [['gap', 'BW'], ['gap', 'AS'], ['gap', 'BS'], ['force', 'DS'], ['force', 'CW'], ['gap', 'AW']],
  'Run Blitz':        [['force', 'CW'], ['gap', 'AW'], ['gap', 'AS'], ['gap', 'CS'], ['gap', 'BW'], ['gap', 'BS']],
  'Eight in the Box': [['force', 'CW'], ['gap', 'AW'], ['gap', 'AS'], ['gap', 'CS'], ['gap', 'BW'], ['gap', 'BS']]
};
// a personnel that does not match the table (?dpers= forced onto a nickel call): a plain job by where he stands
const gapNear = (x, a, b) => (Math.abs(x) < a ? 'A' : Math.abs(x) < b ? 'B' : 'C') + (x < 0 ? 'W' : 'S');
const LBX = [null, null, [-3.5, 3.5], [-4.5, 0, 4.5], [-6.5, -2.2, 2.2, 6.5]];

// Line the front up. `bodies` = {DL, LBs}; place(body, x, y) is state.js's. Sets d.spec = {role, gap | gaps} on every box
// defender; DL and LBs are filled left to right on the field. blitzer = index among the LBs (left to right) that starts closer.
// Returns the front's table and the number in the box before any safety rolls down.
export function alignDefense(fr, call, flip, L, bodies, place, blitzer = -1){
  const {DL, LBs} = bodies;
  const alias = fr === FRONTS.nickel ? ALIAS[call.name] : null;
  let dl = fr.dl.map((s, i) => ({x:s[0], d:DL_DEPTH, role:alias ? alias[i][0] : s[1], gap:alias ? alias[i][1] : s[2]}));
  let lb = fr.lb.map((s, i) => ({x:s[0], d:s[1], role:alias ? alias[4 + i][0] : s[2], gap:alias ? alias[4 + i][1] : s[3]}));
  if(DL.length !== dl.length){   // nickel with another personnel: legacy spacing, weak end forces, the rest by where they stand
    dl = (DL.length === 4 ? [-5, -1.2, 1.2, 5] : [-4.5, 0, 4.5]).map((x, i) => ({x, d:DL_DEPTH, role:i ? 'gap' : 'force', gap:gapNear(x, 1.7, 4.2)}));
    dl[0].gap = 'CW';
  }
  if(LBs.length !== lb.length) lb = LBX[LBs.length].map(x => ({x, d:5, role:'gap', gap:gapNear(x, 1.5, 5.5)}));
  const side = list => list.map(s => ({...s, ax:s.x*flip})).sort((a, b) => a.ax - b.ax);
  side(dl).forEach((s, i) => { const d = DL[i]; place(d, s.ax, L + s.d); d.spec = Array.isArray(s.gap) ? {role:s.role, gaps:s.gap} : {role:s.role, gap:s.gap}; });
  side(lb).forEach((s, i) => { const d = LBs[i]; place(d, s.ax, L + (i === blitzer ? 3.5 : s.d)); d.spec = {role:s.role, gap:s.gap}; });
  return fr.box;
}
