// Shared pre-snap fronts for tests. Playside is left (-x).
import { buildLineup, FRONTS } from '../../src/dots/roster.js';
import { DL_SHIFT_STEP, LB_SHIFT_STEP } from '../../src/dots/play.js';
import { numberPlay } from '../../src/dots/numbering.js';

export const LOS = 25;

const ROSTER_FRONTS = {
  base: {},
  dlPlus4: { dlShift: 4 * DL_SHIFT_STEP },
  dlMinus4: { dlShift: -4 * DL_SHIFT_STEP },
  lbPlus6: { lbShift: 6 * LB_SHIFT_STEP },
  lbMinus6: { lbShift: -6 * LB_SHIFT_STEP },
};

export const FRONT_NAMES = Object.freeze([...Object.keys(ROSTER_FRONTS), ...Object.keys(FRONTS).filter((k) => k !== 'base')]);

export function frontPlayers(name) {
  if (name in ROSTER_FRONTS) return buildLineup(LOS, 'insideZone', ROSTER_FRONTS[name]);
  if (Object.hasOwn(FRONTS, name)) return buildLineup(LOS, 'insideZone', { front: name });
  throw new Error(`frontPlayers: unknown front ${name}`);
}

export function frontNumbers(players) {
  return numberPlay(players, { los: LOS, centerId: 'C', playside: 'left' });
}
