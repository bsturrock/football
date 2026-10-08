import { KEYS, rateTeams } from './ratings.js';

// ---------- rosters ----------
// Each of the two teams (O = the offense's team, D = the defense's team) holds 46 game-day records. The 22 bodies on the field
// are fixed slots: subIn() copies the chosen records onto them between plays (dead ball only; setupPlay calls it). Pure: no THREE,
// no random draws (names, numbers and ids are fixed by position order, so a record keeps them across games and team regens;
// only ratings are redrawn). Ids are for later stats (L-1006-097): id = team + two-digit player number in the roster (O07, D31).
export const COUNTS = {QB:2, RB:3, FB:1, WR:6, TE:3, OL:8, DE:4, DT:4, LB:6, CB:5, S:4};   // 23 offense + 23 defense (DL = 4 DE + 4 DT); K, P, LS out of scope
const ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'DE', 'DT', 'LB', 'CB', 'S'];
const UNIT = {QB:'O', RB:'O', FB:'O', WR:'O', TE:'O', OL:'O', DE:'D', DT:'D', LB:'D', CB:'D', S:'D'};
const TPL = {FB:'RB'};   // ratings template (ratings.js TEMPLATES); a fullback rates as a power back
// engine role (what role checks read): the receivers' group takes every offensive skill player, as the old WR/TE/RB bodies did
const ROLE = {QB:'QB', RB:'WR', FB:'WR', WR:'WR', TE:'WR', OL:'OL', DE:'DL', DT:'DL', LB:'LB', CB:'CB', S:'S'};
export const FB_MASS = 245;
// personnel: counts of bodies by group. Offense {RB, FB, TE, WR} plus QB and 5 OL; defense {DL, LB, CB, S}
export const PERSONNEL = {
  off: {'11':{RB:1, FB:0, TE:1, WR:3}, '12':{RB:1, FB:0, TE:2, WR:2}, '21':{RB:1, FB:1, TE:1, WR:2}, '22':{RB:1, FB:1, TE:2, WR:1}},
  def: {nickel:{DL:4, LB:2, CB:3, S:2, name:'4-2-5'}, base:{DL:4, LB:3, CB:2, S:2, name:'4-3-4'}, odd:{DL:3, LB:4, CB:2, S:2, name:'3-4-4'}}
};
export const DEFAULT_PERS = {off:'11', def:'nickel'};
const DEF_ALIAS = {'4-2-5':'nickel', '4-3-4':'base', '4-3':'base', '3-4-4':'odd', '3-4':'odd'};
export const persName = (kind, v) => { const s = String(v).trim().toLowerCase(); const k = kind === 'def' ? (DEF_ALIAS[s] || s) : s; return PERSONNEL[kind][k] ? k : null; };

// overall = weighted mean of a player's ratings, weights per position (KEYS order: speed accel strength agility vision tackling shed pursuit recog)
const OVR_W = {
  QB:[.1, .1, 0, .1, .4, 0, 0, 0, .3], RB:[.25, .2, .15, .2, .2, 0, 0, 0, 0], FB:[.1, .1, .45, .15, .2, 0, 0, 0, 0],
  WR:[.3, .2, .1, .25, .15, 0, 0, 0, 0], TE:[.15, .1, .3, .15, .15, 0, 0, 0, .15], OL:[0, .1, .5, .15, .1, 0, 0, 0, .15],
  DE:[.15, .15, .2, 0, 0, .15, .25, .1, 0], DT:[0, .1, .3, 0, 0, .2, .3, .1, 0],
  LB:[.1, 0, .1, 0, .05, .25, .1, .2, .2], CB:[.3, .2, 0, .25, 0, .1, 0, 0, .15], S:[.2, 0, 0, .15, 0, .2, 0, .2, .25]
};
export const overall = r => { const w = OVR_W[r.pos]; return r.rt ? Math.round(KEYS.reduce((a, k, i) => a + w[i]*r.rt[k], 0)) : 0; };

const NUMS = {QB:[12, 7], RB:[22, 28, 34], FB:[40], WR:[11, 81, 13, 85, 17, 19], TE:[87, 84, 89], OL:[72, 66, 64, 75, 62, 70, 65, 77],
  DE:[91, 95, 97, 92], DT:[90, 93, 96, 98], LB:[54, 58, 52, 50, 56, 55], CB:[24, 21, 26, 23, 29], S:[31, 33, 27, 38]};
const FIRST = 'ABCDEFGHJKLMNPRSTW';
const SURN = ['Walker', 'Brooks', 'Hayes', 'Coleman', 'Dixon', 'Foster', 'Grant', 'Harper', 'Irving', 'Jensen', 'Keller', 'Lawson', 'Mercer', 'Nolan',
  'Osborne', 'Pierce', 'Quinn', 'Reeves', 'Sutton', 'Tanner', 'Underwood', 'Vance', 'Whitman', 'Yates', 'Zimmer', 'Abbott', 'Barlow', 'Carver', 'Drake',
  'Ellison', 'Fischer', 'Gibbs', 'Holt', 'Ingram', 'Jarvis', 'Knox', 'Lowe', 'Moody', 'Neal', 'Odom', 'Pratt', 'Rhodes', 'Stokes', 'Tate', 'Voss', 'Wells', 'Boyd', 'Cobb', 'Dunn', 'Frost'];

function buildTeam(team){
  const recs = []; let n = 0;
  for(const pos of ORDER) for(let i = 0; i < COUNTS[pos]; i++){
    n++;
    const k = n - 1 + (team === 'O' ? 0 : 3);
    recs.push({id:team + String(n).padStart(2, '0'), pid:n, team, unit:UNIT[pos], pos, tpl:TPL[pos] || pos, role:ROLE[pos], num:NUMS[pos][i],
      name:FIRST[(k*7) % FIRST.length] + '. ' + SURN[k % SURN.length], rt:null});
  }
  return recs;
}
export const ROSTER = {O:buildTeam('O'), D:buildTeam('D')};
export const DEPTH = {O:{}, D:{}};   // DEPTH[team][pos] = records best first (overall, ties by roster order)
function depth(){
  for(const t of ['O', 'D']){
    const by = {};
    ROSTER[t].forEach(r => { r.ovr = overall(r); (by[r.pos] || (by[r.pos] = [])).push(r); });
    for(const pos of ORDER) DEPTH[t][pos] = (by[pos] || []).map((r, i) => [r, i]).sort((a, b) => b[0].ovr - a[0].ovr || a[1] - b[1]).map(x => x[0]);
  }
}
depth();
// ratings for all 92 records (the unit decides which legacy aliases a record gets; the team decides the offset), then the depth chart.
// Called at every newGame and every SIM_TEAM_EVERY sim plays; the same records (ids, names, numbers) are re-rated, not replaced.
export function rateRosters(){
  const all = [...ROSTER.O, ...ROSTER.D];
  rateTeams(all);
  all.forEach(r => { if(r.pos === 'FB') r.mass = FB_MASS; });
  depth();
}

// ---------- slots ----------
// bindSlots (players.js) hands over the fixed bodies and the group arrays subIn refills in place:
//   {QB, OL:[LT..RT], TE, RB, flex:[3 bodies], WRs, EXTRA (flex bodies that are FB / 2nd TE), RECV, ROUTE_KEYS, DEF:[11 bodies], DL, LBs, CBs, SFs}
let B = null;
export const bindSlots = s => { B = s; };
const COPY = ['sub', 'tpl', 'spd', 'acc', 'leg', 'brake', 'turn', 'mass', 'rStr', 'rAgi', 'rBrk', 'rPow', 'rSpd', 'rTkl', 'rAwr'];
function put(body, r, role){
  body.rec = r; body.id = r.id; body.name = r.name; body.num = r.num; if(body.setNum) body.setNum(r.num); body.pos = r.pos; body.role = role || r.role;
  body.rt = {...r.rt}; COPY.forEach(k => { body[k] = r[k]; });
}
const refill = (arr, items) => { arr.length = 0; arr.push(...items); };
const WR_KEYS = ['out', 'out', 'slot'];
// Fill the 11 offense and 11 defense bodies from the top of the depth chart. Dead ball only (setupPlay).
export function subIn(offPers = DEFAULT_PERS.off, defPers = DEFAULT_PERS.def){
  const op = PERSONNEL.off[offPers], dp = PERSONNEL.def[defPers];
  if(!op || !dp) throw new Error('unknown personnel ' + offPers + ' / ' + defPers);
  const O = DEPTH.O, D = DEPTH.D;
  put(B.QB, O.QB[0]);
  B.OL.forEach((b, i) => put(b, O.OL[i]));
  put(B.TE, O.TE[0]); put(B.RB, O.RB[0]);
  const wr = O.WR.slice(0, op.WR), extra = [];
  if(op.TE > 1) extra.push(O.TE[1]);
  if(op.FB) extra.push(O.FB[0]);
  const fl = [...wr, ...extra];
  B.flex.forEach((b, i) => put(b, fl[i]));
  refill(B.WRs, B.flex.slice(0, wr.length)); refill(B.EXTRA, B.flex.slice(wr.length));
  refill(B.RECV, [...B.WRs, B.TE, B.RB, ...B.EXTRA]);
  refill(B.ROUTE_KEYS, [...WR_KEYS.slice(0, wr.length), 'te', 'rb', ...B.EXTRA.map(b => b.pos === 'TE' ? 'te' : 'rb')]);
  // defense: DE, DT, DT, DE across four down linemen (left to right as today's DL0..DL3), DE, NT, DE across three
  const dl = dp.DL === 4 ? [D.DE[0], D.DT[0], D.DT[1], D.DE[1]] : [D.DE[0], D.DT[0], D.DE[1]];
  const fill = [...dl, ...D.LB.slice(0, dp.LB), ...D.CB.slice(0, dp.CB), ...D.S.slice(0, dp.S)];
  B.DEF.forEach((b, i) => put(b, fill[i]));
  let k = 0;
  const take = n => B.DEF.slice(k, k += n);
  refill(B.DL, take(dp.DL)); refill(B.LBs, take(dp.LB)); refill(B.CBs, take(dp.CB)); refill(B.SFs, take(dp.S));
  B.pers = {off:offPers, def:defPers};
}
// counts of bodies on the field by pos (the sim prints them)
export function fieldCounts(bodies){
  const o = {}; bodies.forEach(b => { o[b.pos] = (o[b.pos] || 0) + 1; }); return o;
}
