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
// ratings is an optional object of per-position ratings (0-1), spread onto the row (the RB's vision).
const pos = (id, name, team, role, dx, dy, speed, strength, def, ratings) =>
  Object.freeze({ id, name, team, role, dx, dy, speed, strength, def: def ? Object.freeze({ ...def }) : null, ...ratings });

// Ratings per position. speed is yd/s of short-area play speed (about 80% of the
// 40-yard-dash average); steering.js's ACCEL_TAU ramp models the start from rest.
// strength is unitless force used by blocking: OL must stay above every defender's
// strength / 0.7071 so the OL win at any block angle.
// Move ratings (0-1) are success rates against an average (0.5) blocker. DL, LB and DB carry
// swim and power, the shed moves a blocked defender tries. OL and TE: hands counters swim and anchor counters power.
// A missing move rating counts as 0 (never tried); a missing counter as 0.5.
// Footwork ratings (DL, LB, DB; steering.js falls back to its own defaults when absent): shuffle
// is the fraction of top speed when moving sideways, pedal the fraction when moving straight back,
// both while facing a target. DBs strafe and backpedal better than LBs, and LBs better than linemen.
const LB_SWIM = 0.2;
const LB_POWER = 0.15;
const DL_SHUFFLE = 0.6;
const DL_PEDAL = 0.45;
const LB_SHUFFLE = 0.75;
const LB_PEDAL = 0.6;
const DB_SHUFFLE = 0.85;
const DB_PEDAL = 0.8;
export const DL_DEPTH = 0.6; // dy of the D line rows
export const LB_DEPTH = DL_DEPTH + 3; // off-ball LBs: 3 yd behind the D line (R-32)
export const SS_DEPTH = DL_DEPTH + 7; // strong safety: 7 yd behind the D line (R-32)
export const FS_DEPTH = DL_DEPTH + 10; // free safety: 10 yd behind the D line (R-32)
export const POSITIONS = Object.freeze([
  // OL: linemen 1.2 yd center to center (body-to-body split 0.64 yd, about 1.9 ft, inside
  // the standard 1-2 ft). C's front edge sits on the ball's rear tip (dy = -BODY_RADIUS);
  // guards about 1 ft deeper, tackles 0.15 yd deeper still.
  pos('LT', 'Left Tackle', 'offense', 'OL', -2.4, -0.75, 6.0, 1.0, null, { hands: 0.5, anchor: 0.5 }),
  pos('LG', 'Left Guard', 'offense', 'OL', -1.2, -0.6, 6.0, 1.0, null, { hands: 0.5, anchor: 0.5 }),
  pos('C', 'Center', 'offense', 'OL', 0, -0.28, 6.0, 1.0, null, { hands: 0.5, anchor: 0.5 }),
  pos('RG', 'Right Guard', 'offense', 'OL', 1.2, -0.6, 6.0, 1.0, null, { hands: 0.5, anchor: 0.5 }),
  pos('RT', 'Right Tackle', 'offense', 'OL', 2.4, -0.75, 6.0, 1.0, null, { hands: 0.5, anchor: 0.5 }),
  // QB 5 yd behind the center (shotgun 5-7 yd); RB level with him, about 3 ft of daylight to his side.
  pos('QB', 'Quarterback', 'offense', 'QB', 0, -5.3, 7.0, 0.3),
  pos('RB', 'Running Back', 'offense', 'RB', 1.6, -5.3, 8.0, 0.5, null, { vision: 0.8 }),
  // Defense faces -y, so its left is +x.
  // DL at dy 0.6: the body front sits just past the ball's front tip. Techniques use a
  // 0.25 yd (9 in) shade: 0 = 0, 1 = 0.25, 2i = 0.95, 3 = 1.45, 5 = 2.65, 7 = 3.35
  // (inside shoulder of a ghost TE at 3.6).
  pos('LDE', 'Left Defensive End', 'defense', 'DE', 2.65, 0.6, 7.0, 0.5, null, { swim: 0.25, power: 0.15, shuffle: DL_SHUFFLE, pedal: DL_PEDAL }),
  pos('LDT', 'Left Defensive Tackle', 'defense', 'DT', 0.95, 0.6, 6.5, 0.6, null, { swim: 0.15, power: 0.25, shuffle: DL_SHUFFLE, pedal: DL_PEDAL }),
  pos('RDT', 'Right Defensive Tackle', 'defense', 'DT', -0.95, 0.6, 6.5, 0.6, null, { swim: 0.15, power: 0.25, shuffle: DL_SHUFFLE, pedal: DL_PEDAL }),
  pos('RDE', 'Right Defensive End', 'defense', 'DE', -2.65, 0.6, 7.0, 0.5, null, { swim: 0.25, power: 0.15, shuffle: DL_SHUFFLE, pedal: DL_PEDAL }),
  // LBs 3 yd behind the D line (LB_DEPTH). MLB (Mike) at center-right of the box, WLB (Will) at -x,
  // SLB (Sam) outside the Mike on the offense-right (+x) side. Fronts inherit ratings and def from the nearest base row of the same role (roleRating).
  pos('MLB', 'Middle Linebacker', 'defense', 'LB', 1.28, LB_DEPTH, 7.5, 0.5, { read: 0.35 }, { swim: LB_SWIM, power: LB_POWER, shuffle: LB_SHUFFLE, pedal: LB_PEDAL }),
  pos('WLB', 'Weakside Linebacker', 'defense', 'LB', -1.28, LB_DEPTH, 7.5, 0.5, { read: 0.5 }, { swim: LB_SWIM, power: LB_POWER, shuffle: LB_SHUFFLE, pedal: LB_PEDAL }),
  pos('SLB', 'Strongside Linebacker', 'defense', 'LB', 3.52, LB_DEPTH, 7.5, 0.5, { read: 0.5 }, { swim: LB_SWIM, power: LB_POWER, shuffle: LB_SHUFFLE, pedal: LB_PEDAL }),
]);

// Offensive personnel = extra offense rows added to the POSITIONS offense. noTe is the no-TE look
// (a nickel front for it is a future FRONTS entry).
const RT = POSITIONS.find((p) => p.id === 'RT');
const RG = POSITIONS.find((p) => p.id === 'RG');
export const PERSONNEL = Object.freeze({
  noTe: Object.freeze({ name: 'No TE (5 OL)', rows: Object.freeze([]) }),
  te: Object.freeze({
    name: '1 TE (attached right)',
    // Attached: one OL split outside the right tackle, on the tackle's depth. His side is the
    // strong side. Strength 0.9 keeps him above every defender's strength / 0.7071 like the OL.
    rows: Object.freeze([pos('TE', 'Tight End', 'offense', 'TE', RT.dx + (RT.dx - RG.dx), RT.dy, 6.5, 0.9, null, { hands: 0.4, anchor: 0.35 })]),
  }),
});

// Defensive fronts. Defender rows use the same dx/dy convention as POSITIONS; non-base
// fronts are written for a playside-left play (the only play today).
// Rating fields a row can carry beyond speed and strength: the RB's vision and the move ratings.
const RATING_KEYS = Object.freeze(['vision', 'swim', 'power', 'hands', 'anchor', 'shuffle', 'pedal']);
const MOVE_KEYS = Object.freeze(['swim', 'power', 'hands', 'anchor']);
// Footwork ratings: copied by roleRating alongside MOVE_KEYS, but not move ratings.
const FOOTWORK_KEYS = Object.freeze(['shuffle', 'pedal']);
// Nearest base defense row of the same role to the alignment (dx, dy); ties go to the earlier row.
// Also returns the row's move ratings (only those the row defines).
const roleRating = (role, dx, dy) => {
  let row = null;
  let best = Infinity;
  for (const p of POSITIONS) {
    if (p.team !== 'defense' || p.role !== role) continue;
    const d = Math.hypot(p.dx - dx, p.dy - dy);
    if (d < best) { best = d; row = p; }
  }
  const moves = Object.fromEntries([...MOVE_KEYS, ...FOOTWORK_KEYS].filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
  return { speed: row.speed, strength: row.strength, def: row.def, ...moves };
};
const NAMES = Object.freeze({
  PE: 'Playside End', BE: 'Backside End', PT: 'Playside Tackle', BT: 'Backside Tackle',
  PN: 'Playside Nose', N: 'Nose Tackle', P3: 'Playside 3-Technique', B3: 'Backside 3-Technique',
  SAM: 'Sam Linebacker', MIK: 'Mike Linebacker', WIL: 'Will Linebacker',
  L1: 'Linebacker 1', L2: 'Linebacker 2', L3: 'Linebacker 3',
  PO: 'Playside Outside Linebacker', BO: 'Backside Outside Linebacker',
  PI: 'Playside Inside Linebacker', BI: 'Backside Inside Linebacker',
  NB: 'Nickel Back', CBX: 'Cornerback (on X)', CBZ: 'Cornerback (on Z)', FS: 'Free Safety', SS: 'Strong Safety',
});
// rows: [id, role, dx, dy]
const defenders = (rows) => Object.freeze(rows.map(([id, role, dx, dy]) => {
  const { speed, strength, def, ...moves } = roleRating(role, dx, dy);
  return pos(id, NAMES[id], 'defense', role, dx, dy, speed, strength, def, moves);
}));
const swap = (rows, id, dx, dy) => rows.map((r) => (r[0] === id ? [r[0], r[1], dx, dy] : r));

const OVER43 = [
  ['PE', 'DE', -2.65, 0.6], ['PT', 'DT', -1.45, 0.6], ['BT', 'DT', 0.25, 0.6], ['BE', 'DE', 2.65, 0.6],
  ['SAM', 'LB', -2.4, LB_DEPTH], ['MIK', 'LB', -0.4, LB_DEPTH], ['WIL', 'LB', 1.6, LB_DEPTH],
];
const UNDER43 = [
  ['PE', 'DE', -2.65, 0.6], ['PN', 'DT', -0.25, 0.6], ['BT', 'DT', 1.45, 0.6], ['BE', 'DE', 2.65, 0.6],
  ['L1', 'LB', -1.92, LB_DEPTH], ['L2', 'LB', 0.48, LB_DEPTH], ['L3', 'LB', 2.4, LB_DEPTH],
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
      ['BO', 'LB', 4.0, 1.0], ['PI', 'LB', -1.12, LB_DEPTH], ['BI', 'LB', 1.12, LB_DEPTH],
    ]),
  }),
  bear: Object.freeze({
    name: 'Bear',
    defenders: defenders([
      ['PE', 'DE', -3.35, 0.6], ['P3', 'DT', -1.45, 0.6], ['N', 'DT', 0, 0.6], ['B3', 'DT', 1.45, 0.6],
      ['BE', 'DE', 3.35, 0.6], ['L1', 'LB', -1.12, LB_DEPTH], ['L2', 'LB', 1.6, LB_DEPTH],
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

// Full-11 offensive formations and defensive personnel. FRONTS and PERSONNEL keep their
// 7-man shape; a formation picks a PERSONNEL key to build on and adds its rows here.
// WR and DB rows are bodies at an alignment: their routes, coverage and run support come later.
export const WR_ROLES = Object.freeze(['WR']);
export const DB_ROLES = Object.freeze(['CB', 'S']);
const WR_SPEED = 8.5;
const WR_STRENGTH = 0.4;
const DB_SPEED = 8.0;
const DB_STRENGTH = 0.4;
const DB_SWIM = 0.2;
const DB_POWER = 0.05;
const wr = (id, name, dx, dy) => pos(id, name, 'offense', 'WR', dx, dy, WR_SPEED, WR_STRENGTH);
// DB rows: roleRating has no CB/S base row, so the speed, strength, move and footwork ratings are set here.
const db = (id, role, dx, dy) => pos(id, NAMES[id], 'defense', role, dx, dy, DB_SPEED, DB_STRENGTH, null, { swim: DB_SWIM, power: DB_POWER, shuffle: DB_SHUFFLE, pedal: DB_PEDAL });

// defense: the DEF_PERSONNEL key this formation is normally met with.
export const FORMATIONS = Object.freeze({
  '11': Object.freeze({
    name: '11: TE right, slot left (2x2)',
    personnel: 'te',
    rows: Object.freeze([
      wr('X', 'Split End', -13.0, -0.75),
      wr('H', 'Slot Receiver', -6.5, -1.25),
      wr('Z', 'Flanker', 12.0, -1.25),
    ]),
    defense: 'nickel',
  }),
  '12': Object.freeze({
    name: '12: TE each side, 2 WR',
    personnel: 'te',
    rows: Object.freeze([
      pos('TE2', 'Second Tight End', 'offense', 'TE', -3.6, -0.75, 6.5, 0.9),
      wr('X', 'Split End', -13.0, -0.75),
      wr('Z', 'Flanker', 12.0, -1.25),
    ]),
    defense: 'base11',
  }),
  '21': Object.freeze({
    name: '21: FB wing right, 2 WR',
    personnel: 'te',
    rows: Object.freeze([
      pos('FB', 'Fullback', 'offense', 'FB', 4.4, -1.8, 7.0, 0.7),
      wr('X', 'Split End', -13.0, -0.75),
      wr('Z', 'Flanker', 12.0, -1.25),
    ]),
    defense: 'base11',
  }),
});

// Defensive personnel = all 11 defender rows. DL and LB come from defenders(); DBs from db().
export const DEF_PERSONNEL = Object.freeze({
  nickel: Object.freeze({
    name: 'Nickel 4-2-5',
    defenders: Object.freeze([
      ...defenders([
        ['PE', 'DE', -2.65, 0.6], ['PT', 'DT', -1.45, 0.6], ['BT', 'DT', 0.25, 0.6], ['BE', 'DE', 2.65, 0.6],
        ['MIK', 'LB', -0.4, LB_DEPTH], ['WIL', 'LB', 1.6, LB_DEPTH],
      ]),
      db('NB', 'CB', -6.2, 4.0), db('CBX', 'CB', -13.0, 6.0), db('CBZ', 'CB', 12.0, 6.0),
      db('FS', 'S', -4.0, FS_DEPTH), db('SS', 'S', 4.0, SS_DEPTH),
    ]),
  }),
  base11: Object.freeze({
    name: '4-3 Base + 2 CB, 2 S',
    defenders: Object.freeze([
      ...FRONTS.base.defenders,
      db('CBX', 'CB', -13.0, 6.0), db('CBZ', 'CB', 12.0, 6.0),
      db('FS', 'S', -4.0, FS_DEPTH), db('SS', 'S', 4.0, SS_DEPTH),
    ]),
  }),
});

// Play definitions. Shapes:
//   ball: { start, snapTo } where start is the position id holding the ball
//         pre-snap and snapTo is the position id that receives the snap.
//   assignments: { [positionId]: { goal, target } } holds per-position goals
//         and targets. Empty for the base play; later plays add entries here.
//   personnel?: key of PERSONNEL (optional; absent = 'noTe').
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
    // Attached TE: 6 blockers vs the 7-man box. 'noTe' is the no-TE look.
    personnel: 'te',
    playside: 'left',
    scheme: 'zone', // names the blocking scheme play.js applies at the snap
    run: Object.freeze({ carrier: 'RB', patience: 0.5 }), // run: { carrier, patience? } = who takes the handoff; patience = seconds the RB presses and re-reads behind the line before committing (0 or absent: commit at once; carrier.js clamps and scales it)
  }),
});

export function emptyAssignment() {
  return { goal: null, target: null };
}

// Roles that make up the defensive line. buildLineup shifts only these.
export const DL_ROLES = Object.freeze(['DE', 'DT']);
export const LB_ROLES = Object.freeze(['LB']);

// Move counter: the OL/TE rating that answers each DL move (hands beats swim, anchor beats power).
export const MOVE_COUNTER = Object.freeze({ swim: 'hands', power: 'anchor' });

const clamp01 = (x) => Math.min(1, Math.max(0, x));
// Log5 odds that a DL move with success rate `rating` beats a blocker whose counter is `counter`.
// Both are success rates against an average (0.5) blocker. Missing args default to rating 0 and counter 0.5.
// When both sides are certain (denominator 0), the result is the move rating.
export function moveOdds(rating, counter) {
  const r = clamp01(rating ?? 0);
  const c = clamp01(counter ?? 0.5);
  const win = r * (1 - c);
  const lose = c * (1 - r);
  const denom = win + lose;
  if (denom === 0) return r;
  return win / denom;
}

// front picks a key of FRONTS for the defense. dlShift is a lateral offset in yards
// added to x of every DL player; lbShift does the same for LBs. personnel picks a key of
// PERSONNEL (default: the play's personnel, else 'noTe').
// formation picks a key of FORMATIONS (full-11 offense; personnel is then ignored).
// defPersonnel picks a key of DEF_PERSONNEL (full-11 defense; front is then ignored).
export function buildLineup(los, playKey = 'base', { front = 'base', dlShift = 0, lbShift = 0, personnel, formation = null, defPersonnel = null } = {}) {
  const play = PLAYS[playKey];
  if (!play) throw new Error(`buildLineup: unknown play "${playKey}"`);
  if (!Object.hasOwn(FRONTS, front)) throw new Error(`buildLineup: unknown front "${front}"`);
  let offense;
  if (formation != null) {
    if (!Object.hasOwn(FORMATIONS, formation)) throw new Error(`buildLineup: unknown formation "${formation}"`);
    const form = FORMATIONS[formation];
    offense = [...POSITIONS.filter((p) => p.team === 'offense'), ...PERSONNEL[form.personnel].rows, ...form.rows];
  } else {
    const key = personnel ?? play.personnel ?? 'noTe';
    if (!Object.hasOwn(PERSONNEL, key)) throw new Error(`buildLineup: unknown personnel "${key}"`);
    offense = [...POSITIONS.filter((p) => p.team === 'offense'), ...PERSONNEL[key].rows];
  }
  if (defPersonnel != null && !Object.hasOwn(DEF_PERSONNEL, defPersonnel)) {
    throw new Error(`buildLineup: unknown defPersonnel "${defPersonnel}"`);
  }
  const defense = defPersonnel != null ? DEF_PERSONNEL[defPersonnel].defenders : FRONTS[front].defenders;
  const rows = [...offense, ...defense];
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
      ...Object.fromEntries(RATING_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])),
      assignment: a ? { ...a } : emptyAssignment(),
    };
  });
}
