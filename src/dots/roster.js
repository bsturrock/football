// Dots view roster: pure data and functions. No imports, no DOM, no THREE.
//
// Coordinates match the 3D game: x = lateral yards from field center
// (negative = offense's left as it faces downfield), y = yard line
// (0 = offense's own goal, 100 = opponent goal). Offense attacks toward +y.
// dy = yards from the line of scrimmage (negative = offense backfield,
// positive = defense side).

// Ball and neutral zone, yd. The ball's rear tip is on the LOS (y = los), its front tip at
// los + BALL_LENGTH; the offense lines up behind the rear tip, the defense beyond the front tip.
export const BALL_LENGTH = 11 / 36; // 11 in ball = neutral zone width
export const BALL_WIDTH = 6.7 / 36;

// def is an optional per-defender behaviour object. def.read = seconds after the snap
// before this defender can recognise run (per-player tunable, 0.3-0.6); a missing
// def.read falls back to READ_TIME in defense.js.
const pos = (id, name, team, role, dx, dy, speed, strength, def) =>
  Object.freeze({ id, name, team, role, dx, dy, speed, strength, def: def ? Object.freeze({ ...def }) : null });

// Ratings per position. speed is yd/s of short-area play speed (about 80% of the
// 40-yard-dash average); steering.js's ACCEL_TAU ramp models the start from rest.
// strength is unitless force used by blocking: OL must stay above every defender's
// strength / 0.7071 so the OL win at any block angle.
export const POSITIONS = Object.freeze([
  // OL: linemen 1.2 yd center to center (body-to-body split 0.64 yd, about 1.9 ft, inside
  // the standard 1-2 ft). C's front edge sits on the ball's rear tip (dy = -BODY_RADIUS);
  // guards about 1 ft deeper, tackles 0.15 yd deeper still.
  pos('LT', 'Left Tackle', 'offense', 'OL', -2.4, -0.75, 6.0, 1.0),
  pos('LG', 'Left Guard', 'offense', 'OL', -1.2, -0.6, 6.0, 1.0),
  pos('C', 'Center', 'offense', 'OL', 0, -0.28, 6.0, 1.0),
  pos('RG', 'Right Guard', 'offense', 'OL', 1.2, -0.6, 6.0, 1.0),
  pos('RT', 'Right Tackle', 'offense', 'OL', 2.4, -0.75, 6.0, 1.0),
  // QB 5 yd behind the center (shotgun 5-7 yd); RB level with him, about 3 ft of daylight to his side.
  pos('QB', 'Quarterback', 'offense', 'QB', 0, -5.3, 7.0, 0.3),
  pos('RB', 'Running Back', 'offense', 'RB', 1.6, -5.3, 8.0, 0.5),
  // Defense faces -y, so its left is +x.
  // DL at dy 0.6: the body front sits just past the ball's front tip. Techniques use a
  // 0.25 yd (9 in) shade: 0 = 0, 1 = 0.25, 2i = 0.95, 3 = 1.45, 5 = 2.65, 7 = 3.35
  // (inside shoulder of a ghost TE at 3.6).
  pos('LDE', 'Left Defensive End', 'defense', 'DE', 2.65, 0.6, 7.0, 0.5),
  pos('LDT', 'Left Defensive Tackle', 'defense', 'DT', 0.95, 0.6, 6.5, 0.6),
  pos('RDT', 'Right Defensive Tackle', 'defense', 'DT', -0.95, 0.6, 6.5, 0.6),
  pos('RDE', 'Right Defensive End', 'defense', 'DE', -2.65, 0.6, 7.0, 0.5),
  // LBs at 4.5 yd, inside the 3-5 yd range. MLB (Mike) at center-right of the box, WLB (Will) at -x,
  // SLB (Sam) outside the Mike on the offense-right (+x) side. SLB stays after MLB: roleRating reads the first LB row.
  pos('MLB', 'Middle Linebacker', 'defense', 'LB', 1.28, 4.5, 7.5, 0.5, { read: 0.35 }),
  pos('WLB', 'Weakside Linebacker', 'defense', 'LB', -1.28, 4.5, 7.5, 0.5, { read: 0.5 }),
  pos('SLB', 'Strongside Linebacker', 'defense', 'LB', 3.52, 4.5, 7.5, 0.5, { read: 0.5 }),
]);

// Defensive fronts. Defender rows use the same dx/dy convention as POSITIONS; non-base
// fronts are written for a playside-left play (the only play today).
const roleRating = (role) => {
  const row = POSITIONS.find((p) => p.team === 'defense' && p.role === role);
  return { speed: row.speed, strength: row.strength, def: row.def };
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
  return pos(id, NAMES[id], 'defense', role, dx, dy, r.speed, r.strength, r.def);
}));
const swap = (rows, id, dx, dy) => rows.map((r) => (r[0] === id ? [r[0], r[1], dx, dy] : r));

const OVER43 = [
  ['PE', 'DE', -2.65, 0.6], ['PT', 'DT', -1.45, 0.6], ['BT', 'DT', 0.25, 0.6], ['BE', 'DE', 2.65, 0.6],
  ['SAM', 'LB', -2.4, 4.5], ['MIK', 'LB', -0.4, 4.5], ['WIL', 'LB', 1.6, 4.5],
];
const UNDER43 = [
  ['PE', 'DE', -2.65, 0.6], ['PN', 'DT', -0.25, 0.6], ['BT', 'DT', 1.45, 0.6], ['BE', 'DE', 2.65, 0.6],
  ['L1', 'LB', -1.92, 4.5], ['L2', 'LB', 0.48, 4.5], ['L3', 'LB', 2.4, 4.5],
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
      ['PO', 'LB', -4.0, 1.0], ['PE', 'DE', -2.65, 0.6], ['N', 'DT', 0, 0.6], ['BE', 'DE', 2.65, 0.6],
      ['BO', 'LB', 4.0, 1.0], ['PI', 'LB', -1.12, 4.5], ['BI', 'LB', 1.12, 4.5],
    ]),
  }),
  bear: Object.freeze({
    name: 'Bear',
    defenders: defenders([
      ['PE', 'DE', -3.35, 0.6], ['P3', 'DT', -1.45, 0.6], ['N', 'DT', 0, 0.6], ['B3', 'DT', 1.45, 0.6],
      ['BE', 'DE', 3.35, 0.6], ['L1', 'LB', -1.12, 4.5], ['L2', 'LB', 1.6, 4.5],
    ]),
  }),
  walkedUp: Object.freeze({
    name: '4-3 Over, Sam Walked Up',
    defenders: defenders(swap(OVER43, 'SAM', -3.68, 1.5)),
  }),
  backedOff: Object.freeze({
    name: '4-3 Under, 3-Tech Backed Off',
    defenders: defenders(swap(UNDER43, 'BT', 1.45, 2.5)),
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
      def: p.def,
      assignment: a ? { ...a } : emptyAssignment(),
    };
  });
}
