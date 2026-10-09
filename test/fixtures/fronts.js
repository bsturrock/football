// Shared pre-snap fronts for tests. Playside is left (-x).
import { buildLineup, emptyAssignment } from '../../src/dots/roster.js';
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

const over43 = [
  ['PE', 'DE', -3.6, 0.7], ['PT', 'DT', -1.9, 0.7], ['BT', 'DT', 0.5, 0.7], ['BE', 'DE', 3.6, 0.7],
  ['SAM', 'LB', -3.0, 4.5], ['MIK', 'LB', -0.5, 4.5], ['WIL', 'LB', 2.0, 4.5],
];
const under43 = [
  ['PE', 'DE', -3.6, 0.7], ['PN', 'DT', -0.5, 0.7], ['BT', 'DT', 1.9, 0.7], ['BE', 'DE', 3.6, 0.7],
  ['L1', 'LB', -2.4, 4.5], ['L2', 'LB', 0.6, 4.5], ['L3', 'LB', 3.0, 4.5],
];
const swap = (rows, id, x, dy) => rows.map((r) => (r[0] === id ? [r[0], r[1], x, dy] : r));

const FIXTURE_FRONTS = {
  over43,
  under43,
  odd34: [
    ['PO', 'LB', -5.0, 1.0], ['PE', 'DE', -3.6, 0.7], ['N', 'DT', 0, 0.7], ['BE', 'DE', 3.6, 0.7],
    ['BO', 'LB', 5.0, 1.0], ['PI', 'LB', -1.4, 4.5], ['BI', 'LB', 1.4, 4.5],
  ],
  bear: [
    ['PE', 'DE', -4.4, 0.7], ['P3', 'DT', -1.9, 0.7], ['N', 'DT', 0, 0.7], ['B3', 'DT', 1.9, 0.7],
    ['BE', 'DE', 4.4, 0.7], ['L1', 'LB', -1.4, 4.5], ['L2', 'LB', 2.0, 4.5],
  ],
  walkedUp: swap(over43, 'SAM', -4.6, 1.5),
  backedOff: swap(under43, 'BT', 1.9, 2.5),
};

export const FRONT_NAMES = Object.freeze([...Object.keys(ROSTER_FRONTS), ...Object.keys(FIXTURE_FRONTS)]);

export function frontPlayers(name) {
  if (name in ROSTER_FRONTS) return buildLineup(LOS, 'insideZone', ROSTER_FRONTS[name]);
  const rows = FIXTURE_FRONTS[name];
  if (!rows) throw new Error(`frontPlayers: unknown front ${name}`);
  const offense = buildLineup(LOS, 'insideZone').filter((p) => p.team === 'offense');
  const defense = rows.map(([id, role, x, dy]) => ({
    id, name: id, team: 'defense', role, x, y: LOS + dy, speed: 7, strength: 0.5, assignment: emptyAssignment(),
  }));
  return [...offense, ...defense];
}

export function frontNumbers(players) {
  return numberPlay(players, { los: LOS, centerId: 'C', playside: 'left' });
}
