// Dots v2 lineup: the 5 OL, the shotgun QB and RB, the attached TE, and the 4 DL and 2 LB as
// plain positioned players. Pure data: no DOM, no THREE, no timers, no randomness. Imports only
// the roster data module.
import { POSITIONS, PERSONNEL, DEF_PERSONNEL, DL_ROLES, LB_ROLES } from '../dots/roster.js';

// The yard line the current dots page plays at (src/dots/view.js calls createPlay(25, ...)).
export const LOS = 25;

// Defenders taken from the nickel front, in roster order (DL first, then LB).
const FRONT_KEY = 'nickel';

// Offense from the roster: the OL rows, then the QB and RB rows (shotgun backfield), then the
// attached TE row from the 1 TE personnel.
const BACKFIELD_IDS = ['QB', 'RB'];

// Returns a new array of 14 new plain objects, each { id, name, team, role, x, y }.
// x = roster dx; y = los + roster dy (buildLineup with no mirror and no shifts).
export function dots2Lineup(los = LOS) {
  const line = POSITIONS.filter((row) => row.role === 'OL');
  const backfield = BACKFIELD_IDS.map((id) => POSITIONS.find((row) => row.id === id));
  const tight = PERSONNEL.te.rows;
  const offense = [...line, ...backfield, ...tight];
  const defense = DEF_PERSONNEL[FRONT_KEY].defenders.filter(
    (row) => DL_ROLES.includes(row.role) || LB_ROLES.includes(row.role),
  );
  return [...offense, ...defense].map((row) => ({
    id: row.id,
    name: row.name,
    team: row.team,
    role: row.role,
    x: row.dx,
    y: los + row.dy,
  }));
}
