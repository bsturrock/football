// Pre-snap front read: covered/uncovered line players, shades, gaps and levels. Pure.
import { A_GAP_HALF } from './numbering.js';

export const LINE_DEPTH = 2.0; // yards past the los still counted as on the line
export const HEAD_UP = A_GAP_HALF / 3;
export const COVER_SHADE = A_GAP_HALF / 2;
export const GAP_NAMES = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);

export function shade(uBlocker, uDefender) {
  const du = uDefender - uBlocker;
  if (Math.abs(du) <= HEAD_UP) return 'head';
  return du > HEAD_UP ? 'playside' : 'backside';
}

const byUThenId = (a, b) => (b.u - a.u) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

// Live gap x spans walked out from the center. dir +1 = playside gaps (n = 0,1,..),
// -1 = backside gaps (n = 0,-1,..). A missing outer lineman makes that gap as wide as
// the previous one, extended away from the center; `outer` says whether he is really there.
export function liveGaps(players, line, side, dir, count) {
  const xOfId = (id) => {
    const p = players.find((q) => q.id === id);
    return p ? p.x : null;
  };
  const xOf = (n) => {
    const entry = line.find((l) => l.n === n);
    return entry ? xOfId(entry.id) : null;
  };
  if (xOf(0) == null) return [];
  const gaps = [];
  let prevWidth = 2 * A_GAP_HALF;
  let prevOuter = null;
  for (let j = 0; j < count; j++) {
    const innerX = xOf(dir * j) ?? prevOuter;
    const o = xOf(dir * (j + 1));
    const outerX = o ?? innerX + dir * side * prevWidth;
    const lo = Math.min(innerX, outerX);
    const hi = Math.max(innerX, outerX);
    gaps.push({ lo, hi, outer: o != null });
    prevWidth = hi - lo;
    prevOuter = outerX;
  }
  return gaps;
}

export function readFront(players, numbers, los) {
  const numbered = players.filter((p) => numbers[p.id] != null);
  const offense = numbered.filter((p) => p.team === 'offense');
  const center = offense.find((p) => numbers[p.id] === 0);
  if (!center) throw new Error('readFront: no center');
  const centerX = center.x;
  const p1 = offense.find((p) => numbers[p.id] === 1);
  const m1 = offense.find((p) => numbers[p.id] === -1);
  let side;
  if (p1) side = Math.sign(p1.x - centerX);
  else if (m1) side = -Math.sign(m1.x - centerX);
  else throw new Error('readFront: no side');

  const line = offense
    .map((p) => ({ id: p.id, x: p.x, u: side * (p.x - centerX), n: numbers[p.id] }))
    .sort(byUThenId);

  // The surface: one live split outside each end lineman, where a tight end would stand.
  // Line defenders beyond it are outside the surface and cover nobody.
  const lastI = line.length - 1;
  const surface = {
    play: line[0].u + (line.length > 1 ? line[0].u - line[1].u : 2 * A_GAP_HALF),
    back: line[lastI].u - (line.length > 1 ? line[lastI - 1].u - line[lastI].u : 2 * A_GAP_HALF),
  };

  // Lower edge of line[i]'s cover window. A playside lineman owns a DL on his inside shoulder
  // (nearer him than the gap's middle); the center and backside keep the head-up band.
  const lowerOf = (i) => {
    if (i === lastI) return surface.back + HEAD_UP;
    return line[i].u - (line[i].u > HEAD_UP ? COVER_SHADE : HEAD_UP);
  };

  const defenders = numbered
    .filter((p) => p.team === 'defense')
    .map((p) => {
      const u = side * (p.x - centerX);
      const level = (p.y - los <= LINE_DEPTH) ? 'line' : 'second';
      let cover = null;
      if (level === 'line') {
        for (let i = 0; i < line.length; i++) {
          const upper = i === 0 ? surface.play - HEAD_UP : lowerOf(i - 1);
          const lower = lowerOf(i);
          if (u >= lower && u < upper) { cover = line[i].id; break; }
        }
      }
      let gap = null;
      if (!line.some((l) => Math.abs(u - l.u) <= HEAD_UP)) {
        const isPlay = u > 0;
        const k = line.filter((l) => (isPlay ? l.u > 0 && l.u < u : l.u < 0 && l.u > u)).length;
        gap = { side: isPlay ? 'play' : 'back', name: GAP_NAMES[k] };
      }
      // Gap he is aligned in: head-up on a lineman is that lineman's playside gap.
      let fit;
      if (u >= -HEAD_UP) {
        const k = line.filter((l) => l.u > 0 && l.u <= u + HEAD_UP).length;
        fit = { side: 'play', name: GAP_NAMES[Math.min(k, GAP_NAMES.length - 1)] };
      } else {
        const k = line.filter((l) => l.u < 0 && l.u > u + HEAD_UP).length;
        fit = { side: 'back', name: GAP_NAMES[Math.min(k, GAP_NAMES.length - 1)] };
      }
      return { id: p.id, x: p.x, y: p.y, u, n: numbers[p.id], level, cover, gap, fit };
    })
    .sort(byUThenId);

  const covered = {};
  for (const l of line) covered[l.id] = [];
  for (const d of defenders) if (d.cover != null) covered[d.cover].push(d.id);

  // The strong side is the side with the extra line player (the attached TE); null = balanced.
  const playLine = line.filter((l) => l.u > HEAD_UP).length;
  const backLine = line.filter((l) => l.u < -HEAD_UP).length;
  const strong = playLine > backLine ? 'play' : backLine > playLine ? 'back' : null;

  // The backside end man on the line (EMOL). Plain inside zone blocks him; a zone-read play
  // would leave him for the QB.
  let edge = null;
  let edgeU = Infinity;
  for (const d of defenders) {
    if (d.level !== 'line' || !(d.u < -HEAD_UP)) continue;
    if (d.u < edgeU || (d.u === edgeU && String(d.id) < String(edge))) {
      edge = d.id;
      edgeU = d.u;
    }
  }

  return { side, centerX, box: defenders.length, line, defenders, covered, strong, edge, surface };
}
