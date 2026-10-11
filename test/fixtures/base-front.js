// Base-front (4-3 Base) outcome pins shared by tests. When the base roster changes, update the values here.

export const POSITION_COUNT = 14;
// sorted
export const DEFENSE_IDS = ['LDE', 'LDT', 'MLB', 'RDE', 'RDT', 'SLB', 'WLB'];
export const ROLES = {
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', QB: 'QB', RB: 'RB',
  LDE: 'DE', LDT: 'DT', RDT: 'DT', RDE: 'DE', MLB: 'LB', WLB: 'LB', SLB: 'LB',
};
// sorted ids of every role 'LB' row in POSITIONS (the base LBs)
export const BASE_LB_IDS = ['MLB', 'SLB', 'WLB'];
// def.read per base LB row
export const LB_READ = { MLB: 0.35, WLB: 0.5, SLB: 0.5 };
// inside-zone `free` per roster front for the IZ table WITHOUT the spare row (assign.test.js local table), in produced order
export const IZ_FREE = { base: ['MLB', 'SLB'], dlPlus4: ['SLB', 'LDE'], dlMinus4: ['WLB', 'SLB'], lbMinus6: ['WLB', 'SLB'] };
// insideZone after 6x shiftLB(-1): the LB the RT/RG combo watches
export const LB_MINUS6_RG_WATCH = 'SLB';
// createPlay(25, 'insideZone').numbers (the lineup includes the attached TE, PLAYS.insideZone.personnel):
// unshifted, after 6x shiftLB(-1), after 4x shiftDL(1)
export const IZ_NUMBERS = {
  base: { LT: 2, LG: 1, C: 0, RG: -1, RT: -2, QB: null, RB: null, TE: -3, LDE: -3, LDT: -1, RDT: 0, RDE: 2, MLB: -2, WLB: 1, SLB: -4 },
  lbMinus6: { LT: 2, LG: 1, C: 0, RG: -1, RT: -2, QB: null, RB: null, TE: -3, MLB: 0, RDT: 1, RDE: 2, WLB: 3, LDT: -1, LDE: -3, SLB: -2 },
  dlPlus4: { LT: 2, LG: 1, C: 0, RG: -1, RT: -2, QB: null, RB: null, TE: -3, WLB: 0, RDE: 1, RDT: -1, MLB: -2, LDT: -3, LDE: -5, SLB: -4 },
};
// readFront(...).covered for the listed linemen, base front, noTe, playside left
// F-54 #1: the RDT is a 2i on LG (inside shoulder), so he covers the C, not LG
export const BASE_COVERED = { LT: ['RDE'], LG: [], C: ['RDT'], RG: ['LDT'] };

const T = (tech, shade, watch = null) => ({ tech, shade, watch });
const A = (how, ...by) => ({ how, by });
const ACE_LG_C = { name: 'ace', owner: 'LG', partner: 'C' };
// F-54 #1: the RDT covers C (2i on LG), so LG is the uncovered owner of the ace and C takes the playside shade
const NO_TE_BASE = {
  blocks: { LT: 'RDE', LG: 'RDT', C: 'RDT', RG: 'LDT', RT: 'LDE' },
  combos: [{ owner: 'LG', partner: 'C', target: 'RDT', watch: 'WLB' }],
  techs: {
    LT: T('zone', 'playside'), LG: T('combo', 'none', 'WLB'), C: T('combo', 'playside', 'WLB'),
    RG: T('zone', 'playside'), RT: T('cutoff', 'backside'),
  },
  free: ['MLB', 'SLB'],
  mike: 'WLB',
  pairs: [ACE_LG_C],
  accounted: {
    RDE: A('block', 'LT'), RDT: A('block', 'LG', 'C'), WLB: A('watch', 'LG', 'C'), LDT: A('block', 'RG'),
    LDE: A('block', 'RT'), MLB: A('free'), SLB: A('free'),
  },
};
// F-54 #3: RDE sits outside LG, toward the uncovered LT, so LT + LG deuce him (LT used to climb); RG + C ace the RDT
const NO_TE_DL_PLUS4 = {
  blocks: { LT: 'RDE', LG: 'RDE', C: 'RDT', RG: 'RDT', RT: 'LDT' },
  combos: [
    { owner: 'RG', partner: 'C', target: 'RDT', watch: 'MLB' },
    { owner: 'LT', partner: 'LG', target: 'RDE', watch: 'WLB' },
  ],
  techs: {
    LT: T('combo', 'none', 'WLB'), LG: T('combo', 'playside', 'WLB'), C: T('combo', 'head', 'MLB'),
    RG: T('combo', 'none', 'MLB'), RT: T('cutoff', 'playside'),
  },
  free: ['SLB', 'LDE'],
  mike: 'WLB',
  pairs: [{ name: 'ace', owner: 'RG', partner: 'C' }, { name: 'deuce', owner: 'LT', partner: 'LG' }],
  accounted: {
    RDE: A('block', 'LT', 'LG'), WLB: A('watch', 'LT', 'LG'), RDT: A('block', 'C', 'RG'), MLB: A('watch', 'RG', 'C'),
    LDT: A('block', 'RT'), SLB: A('free'), LDE: A('free'),
  },
};
// F-54 #3: the LDT sits on RG's playside shoulder (toward the C), away from RT, so RG blocks him alone and RT climbs (was an RT/RG combo on the LDT)
// F-54 #1: same LG/C ace as the noTe base, owned by LG
// F-54 #5 / R-5: the TE blocks the backside end LDE (he used to climb to SLB and leave the end)
const TE_BASE = {
  blocks: { LT: 'RDE', LG: 'RDT', C: 'RDT', RG: 'LDT', RT: 'MLB', TE: 'LDE' },
  combos: [
    { owner: 'LG', partner: 'C', target: 'RDT', watch: 'WLB' },
  ],
  techs: {
    LT: T('zone', 'playside'), LG: T('combo', 'none', 'WLB'), C: T('combo', 'playside', 'WLB'),
    RG: T('zone', 'playside'), RT: T('climb', 'none'), TE: T('cutoff', 'playside'),
  },
  free: ['SLB'],
  mike: 'WLB',
  pairs: [ACE_LG_C],
  accounted: {
    RDE: A('block', 'LT'), WLB: A('watch', 'LG', 'C'), RDT: A('block', 'LG', 'C'), LDT: A('block', 'RG'),
    MLB: A('block', 'RT'), LDE: A('block', 'TE'), SLB: A('free'),
  },
};
// F-54 #3: same LT + LG deuce on the RDE as the noTe plan
// F-54 #5: the TE blocks LDE (head-up), so SLB is the only free man
const TE_DL_PLUS4 = {
  blocks: { LT: 'RDE', LG: 'RDE', C: 'RDT', RG: 'RDT', RT: 'LDT', TE: 'LDE' },
  combos: [
    { owner: 'RG', partner: 'C', target: 'RDT', watch: 'MLB' },
    { owner: 'LT', partner: 'LG', target: 'RDE', watch: 'WLB' },
  ],
  techs: {
    LT: T('combo', 'none', 'WLB'), LG: T('combo', 'playside', 'WLB'), C: T('combo', 'head', 'MLB'),
    RG: T('combo', 'none', 'MLB'), RT: T('zone', 'playside'), TE: T('cutoff', 'head'),
  },
  free: ['SLB'],
  mike: 'WLB',
  pairs: [{ name: 'ace', owner: 'RG', partner: 'C' }, { name: 'deuce', owner: 'LT', partner: 'LG' }],
  accounted: {
    RDE: A('block', 'LT', 'LG'), WLB: A('watch', 'LT', 'LG'), RDT: A('block', 'C', 'RG'), MLB: A('watch', 'RG', 'C'),
    LDT: A('block', 'RT'), LDE: A('block', 'TE'), SLB: A('free'),
  },
};
// zonePlan output without `front` per personnel and roster front shift, playside left
export const IZ_PLAN_PINS = {
  noTe: { base: NO_TE_BASE, lbPlus6: NO_TE_BASE, dlPlus4: NO_TE_DL_PLUS4 },
  te: { base: TE_BASE, lbPlus6: TE_BASE, dlPlus4: TE_DL_PLUS4 },
};
