// Dots view roster: pure data and functions. No imports, no DOM, no THREE.
//
// Coordinates match the 3D game: x = lateral yards from field center
// (negative = offense's left as it faces downfield), y = yard line
// (0 = offense's own goal, 100 = opponent goal). Offense attacks toward +y.
// dy = yards from the line of scrimmage (negative = offense backfield,
// positive = defense side).

const pos = (id, name, team, role, dx, dy) => Object.freeze({ id, name, team, role, dx, dy });

export const POSITIONS = Object.freeze([
  pos('LT', 'Left Tackle', 'offense', 'OL', -4.4, -0.7),
  pos('LG', 'Left Guard', 'offense', 'OL', -2.2, -0.7),
  pos('C', 'Center', 'offense', 'OL', 0, -0.7),
  pos('RG', 'Right Guard', 'offense', 'OL', 2.2, -0.7),
  pos('RT', 'Right Tackle', 'offense', 'OL', 4.4, -0.7),
  pos('QB', 'Quarterback', 'offense', 'QB', 0, -4.5),
  pos('RB', 'Running Back', 'offense', 'RB', 1.8, -4.5),
  // Defense faces -y, so its left is +x.
  pos('LDE', 'Left Defensive End', 'defense', 'DE', 6.0, 1.1),
  pos('LDT', 'Left Defensive Tackle', 'defense', 'DT', 1.2, 1.1),
  pos('RDT', 'Right Defensive Tackle', 'defense', 'DT', -1.2, 1.1),
  pos('RDE', 'Right Defensive End', 'defense', 'DE', -6.0, 1.1),
  pos('MLB', 'Middle Linebacker', 'defense', 'LB', 2.0, 4.5),
  pos('WLB', 'Weakside Linebacker', 'defense', 'LB', -2.0, 4.5),
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
});

export function emptyAssignment() {
  return { goal: null, target: null };
}

export function buildLineup(los, playKey = 'base') {
  const play = PLAYS[playKey];
  if (!play) throw new Error(`buildLineup: unknown play "${playKey}"`);
  return POSITIONS.map((p) => {
    const a = play.assignments[p.id];
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      role: p.role,
      x: p.dx,
      y: los + p.dy,
      assignment: a ? { ...a } : emptyAssignment(),
    };
  });
}
