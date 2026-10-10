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
// inside-zone `free` per roster front (zonePlan / runScheme with IZ rules), in produced order
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
export const BASE_COVERED = { LT: ['RDE'], LG: ['RDT'], C: [], RG: ['LDT'] };

const T = (tech, shade, watch = null) => ({ tech, shade, watch });
const NO_TE_BASE = {
  blocks: { LT: 'RDE', LG: 'RDT', C: 'RDT', RG: 'LDT', RT: 'LDE' },
  combos: [{ owner: 'C', partner: 'LG', target: 'RDT', watch: 'WLB' }],
  techs: {
    LT: T('zone', 'playside'), LG: T('combo', 'backside', 'WLB'), C: T('combo', 'none', 'WLB'),
    RG: T('zone', 'playside'), RT: T('cutoff', 'backside'),
  },
  free: ['MLB', 'SLB'],
};
const NO_TE_DL_PLUS4 = {
  blocks: { LT: 'WLB', LG: 'RDE', C: 'RDT', RG: 'RDT', RT: 'LDT' },
  combos: [{ owner: 'RG', partner: 'C', target: 'RDT', watch: 'MLB' }],
  techs: {
    LT: T('climb', 'none'), LG: T('zone', 'playside'), C: T('combo', 'head', 'MLB'),
    RG: T('combo', 'none', 'MLB'), RT: T('cutoff', 'playside'),
  },
  free: ['SLB', 'LDE'],
};
const TE_BASE = {
  blocks: { LT: 'RDE', LG: 'RDT', C: 'RDT', RG: 'LDT', RT: 'LDT', TE: 'LDE' },
  combos: [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
    { owner: 'C', partner: 'LG', target: 'RDT', watch: 'WLB' },
  ],
  techs: {
    LT: T('zone', 'playside'), LG: T('combo', 'backside', 'WLB'), C: T('combo', 'none', 'WLB'),
    RG: T('combo', 'playside', 'MLB'), RT: T('combo', 'none', 'MLB'), TE: T('cutoff', 'playside'),
  },
  free: ['SLB'],
};
const TE_DL_PLUS4 = {
  blocks: { LT: 'WLB', LG: 'RDE', C: 'RDT', RG: 'RDT', RT: 'LDT', TE: 'LDE' },
  combos: [{ owner: 'RG', partner: 'C', target: 'RDT', watch: 'MLB' }],
  techs: {
    LT: T('climb', 'none'), LG: T('zone', 'playside'), C: T('combo', 'head', 'MLB'),
    RG: T('combo', 'none', 'MLB'), RT: T('zone', 'playside'), TE: T('cutoff', 'head'),
  },
  free: ['SLB'],
};
// zonePlan output without `front` per personnel and roster front shift, playside left
export const IZ_PLAN_PINS = {
  noTe: { base: NO_TE_BASE, lbPlus6: NO_TE_BASE, dlPlus4: NO_TE_DL_PLUS4 },
  te: { base: TE_BASE, lbPlus6: TE_BASE, dlPlus4: TE_DL_PLUS4 },
};
