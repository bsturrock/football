// Inside-zone numbering: a pure pre-snap scheme read.
import { POSITIONS } from './roster.js';

export const LINE_ROLES = Object.freeze(['OL']);
export const BOX_MARGIN = 4;
export const BOX_DEPTH = 8;
export const PLAYSIDE_SIGN = Object.freeze({ left: -1, right: 1 });
const dxOf = (id) => POSITIONS.find((p) => p.id === id).dx;
export const A_GAP_HALF = Math.abs(dxOf('RG') - dxOf('C')) / 2; // half the roster C-guard split: 0-gap aim when no playside lineman

const EPS = 1e-9;

function cmpId(a, b) {
  const x = String(a.id), y = String(b.id);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function numberPlay(players, { los, centerId, playside } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PLAYSIDE_SIGN, playside)) {
    throw new Error(`numberPlay: bad playside ${playside}`);
  }
  const s = PLAYSIDE_SIGN[playside];
  const center = players.find((p) => p.id === centerId);
  if (!center) throw new Error(`numberPlay: center ${centerId} not found`);
  const cx = center.x;
  const out = {};
  for (const p of players) out[p.id] = null;

  const line = players.filter((p) => p.team === 'offense' && LINE_ROLES.includes(p.role) && p !== center);
  const byDist = (a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx) || cmpId(a, b);
  const play = line.filter((p) => (p.x - cx) * s > 0).sort(byDist);
  const back = line.filter((p) => !((p.x - cx) * s > 0)).sort(byDist);
  out[center.id] = 0;
  play.forEach((p, i) => { out[p.id] = i + 1; });
  back.forEach((p, i) => { out[p.id] = -(i + 1); });

  let maxLine = Math.abs(0);
  for (const p of [center, ...line]) maxLine = Math.max(maxLine, Math.abs(p.x - cx));

  const box = players.filter((p) => p.team === 'defense'
    && Math.abs(p.x - cx) <= maxLine + BOX_MARGIN && p.y - los <= BOX_DEPTH);
  if (!box.length) return out;

  const gapX = play.length ? (cx + play[0].x) / 2 : cx + s * A_GAP_HALF;
  const zero = box.slice().sort((a, b) => {
    const d = Math.abs(a.x - gapX) - Math.abs(b.x - gapX);
    if (Math.abs(d) > EPS) return d;
    return (a.y - los) - (b.y - los) || cmpId(a, b);
  })[0];
  const zx = zero.x;
  out[zero.id] = 0;
  const order = (a, b) => {
    const d = Math.abs(a.x - zx) - Math.abs(b.x - zx);
    if (Math.abs(d) > EPS) return d;
    return (a.y - los) - (b.y - los) || cmpId(a, b);
  };
  const rest = box.filter((p) => p !== zero);
  rest.filter((p) => (p.x - zx) * s >= 0).sort(order).forEach((p, i) => { out[p.id] = i + 1; });
  rest.filter((p) => !((p.x - zx) * s >= 0)).sort(order).forEach((p, i) => { out[p.id] = -(i + 1); });
  return out;
}
