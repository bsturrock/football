import { GRID_K as K, OL_GAP, NEUTRAL_Z, STANCE_REACH } from './formations.js';
// ---------- defensive fronts (B-007-4) ----------
// Pure data and functions (imports only formations.js's OL_GAP, GRID_K, NEUTRAL_Z and STANCE_REACH, also pure): playbook.js lists the calls, state.js lines the front up, defense.js turns each defender's
// spec into a run-fit job. Everything is written in STRENGTH coordinates: +x is the strong side (the tight end's side), -x the weak
// side. S.flip (1: tight end right) mirrors it onto the field, so side=L and side=R are mirror images.
// Techniques (x from the center, the OL stand at 0, +-OL_GAP, +-2 OL_GAP and the tight end at +-3 OL_GAP):
//   0 = C, 1 = G shaded 0.45 in, 2 = G, 3 = G shaded 0.5 out, 4 = T, 4i = T shaded 0.45 in, 5 = T shaded 0.5 out,
//   7 = TE shaded 0.5 in, 9 = TE shaded 0.6 out
// B-021: the line grid is formations.js's OL_GAP (1.35 yd, was 2.2): guards at 1 gap, tackles at 2, the tight end at 3. K (formations.js GRID_K) scales a number written
// on the old 2.2 grid (the nickel and linebacker x's below) onto it; the techniques are rebuilt from the grid and the body width (shade = about
// a half body, 0.45-0.5 yd, was 0.7-0.8).
export const TECH = {'0':0, '1':OL_GAP - 0.45, '2':OL_GAP, '3':OL_GAP + 0.5, '4':2*OL_GAP, '4i':2*OL_GAP - 0.45, '5':2*OL_GAP + 0.5, '7':3*OL_GAP - 0.5, '9':3*OL_GAP + 0.6};
const tx = t => { const s = String(t); if(s === "0") return 0; const neg = s[0] === "W", v = TECH[s.slice(1)]; if(v === undefined) throw new Error('technique ' + t); return neg ? -v : v; };
export const DL_DEPTH = NEUTRAL_Z/2 + STANCE_REACH, LB_DEPTH = 4.5, LB_DEPTH_WEAK = 5.0, EDGE_DEPTH = DL_DEPTH + 0.5;   // yards past the line; weak side = x < 0. EDGE_DEPTH (1.455) must stay below blockrules.js WRAP_Y (1.5), else a wrapper picks the stand-up edge over the backer
export const SS_ROLL = {x:4.5*K, d:6};   // the rolled-down safety (bear, eight in the box), strength x
// gaps, offense's view: A beside the center, B outside the guards, C outside the tackles, D outside the tight end. Names carry the
// strength: 'AS' = A gap strong, 'CW' = C gap weak. x is on the field.
export const GAP_X = {A:0.5*OL_GAP, B:1.5*OL_GAP, C:2.5*OL_GAP, D:3*OL_GAP + 0.8};
export function gapX(name, flip){
  const w = name[1] === 'W', side = (w ? -1 : 1)*flip;
  return {x:side*GAP_X[name[0]], side};
}
// Specs: dl [technique | strength x, role, gap(s)], lb [technique | strength x, depth, role, gap]; list order is left to right on the
// strong-is-right field. A two-gap lineman has two gaps ['BW','CW']: he holds until the read, then sheds to the one the ball is on.
// Jobs (defense.js): gap, force, alley, deep, support, two.
const T = (t, role, gap) => [tx(t), role, gap];
const B = (t, d, role, gap) => [typeof t === 'number' ? t*K : tx(t), d, role, gap];
export const FRONTS = {
  // today's alignment: four down at -5 -1.2 1.2 5, two backers at +-3.5 depth 5. The call decides the fits (ALIAS below).
  nickel: {pers:'nickel', box:6, note:'Four down, two backers, five defensive backs',
    dl:[[-5*K, 'force', 'CW'], [-1.2*K, 'gap', 'AW'], [1.2*K, 'gap', 'AS'], [5*K, 'gap', 'CS']],
    lb:[[-3.5*K, 5, 'gap', 'BW'], [3.5*K, 5, 'gap', 'BS']]},
  over: {pers:'base', box:7, note:'Line shifts strong; Sam on the edge, Will weak',
    dl:[T('W5', 'force', 'CW'), T('W1', 'gap', 'AW'), T('S3', 'gap', 'BS'), T('S9', 'force', 'DS')],
    lb:[B(-3.3, LB_DEPTH_WEAK, 'gap', 'BW'), B(0.8, LB_DEPTH, 'gap', 'AS'), B(4.6, LB_DEPTH, 'gap', 'CS')]},
  under: {pers:'base', box:7, note:'Line shifts weak; Sam on the tight end',
    dl:[T('W5', 'force', 'CW'), T('W3', 'gap', 'BW'), T('S1', 'gap', 'AS'), T('S5', 'gap', 'CS')],
    lb:[B(-1.5, LB_DEPTH_WEAK, 'gap', 'AW'), B(2.6, LB_DEPTH, 'gap', 'BS'), B('S7', EDGE_DEPTH, 'force', 'DS')]},
  odd: {pers:'odd', box:7, note:'Three down hold two gaps, four linebackers stand up',
    dl:[T('W5', 'two', ['BW', 'CW']), T('0', 'two', ['AW', 'AS']), T('S5', 'two', ['BS', 'CS'])],
    lb:[B('W9', EDGE_DEPTH, 'force', 'DW'), B(-2.0, LB_DEPTH_WEAK, 'gap', 'AW'), B(2.0, LB_DEPTH, 'gap', 'AS'), B('S9', EDGE_DEPTH, 'force', 'DS')]},
  bear: {pers:'base', box:7, roll:true, note:'Eight in the box: the line stacks the middle, a safety rolls down',
    dl:[T('W5', 'force', 'CW'), T('W2', 'gap', 'AW'), T('S2', 'gap', 'AS'), T('S9', 'force', 'DS')],
    lb:[B(-3.3, LB_DEPTH_WEAK, 'gap', 'BW'), B(3.3, LB_DEPTH, 'gap', 'BS'), B(5.6, LB_DEPTH, 'gap', 'CS')]}
};
// today's calls on the nickel front: [role, gap] for the four down linemen and the two backers, left to right (weak to strong)
export const ALIAS = {
  'Base':             [['force', 'CW'], ['gap', 'AW'], ['gap', 'AS'], ['gap', 'CS'], ['gap', 'BW'], ['gap', 'BS']],
  'Nickel':           [['force', 'CW'], ['gap', 'AW'], ['gap', 'AS'], ['gap', 'CS'], ['gap', 'BW'], ['gap', 'BS']],
  'Run Blitz':        [['force', 'CW'], ['gap', 'AW'], ['gap', 'AS'], ['gap', 'CS'], ['gap', 'BW'], ['gap', 'BS']],
  'Eight in the Box': [['force', 'CW'], ['gap', 'AW'], ['gap', 'AS'], ['gap', 'CS'], ['gap', 'BW'], ['gap', 'BS']]
};
// a personnel that does not match the table (?dpers= forced onto a nickel call): a plain job by where he stands
const gapNear = (x, a, b) => (Math.abs(x) < a ? 'A' : Math.abs(x) < b ? 'B' : 'C') + (x < 0 ? 'W' : 'S');
const LBX = [null, null, [-3.5, 3.5], [-4.5, 0, 4.5], [-6.5, -2.2, 2.2, 6.5]].map(r => r && r.map(x => x*K));

// Backers refit to the linemen: they take exactly the gaps the linemen leave open, matched by x (weak to strong); a side with no
// force gets one from its outermost backer (weak CW, strong DS); backers left over spill to the gap by where they stand. `lbs` =
// [{x, d, role?, gap?}]; a backer already a 'force' (a stand-up edge man) keeps his job. Used for a personnel the call's table was
// not written for, and after a slant moved the line.
const GAPS = ['CW', 'BW', 'AW', 'AS', 'BS', 'CS'], GAP_STR = {CW:-GAP_X.C, BW:-GAP_X.B, AW:-GAP_X.A, AS:GAP_X.A, BS:GAP_X.B, CS:GAP_X.C};
function reshapeBackers(dl, lbs, strongForce = true){
  const keep = lbs.filter(b => b.role === 'force');
  const covered = new Set([...dl, ...keep].flatMap(s => [].concat(s.gap))), forces = [...dl, ...keep].filter(s => s.role === 'force').map(s => String(s.gap));
  const lb = lbs.filter(b => b.role !== 'force').map(b => ({x:b.x, d:b.d, role:'gap', gap:null})).sort((a, b) => a.x - b.x), free = [...lb];
  if(!forces.some(g => g.endsWith('W')) && free.length){ const w = free.shift(); w.role = 'force'; w.gap = 'CW'; covered.add('CW'); }
  if(strongForce && !forces.some(g => g.endsWith('S')) && free.length){ const st = free.pop(); st.role = 'force'; st.gap = 'DS'; }
  const open = GAPS.filter(g => !covered.has(g));   // weak to strong, like the free backers
  if(open.length >= free.length){   // every backer gets one: the order-preserving match with the least total walk, so nobody crosses the formation
    const best = (i, j) => {
      if(i === free.length) return {cost:0, pick:[]};
      let r = null;
      for(let k = j; k <= open.length - (free.length - i); k++){
        const sub = best(i + 1, k + 1), cost = Math.abs(free[i].x - GAP_STR[open[k]]) + sub.cost;
        if(!r || cost < r.cost) r = {cost, pick:[open[k], ...sub.pick]};
      }
      return r;
    };
    best(0, 0).pick.forEach((g, i) => { free[i].gap = g; });
    free.length = 0;
  } else open.forEach(g => {   // more backers than open gaps: each gap takes its nearest backer, the rest spill
    const b = free.reduce((a, c) => Math.abs(c.x - GAP_STR[g]) < Math.abs(a.x - GAP_STR[g]) ? c : a);
    b.gap = g; free.splice(free.indexOf(b), 1);
  });
  free.forEach(b => { b.gap = gapNear(b.x, 1.5*K, 5.5*K); });   // spill: more backers than open gaps
  return [...keep, ...lb];
}

// ---------- stunts and blitzes (B-007-5) ----------
// A call may carry `stunt` (a key of STUNTS). planStunt rewrites the fit specs the front produced, in strength coordinates, so that
// after the stunt every gap AW..CS still has a defender and each side still has a force. Kinds:
//   slant   the whole line takes the next gap toward the slant side (dir -1 = weak side, +1 = strong); the backers refit to what it opened
//   twist   the two strong-side linemen trade gaps: one crashes straight to the other's gap, the other loops behind him through a
//           waypoint (Tex: the tackle crashes, the end loops; Loop: the end crashes, the tackle loops)
//   blitz   the backer nearest the A or B gap (a coin picks the side) shoots it; whoever held that gap takes the gap he left
//   safety  the strong safety comes down from depth 7 through the strong C gap (the force when the front has none on that side)
// Stunt states, per defender (d.stunt = {st, via, t0, blitz}; defense.js drives it, stuntStep is the transition table):
//   aligned  event S.clock >= STUNT_T              -> looping (has a via) or gap
//   looping  event VIA_T s since the waypoint began, or within 0.5 yd of it -> gap
//   gap      event handoff made (S.clock > S.handoffAt), or GAP_MAX s in the gap -> free
//   free     normal run fit on his new gap (terminal)
export const STUNT_T = 0.2, VIA_T = 0.35, VIA_DEPTH = 2.2, VIA_NEAR = 0.5, GAP_MAX = 1.5, BLITZ_READ = 0, BLITZ_DELAY = 0.15, SAFETY_D = 7;
export const STUNTS = {
  'Slant L':        {kind:'slant', dir:-1},
  'Slant R':        {kind:'slant', dir:1},
  'Tex':            {kind:'twist', first:'inner'},
  'Loop':           {kind:'twist', first:'outer'},
  'LB A-Gap Blitz': {kind:'blitz', gap:'A'},
  'LB B-Gap Blitz': {kind:'blitz', gap:'B'},
  'Safety Blitz':   {kind:'safety', gap:'CS', d:SAFETY_D}
};
const ORDER = ['DW', 'CW', 'BW', 'AW', 'AS', 'BS', 'CS', 'DS'];
const shiftGap = (g, dir) => ORDER[Math.max(1, Math.min(ORDER.length - 2, ORDER.indexOf(g) + dir))];   // the line never slants past the C gaps
export function stuntStep(s, t, nearVia, released){
  if(s.st === 'aligned' && t >= STUNT_T){ s.st = s.via ? 'looping' : 'gap'; s.t0 = t; }
  else if(s.st === 'looping' && (t - s.t0 >= VIA_T || nearVia)){ s.st = 'gap'; s.t0 = t; }
  else if(s.st === 'gap' && (released || t - s.t0 >= GAP_MAX)) s.st = 'free';
  return s.st;
}
// dl, lb: spec lists in strength coordinates ({x, d, role, gap}); edited in place (lb entries may be replaced: returns the lb list)
export function planStunt(name, dl, lb, flip, rnd = Math.random){
  const st = STUNTS[name];
  if(!st) throw new Error('stunt ' + name);
  if(st.kind === 'slant'){
    const dir = st.dir;   // strength-relative: Slant Left (-1) goes weak, Slant Right (+1) strong
    dl.forEach(s => {
      const old = s.gap;
      s.gap = Array.isArray(s.gap) ? s.gap.map(g => shiftGap(g, dir)) : shiftGap(s.gap, dir);
      if(s.role === 'force' && String(s.gap) !== String(old)) s.role = 'gap';   // an edge man who moved in is a gap man now
      s.stunt = {};
    });
    return reshapeBackers(dl, lb, false);   // the strong force stays the safety's (assignFits) when no box man holds it
  }
  if(st.kind === 'twist'){
    const [a, b] = [...dl].sort((p, q) => q.x - p.x).slice(0, 2).sort((p, q) => p.x - q.x);   // inner, outer on the strong side
    if(!b) return lb;
    [a.gap, b.gap] = [b.gap, a.gap]; [a.role, b.role] = [b.role, a.role];
    const [crash, loop] = st.first === 'inner' ? [a, b] : [b, a];
    crash.stunt = {};
    loop.stunt = {via:{x:crash.x, dy:VIA_DEPTH}};
    return lb;
  }
  if(st.kind === 'blitz'){
    const g = st.gap + (rnd() < 0.5 ? 'S' : 'W');
    const cand = lb.filter(b => b.role === 'gap' && typeof b.gap === 'string');
    if(!cand.length) return lb;
    const b = cand.reduce((p, q) => Math.abs(q.x - GAP_STR[g]) < Math.abs(p.x - GAP_STR[g]) ? q : p), v = b.gap;
    if(v !== g){
      const others = [...dl, ...lb].filter(s => s !== b), holder = others.find(s => [].concat(s.gap).includes(g));
      if(holder && !others.some(s => [].concat(s.gap).includes(v))) holder.gap = Array.isArray(holder.gap) ? holder.gap.map(x => x === g ? v : x) : v;
      b.gap = g;
    }
    b.stunt = {blitz:true};
    return lb;
  }
  return lb;   // safety: not in the box, see safetyJob
}
// the blitzing safety's job: the strong C gap, as the force when no box defender is the strong force
export const safetyJob = strongForce => ({role:strongForce ? 'gap' : 'force', gap:STUNTS['Safety Blitz'].gap});

const fieldStunt = (st, flip) => st.via ? {via:{x:st.via.x*flip, dy:st.via.dy}} : st;
// Line the front up. `bodies` = {DL, LBs}; place(body, x, y) is state.js's. Sets d.spec = {role, gap | gaps} on every box
// defender; DL and LBs are filled left to right on the field. blitzer = index among the LBs (left to right) that starts closer.
// Returns the number of linemen and backers in the box (a rolled safety adds one: bear 8).
export function alignDefense(fr, call, flip, L, bodies, place, blitzer = -1){
  const {DL, LBs} = bodies;
  const alias = fr === FRONTS.nickel ? ALIAS[call.name] : null;
  let dl = fr.dl.map((s, i) => ({x:s[0], d:DL_DEPTH, role:alias ? alias[i][0] : s[1], gap:alias ? alias[i][1] : s[2]}));
  let lb = fr.lb.map((s, i) => ({x:s[0], d:s[1], role:alias ? alias[4 + i][0] : s[2], gap:alias ? alias[4 + i][1] : s[3]}));
  if(DL.length !== dl.length){   // nickel with a 3-man personnel: legacy spacing; weak end forces, the nose holds both A gaps, the strong end takes C
    dl = [[-4.5, 'force', 'CW'], [0, 'two', ['AW', 'AS']], [4.5, 'gap', 'CS']].map(([x, role, gap]) => ({x:x*K, d:DL_DEPTH, role, gap}));
  }
  if(LBs.length !== lb.length) lb = reshapeBackers(dl, LBX[LBs.length].map(x => ({x, d:5})));
  if(call.stunt) lb = planStunt(call.stunt, dl, lb, flip);
  const side = list => list.map(s => ({...s, ax:s.x*flip})).sort((a, b) => a.ax - b.ax);
  side(dl).forEach((s, i) => { const d = DL[i]; place(d, s.ax, L + s.d); d.spec = Array.isArray(s.gap) ? {role:s.role, gaps:s.gap} : {role:s.role, gap:s.gap}; if(s.stunt) d.spec.stunt = fieldStunt(s.stunt, flip); });
  side(lb).forEach((s, i) => { const d = LBs[i]; place(d, s.ax, L + (i === blitzer ? 3.5 : s.d)); d.spec = {role:s.role, gap:s.gap}; if(s.stunt) d.spec.stunt = fieldStunt(s.stunt, flip); });
  return fr.box;
}
