import { rand } from './util.js';

// ---------- ratings ----------
// Nine 0-99 ratings per player (p.rt), drawn from a position template. Pure: no THREE, node-testable.
// Ratings are absolute across positions (a DT's speed is lower than a CB's); one global curve per rating
// maps them to the physics numbers, calibrated so template midpoints land near the old per-position values.
export const KEYS = ['speed', 'accel', 'strength', 'agility', 'vision', 'tackling', 'shed', 'pursuit', 'recog'];
// template: [lo, hi] per rating in KEYS order; mass in lb
export const TEMPLATES = {
  OL:  {mass:310, r:[[40,60],[45,65],[70,92],[35,55],[45,70],[20,35],[40,60],[30,50],[55,80]]},
  TE:  {mass:250, r:[[55,72],[55,72],[60,80],[55,72],[50,70],[25,40],[40,60],[35,55],[50,70]]},
  WR:  {mass:195, r:[[70,92],[68,90],[35,55],[70,90],[55,75],[20,35],[30,45],[35,55],[50,70]]},
  QB:  {mass:220, r:[[50,70],[45,65],[40,55],[50,65],[60,80],[15,25],[20,35],[20,35],[60,80]]},
  RBp: {mass:215, r:[[70,85],[70,85],[75,90],[75,90],[60,85],[20,35],[30,45],[30,45],[40,60]]},   // power back
  RBs: {mass:215, r:[[85,97],[82,95],[50,68],[92,99],[60,85],[20,35],[30,45],[30,45],[40,60]]},   // speed back
  DE:  {mass:270, r:[[62,82],[65,85],[65,85],[60,78],[50,70],[65,80],[65,85],[60,80],[55,75]]},
  DT:  {mass:305, r:[[45,62],[50,68],[78,95],[40,60],[45,65],[65,80],[75,92],[50,70],[55,75]]},
  LBs: {mass:240, r:[[60,75],[60,75],[70,88],[55,70],[60,80],[80,95],[65,85],[65,85],[70,90]]},   // stuffer
  LBc: {mass:240, r:[[72,88],[72,88],[50,65],[70,85],[60,80],[65,80],[40,60],[70,90],[65,90]]},   // coverage
  CB:  {mass:195, r:[[80,95],[78,92],[35,55],[72,86],[45,65],[60,78],[25,45],[65,85],[55,80]]},
  S:   {mass:205, r:[[72,88],[70,86],[50,65],[68,84],[55,75],[70,85],[40,60],[70,85],[65,90]]}
};
const SPLIT = {RB:['RBp', 'RBs'], LB:['LBs', 'LBc']};   // a player of this template is one of the two, 50/50
export const TEAM_OFFSET = 4;                            // each team's whole roster shifts by -4..+4

// global curves: out = lo + (hi - lo)*(rating/99)^k  (yd/s, yd/s^2, yd/s^2)
const CURVES = {speed:[6.12, 8.70, 3.9], accel:[2.75, 7.20, 0.9], agility:[5.4, 16.0, 5]};
const curve = (key, v) => { const [lo, hi, k] = CURVES[key]; return lo + (hi - lo)*Math.pow(v/99, k); };
export const spdOf = r => curve('speed', r), accOf = r => curve('accel', r), turnOf = r => curve('agility', r);
export const lack = (p, key) => 1 - p.rt[key]/99;

const clamp99 = v => Math.max(0, Math.min(99, Math.round(v)));
// players: [{team:'O'|'D', tpl:'OL'|'TE'|'WR'|'QB'|'RB'|'DE'|'DT'|'LB'|'CB'|'S'}]; draws from Math.random via util rand
export function rateTeams(players){
  const off = {O:Math.round(rand(-TEAM_OFFSET, TEAM_OFFSET)), D:Math.round(rand(-TEAM_OFFSET, TEAM_OFFSET))};
  players.forEach(p => {
    const sub = SPLIT[p.tpl] ? SPLIT[p.tpl][Math.random() < 0.5 ? 0 : 1] : p.tpl, t = TEMPLATES[sub];
    p.sub = sub;
    p.rt = {}; KEYS.forEach((k, i) => p.rt[k] = clamp99(rand(t.r[i][0], t.r[i][1]) + off[p.team]));
    const r = p.rt;
    p.spd = spdOf(r.speed); p.acc = accOf(r.accel); p.brake = p.acc*1.5; p.turn = turnOf(r.agility);
    p.mass = t.mass*rand(0.95, 1.05);
    // old fields, derived so physics / blocking / tackling / defense keep working unchanged
    if(p.team === 'O'){ p.rStr = r.strength; p.rAgi = r.agility; p.rBrk = (r.strength + r.agility)/2; }
    else { p.rPow = (r.strength + r.shed)/2; p.rSpd = (r.speed + r.agility)/2; p.rTkl = r.tackling; p.rAwr = r.recog; }
  });
}
