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

// dlShift is a lateral offset in yards added to x of every DL player.
export function buildLineup(los, playKey = 'base', { dlShift = 0, lbShift = 0 } = {}) {
  const play = PLAYS[playKey];
  if (!play) throw new Error(`buildLineup: unknown play "${playKey}"`);
  return POSITIONS.map((p) => {
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
