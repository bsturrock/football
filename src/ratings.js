import { rrand, rrand01 } from './util.js';

// ---------- ratings ----------
// Nine physical (KEYS) plus three mental (MENTAL) 0-99 ratings per player, all in p.rt, drawn from a position template.
// Pure: no THREE, node-testable.
// Ratings are absolute across positions (a DT's speed is lower than a CB's); one global curve per rating
// maps them to the physics numbers. B-034: speed and accel are fit so template-mid 40-yard dashes land near the NFL combine averages
// (sim line speed40); leg force (p.leg) keeps the old accel curve so contact and pile strength do not scale with run speed.
export const KEYS = ['speed', 'accel', 'strength', 'agility', 'vision', 'tackling', 'shed', 'pursuit', 'recog'];
// template: r = [lo, hi] per rating in KEYS order; m = [lo, hi] per MENTAL rating; mass = [lo, hi] weight in lb (B-063: each player draws his own, flat ratings too)
// Mental ratings (0-99): how well a player knows each scheme family. Apart from KEYS on purpose: roster OVR_W, sim teamAvg and the
// legacy blend all walk KEYS and must not see them. Read as p.rt.zone / gap / pass.
// Mental ratings deliberately get no team offset (knowledge is the player's own, not a team-strength shift).
export const MENTAL = ['zone', 'gap', 'pass'];
export const TEMPLATES = {
  OL:  {mass:[300,330], r:[[33,53],[45,65],[70,92],[35,55],[45,70],[20,35],[40,60],[30,50],[55,80]], m:[[55,80],[55,80],[55,80]]},
  TE:  {mass:[245,260], r:[[55,72],[55,72],[60,80],[55,72],[50,70],[25,40],[40,60],[35,55],[50,70]], m:[[45,65],[45,65],[40,60]]},
  WR:  {mass:[185,210], r:[[70,92],[68,90],[35,55],[70,90],[55,75],[20,35],[30,45],[35,55],[50,70]], m:[[30,50],[30,50],[30,50]]},
  QB:  {mass:[215,230], r:[[50,70],[45,65],[40,55],[50,65],[60,80],[15,25],[20,35],[20,35],[60,80]], m:[[30,50],[30,50],[30,50]]},
  RBp: {mass:[225,235], r:[[70,85],[70,85],[75,90],[75,90],[60,85],[20,35],[30,45],[30,45],[40,60]], m:[[45,65],[45,65],[35,55]]},   // power back
  RBs: {mass:[195,205], r:[[85,97],[82,95],[50,68],[92,99],[60,85],[20,35],[30,45],[30,45],[40,60]], m:[[45,65],[45,65],[35,55]]},   // speed back
  DE:  {mass:[265,285], r:[[62,82],[65,85],[65,85],[60,78],[50,70],[65,80],[65,85],[60,80],[55,75]], m:[[40,60],[40,60],[40,60]]},
  DT:  {mass:[295,325], r:[[45,62],[50,68],[78,95],[40,60],[45,65],[65,80],[75,92],[50,70],[55,75]], m:[[40,60],[40,60],[40,60]]},
  LBs: {mass:[240,250], r:[[60,75],[60,75],[70,88],[55,70],[60,80],[80,95],[65,85],[65,85],[70,90]], m:[[40,60],[40,60],[40,60]]},   // stuffer
  LBc: {mass:[230,240], r:[[72,88],[72,88],[50,65],[70,85],[60,80],[65,80],[40,60],[70,90],[65,90]], m:[[40,60],[40,60],[40,60]]},   // coverage
  CB:  {mass:[185,200], r:[[80,95],[78,92],[35,55],[72,86],[45,65],[60,78],[25,45],[65,85],[55,80]], m:[[40,60],[40,60],[40,60]]},
  S:   {mass:[195,210], r:[[72,88],[70,86],[50,65],[68,84],[55,75],[70,85],[40,60],[70,85],[65,90]], m:[[40,60],[40,60],[40,60]]}
};
const SPLIT = {RB:['RBp', 'RBs'], LB:['LBs', 'LBc']};   // a player of this template is one of the two, 50/50
export const TEAM_OFFSET = 4;                            // each team's whole roster shifts by -4..+4

// global curves: out = lo + (hi - lo)*(rating/99)^k  (yd/s, yd/s^2, yd/s^2)
// B-060-1: accel is spd/tau (tau 1.0-1.1 s) for the linear fade in movement.js steerVel; BRAKE_K 0.65 gives a 1.5-1.7 s stop from top.
// B-034: speed is the unsprinted top (the gear every non-carrier runs in); accel is the run-up. SPRINT x speed is the carrier's short burst top.
export const SPRINT = 1.035, BRAKE_K = 0.65, BURST_DRAIN = 0.6;   // SPRINT: burst multiplier; BURST_DRAIN: stamina per second of burst (1 s of stamina = 1/0.6 s of burst); both read by carrier.js, BRAKE_K: braking x accel
const LEG_CURVE = [2.75, 7.20, 0.9];   // the pre-B-034 accel curve: leg force p.leg (physics.js, pile.js) from the accel rating
const CURVES = {speed:[3.99, 11.4, 0.54], accel:[6.8, 10.8, 0.72], agility:[5.4, 16.0, 5]};
const curve = (key, v) => { const [lo, hi, k] = CURVES[key]; return lo + (hi - lo)*Math.pow(v/99, k); };
export const legOf = r => LEG_CURVE[0] + (LEG_CURVE[1] - LEG_CURVE[0])*Math.pow(r/99, LEG_CURVE[2]);
export const spdOf = r => curve('speed', r), accOf = r => curve('accel', r), turnOf = r => curve('agility', r);
export const lack = (p, key) => 1 - p.rt[key]/99;

// Legacy aliases (read by physics, blocking, tackling, defense): each is a weighted blend of ratings, mapped linearly from
// its template range onto the range today's per-position roll used, so those modules see the same mean and spread as before.
const ALIAS = {
  rStr: {w:{strength:1}, side:'O', old:{OL:[70,90], TE:[60,80], RB:[55,70], WR:[40,60], QB:[35,45]}},
  rAgi: {w:{agility:1}, side:'O', old:{OL:[55,80], TE:[60,75], RB:[60,75], WR:[60,80], QB:[45,55]}},
  rBrk: {w:{strength:.5, agility:.5}, side:'O', old:{RB:[65,85], TE:[65,80], QB:[40,55], OL:[50,70], WR:[50,70]}},
  rPow: {w:{strength:.5, shed:.5}, side:'D', old:{DE:[60,80], DT:[75,92], LB:[60,75], CB:[40,60], S:[50,65]}},
  rSpd: {w:{speed:.5, agility:.5}, side:'D', old:{DE:[72,90], DT:[55,70], LB:[60,78], CB:[65,85], S:[60,80]}},
  rTkl: {w:{tackling:1}, side:'D', old:{DE:[65,80], DT:[65,80], LB:[75,90], CB:[60,78], S:[70,85]}},
  rAwr: {w:{recog:1}, side:'D', old:{DE:[55,80], DT:[55,80], LB:[65,90], CB:[55,80], S:[65,90]}}
};
const blend = (w, r) => KEYS.reduce((a, k, i) => a + (w[k] || 0)*r[i], 0);
function legacy(p){
  for(const [name, A] of Object.entries(ALIAS)){
    if(A.side !== (p.unit || p.team)) continue;   // a roster record: his unit (offense or defense), his team only offsets
    const subs = SPLIT[p.tpl] || [p.tpl], old = A.old[p.tpl];
    const lo = subs.reduce((a, t) => a + blend(A.w, TEMPLATES[t].r.map(x => x[0])), 0)/subs.length;
    const hi = subs.reduce((a, t) => a + blend(A.w, TEMPLATES[t].r.map(x => x[1])), 0)/subs.length;
    const d = blend(A.w, KEYS.map(k => p.rt[k]));
    const v = old[0] + (d - lo)/(hi - lo)*(old[1] - old[0]);
    p[name] = flat ? Math.max(0, Math.min(99, v)) : clamp99(v);
  }
}

// FLAT_RATINGS: every player gets his position's template midpoint (split templates pooled), team shift 0, and his own weight drawn from the template range (B-063),
// so results come from mechanics (user L-1006-093). `?ratings=on` (page or sim) or setFlatRatings(false) rolls ratings as before.
export const FLAT_RATINGS = true;
let flat = FLAT_RATINGS && !(typeof location !== 'undefined' && /[?&]ratings=on\b/.test(location.search));
export const setFlatRatings = v => { flat = !!v; };
const mid = (subs, i) => subs.reduce((a, t) => a + (TEMPLATES[t].r[i][0] + TEMPLATES[t].r[i][1])/2, 0)/subs.length;
const midM = (subs, i) => subs.reduce((a, t) => a + (TEMPLATES[t].m[i][0] + TEMPLATES[t].m[i][1])/2, 0)/subs.length;
function rateFlat(p){
  const subs = SPLIT[p.tpl] || [p.tpl];
  p.sub = subs[0];
  p.rt = {}; KEYS.forEach((k, i) => p.rt[k] = mid(subs, i));
  const r = p.rt;
  p.spd = spdOf(r.speed); p.acc = accOf(r.accel); p.leg = legOf(r.accel); p.brake = p.acc*BRAKE_K; p.turn = turnOf(r.agility);
  MENTAL.forEach((k, i) => p.rt[k] = midM(subs, i));
  legacy(p);
  p.mass = rrand(Math.min(...subs.map(t => TEMPLATES[t].mass[0])), Math.max(...subs.map(t => TEMPLATES[t].mass[1])));   // B-063: his own weight, drawn after everything else (a split template pools both ranges)
}

const clamp99 = v => Math.max(0, Math.min(99, Math.round(v)));
// players: [{team:'O'|'D', tpl:'OL'|'TE'|'WR'|'QB'|'RB'|'DE'|'DT'|'LB'|'CB'|'S'}]; draws from Math.random via util rrand (B-091: the ratings stream)
export function rateTeams(players){
  if(flat){ players.forEach(rateFlat); return; }
  const off = {O:Math.round(rrand(-TEAM_OFFSET, TEAM_OFFSET)), D:Math.round(rrand(-TEAM_OFFSET, TEAM_OFFSET))};
  players.forEach(p => {
    const sub = SPLIT[p.tpl] ? SPLIT[p.tpl][rrand01() < 0.5 ? 0 : 1] : p.tpl, t = TEMPLATES[sub];
    p.sub = sub;
    p.rt = {}; KEYS.forEach((k, i) => p.rt[k] = clamp99(rrand(t.r[i][0], t.r[i][1]) + off[p.team]));
    const r = p.rt;
    p.spd = spdOf(r.speed); p.acc = accOf(r.accel); p.leg = legOf(r.accel); p.brake = p.acc*BRAKE_K; p.turn = turnOf(r.agility);
    p.mass = rrand(t.mass[0], t.mass[1]);   // B-063: his own weight from the template range (one draw, as before)
    MENTAL.forEach((k, i) => p.rt[k] = clamp99(rrand(t.m[i][0], t.m[i][1])));   // after every other draw for this player
    legacy(p);
  });
}
