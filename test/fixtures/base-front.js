// Base-front (4-3 Base) outcome pins shared by tests. When the base roster changes, update the values here.

export const POSITION_COUNT = 13;
// sorted
export const DEFENSE_IDS = ['LDE', 'LDT', 'MLB', 'RDE', 'RDT', 'WLB'];
export const ROLES = {
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', QB: 'QB', RB: 'RB',
  LDE: 'DE', LDT: 'DT', RDT: 'DT', RDE: 'DE', MLB: 'LB', WLB: 'LB',
};
// sorted ids of every role 'LB' row in POSITIONS (the base LBs)
export const BASE_LB_IDS = ['MLB', 'WLB'];
// def.read per base LB row
export const LB_READ = { MLB: 0.35, WLB: 0.5 };
// inside-zone `free` per roster front (zonePlan / runScheme with IZ rules), in produced order
export const IZ_FREE = { base: ['LDE'], dlPlus4: ['LDE'], dlMinus4: ['WLB'], lbMinus6: ['LDE'] };
// insideZone after 6x shiftLB(-1): the LB the RT/RG combo watches, and the sim time (s) RG/RT first targets him
export const LB_MINUS6_RG_WATCH = 'MLB';
export const LB_MINUS6_RG_TAKEN_AT = 0.350;
// createPlay(25, 'insideZone').numbers: unshifted, after 6x shiftLB(-1), after 4x shiftDL(1)
export const IZ_NUMBERS = {
  base: { LT: 2, LG: 1, C: 0, RG: -1, RT: -2, QB: null, RB: null, LDE: -3, LDT: -1, RDT: 0, RDE: 2, MLB: -2, WLB: 1 },
  lbMinus6: { LT: 2, LG: 1, C: 0, RG: -1, RT: -2, QB: null, RB: null, MLB: 0, RDT: 1, RDE: 2, WLB: 3, LDT: -1, LDE: -2 },
  dlPlus4: { LT: 2, LG: 1, C: 0, RG: -1, RT: -2, QB: null, RB: null, WLB: 0, RDE: 1, RDT: -1, MLB: -2, LDT: -3, LDE: -4 },
};
