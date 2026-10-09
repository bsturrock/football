// Dots view roster: pure data and functions. No imports, no DOM, no THREE.
//
// Coordinates match the 3D game: x = lateral yards from field center
// (negative = offense's left as it faces downfield), y = yard line
// (0 = offense's own goal, 100 = opponent goal). Offense attacks toward +y.
// dy = yards from the line of scrimmage (negative = offense backfield,
// positive = defense side).

const pos = (id, name, team, role, dx, dy, speed, strength) =>
  Object.freeze({ id, name, team, role, dx, dy, speed, strength });

// Ratings per position. speed is yd/s of short-area play speed (about 80% of the
// 40-yard-dash average; no acceleration model). strength is unitless force used by
// blocking: OL must stay above every defender's strength / 0.7071 so the OL win at
// any block angle.
export const POSITIONS = Object.freeze([
  // OL: linemen 1.5 yd center to center (0.8 yd = 2.4 ft body-to-body, NFL 2-3 ft).
  // C just behind the ball, guards about 1 ft deeper, tackles 0.15 yd deeper than guards.
  pos('LT', 'Left Tackle', 'offense', 'OL', -3.0, -0.9, 6.0, 1.0),
  pos('LG', 'Left Guard', 'offense', 'OL', -1.5, -0.75, 6.0, 1.0),
  pos('C', 'Center', 'offense', 'OL', 0, -0.4, 6.0, 1.0),
  pos('RG', 'Right Guard', 'offense', 'OL', 1.5, -0.75, 6.0, 1.0),
  pos('RT', 'Right Tackle', 'offense', 'OL', 3.0, -0.9, 6.0, 1.0),
  pos('QB', 'Quarterback', 'offense', 'QB', 0, -4.5, 7.0, 0.3),
  pos('RB', 'Running Back', 'offense', 'RB', 1.8, -4.5, 8.0, 0.5),
  // Defense faces -y, so its left is +x.
  // DL just across a ball-length neutral zone (0.7 yd): DTs in an inside shade of the
  // guards, DEs in an outside shade of the tackles.
  pos('LDE', 'Left Defensive End', 'defense', 'DE', 3.6, 0.7, 7.0, 0.5),
  pos('LDT', 'Left Defensive Tackle', 'defense', 'DT', 1.2, 0.7, 6.5, 0.6),
  pos('RDT', 'Right Defensive Tackle', 'defense', 'DT', -1.2, 0.7, 6.5, 0.6),
  pos('RDE', 'Right Defensive End', 'defense', 'DE', -3.6, 0.7, 7.0, 0.5),
  // LBs at 4.5 yd, an NFL off-ball depth.
  pos('MLB', 'Middle Linebacker', 'defense', 'LB', 1.6, 4.5, 7.5, 0.5),
  pos('WLB', 'Weakside Linebacker', 'defense', 'LB', -1.6, 4.5, 7.5, 0.5),
]);

// Defensive fronts. Defender rows use the same dx/dy convention as POSITIONS; non-base
// fronts are written for a playside-left play (the only play today).
const roleRating = (role) => {
  const row = POSITIONS.find((p) => p.team === 'defense' && p.role === role);
  return { speed: row.speed, strength: row.strength };
};
const NAMES = Object.freeze({
  PE: 'Playside End', BE: 'Backside End', PT: 'Playside Tackle', BT: 'Backside Tackle',
  PN: 'Playside Nose', N: 'Nose Tackle', P3: 'Playside 3-Technique', B3: 'Backside 3-Technique',
  SAM: 'Sam Linebacker', MIK: 'Mike Linebacker', WIL: 'Will Linebacker',
  L1: 'Linebacker 1', L2: 'Linebacker 2', L3: 'Linebacker 3',
  PO: 'Playside Outside Linebacker', BO: 'Backside Outside Linebacker',
  PI: 'Playside Inside Linebacker', BI: 'Backside Inside Linebacker',
});
// rows: [id, role, dx, dy]
const defenders = (rows) => Object.freeze(rows.map(([id, role, dx, dy]) => {
  const r = roleRating(role);
  return pos(id, NAMES[id], 'defense', role, dx, dy, r.speed, r.strength);
}));
const swap = (rows, id, dx, dy) => rows.map((r) => (r[0] === id ? [r[0], r[1], dx, dy] : r));

const OVER43 = [
  ['PE', 'DE', -3.6, 0.7], ['PT', 'DT', -1.9, 0.7], ['BT', 'DT', 0.5, 0.7], ['BE', 'DE', 3.6, 0.7],
  ['SAM', 'LB', -3.0, 4.5], ['MIK', 'LB', -0.5, 4.5], ['WIL', 'LB', 2.0, 4.5],
];
const UNDER43 = [
  ['PE', 'DE', -3.6, 0.7], ['PN', 'DT', -0.5, 0.7], ['BT', 'DT', 1.9, 0.7], ['BE', 'DE', 3.6, 0.7],
  ['L1', 'LB', -2.4, 4.5], ['L2', 'LB', 0.6, 4.5], ['L3', 'LB', 3.0, 4.5],
];

export const FRONTS = Object.freeze({
  base: Object.freeze({
    name: '4-3 Base',
    defenders: Object.freeze(POSITIONS.filter((p) => p.team === 'defense')),
  }),
  over43: Object.freeze({ name: '4-3 Over', defenders: defenders(OVER43) }),
  under43: Object.freeze({ name: '4-3 Under', defenders: defenders(UNDER43) }),
  odd34: Object.freeze({
    name: '3-4',
    defenders: defenders([
      ['PO', 'LB', -5.0, 1.0], ['PE', 'DE', -3.6, 0.7], ['N', 'DT', 0, 0.7], ['BE', 'DE', 3.6, 0.7],
      ['BO', 'LB', 5.0, 1.0], ['PI', 'LB', -1.4, 4.5], ['BI', 'LB', 1.4, 4.5],
    ]),
  }),
  bear: Object.freeze({
    name: 'Bear',
    defenders: defenders([
      ['PE', 'DE', -4.4, 0.7], ['P3', 'DT', -1.9, 0.7], ['N', 'DT', 0, 0.7], ['B3', 'DT', 1.9, 0.7],
      ['BE', 'DE', 4.4, 0.7], ['L1', 'LB', -1.4, 4.5], ['L2', 'LB', 2.0, 4.5],
    ]),
  }),
  walkedUp: Object.freeze({
    name: '4-3 Over, Sam Walked Up',
    defenders: defenders(swap(OVER43, 'SAM', -4.6, 1.5)),
  }),
  backedOff: Object.freeze({
    name: '4-3 Under, 3-Tech Backed Off',
    defenders: defenders(swap(UNDER43, 'BT', 1.9, 2.5)),
  }),
});

// Play definitions. Shapes:
//   ball: { start, snapTo } where start is the position id holding the ball
//         pre-snap and snapTo is the position id that receives the snap.
//   assignments: { [positionId]: { goal, target } } holds per-position goals
//         and targets. Empty for the base play; later plays add entries here.
export const PLAYS = Object.freeze({
  base: Object.freeze({
    name: 'Base',
    ball: Object.freeze({ start: 'C', snapTo: 'QB' }),
    assignments: Object.freeze({}),
  }),
  // playside ('left' = -x, 'right' = +x) drives zone numbering. Later variants are new entries.
  insideZone: Object.freeze({
    name: 'Inside Zone',
    ball: Object.freeze({ start: 'C', snapTo: 'QB' }),
    assignments: Object.freeze({}),
    playside: 'left',
    scheme: 'zone', // names the blocking scheme play.js applies at the snap
    run: Object.freeze({ carrier: 'RB' }), // run: { carrier } = who takes the handoff; read order is fixed in carrier.js
  }),
});

export function emptyAssignment() {
  return { goal: null, target: null };
}

// Roles that make up the defensive line. buildLineup shifts only these.
export const DL_ROLES = Object.freeze(['DE', 'DT']);
export const LB_ROLES = Object.freeze(['LB']);

// front picks a key of FRONTS for the defense. dlShift is a lateral offset in yards
// added to x of every DL player; lbShift does the same for LBs.
export function buildLineup(los, playKey = 'base', { front = 'base', dlShift = 0, lbShift = 0 } = {}) {
  const play = PLAYS[playKey];
  if (!play) throw new Error(`buildLineup: unknown play "${playKey}"`);
  if (!Object.hasOwn(FRONTS, front)) throw new Error(`buildLineup: unknown front "${front}"`);
  const rows = [...POSITIONS.filter((p) => p.team === 'offense'), ...FRONTS[front].defenders];
  return rows.map((p) => {
    const a = play.assignments[p.id];
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      role: p.role,
      x: p.dx + (DL_ROLES.includes(p.role) ? dlShift : 0) + (LB_ROLES.includes(p.role) ? lbShift : 0),
      y: los + p.dy,
      speed: p.speed,
      strength: p.strength,
      assignment: a ? { ...a } : emptyAssignment(),
    };
  });
}
