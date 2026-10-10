// New scheme = new rule table; new rule = new RULES entry `(state, i) => {target, partner?, watch?} | null`.
// Scheme-agnostic assignment engine: runs an ordered rule table over a front read. Pure.
// General zone rules, on any alignment and personnel:
// - the surface ends one split outside each end lineman; line defenders beyond it are covered by nobody;
// - the backside end lineman blocks the backside end man (lowest u); the lineman just inside him
//   takes the end lineman's other covered men (hand-in);
// - nobody reaches past a teammate: a pending man outside the playside neighbour is dropped;
// - second-level defenders are taken in zone count order (n = 0, 1, ..., then -1, -2, ...);
// - whoever is left unblocked and unwatched falls out of the box count.
import { shade, HEAD_UP } from './front.js';
import { A_GAP_HALF } from './numbering.js';

export const CLIMB_REACH = 4 * A_GAP_HALF; // two line splits

const idCmp = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const byNearest = (ref) => (a, b) =>
  (Math.abs(a.x - ref) - Math.abs(b.x - ref)) || (Math.abs(a.n) - Math.abs(b.n)) || idCmp(a.id, b.id);
const defOf = (state, id) => state.front.defenders.find((d) => d.id === id);

function covered(state, i) {
  const { front, targeted } = state;
  const b = front.line[i];
  const last = front.line.length - 1;
  const inReach = (d) => Math.abs(d.x - b.x) <= CLIMB_REACH;
  // Nobody reaches past a teammate: drop pending men outside the playside neighbour.
  const pending = i > 0
    ? state.pending.filter((id) => defOf(state, id).u <= front.line[i - 1].u + HEAD_UP)
    : state.pending;
  // The lineman just inside the backside end takes the end lineman's covered men except the outermost.
  let handIn = [];
  if (i === last - 1) {
    handIn = (front.covered[front.line[last].id] || [])
      .map((id) => defOf(state, id))
      .sort((a, c) => (a.u - c.u) || idCmp(a.id, c.id))
      .slice(1)
      .map((d) => d.id);
  }
  const ids = [...(front.covered[b.id] || []), ...handIn, ...pending].filter((id) => !targeted.has(id));
  const uniq = [...new Set(ids)];
  const cands = uniq.map((id) => defOf(state, id)).filter(inReach);
  if (!cands.length) return null;
  // The backside end lineman takes the end man (lowest u); everyone else the highest u.
  if (i === last) cands.sort((a, c) => (a.u - c.u) || idCmp(a.id, c.id));
  else cands.sort((a, c) => (c.u - a.u) || idCmp(a.id, c.id));
  const target = cands[0];
  const kept = uniq.filter((id) => pending.includes(id) && !inReach(defOf(state, id)));
  state.pending = [...kept, ...cands.slice(1).map((d) => d.id)];
  return { target: target.id };
}

// Second-level men are taken in zone count order (playside n = 0, 1, ..., then backside).
const countKey = (d) => (d.n >= 0 ? [0, d.n] : [1, -d.n]);
function pickSecond(state, ref) {
  const { front, targeted, watched } = state;
  return front.defenders
    .filter((d) => d.level === 'second' && !targeted.has(d.id) && !watched.has(d.id)
      && Math.abs(d.x - ref) <= CLIMB_REACH)
    .sort((a, c) => {
      const ka = countKey(a);
      const kc = countKey(c);
      return (ka[0] - kc[0]) || (ka[1] - kc[1]) || (Math.abs(a.x - ref) - Math.abs(c.x - ref)) || idCmp(a.id, c.id);
    })[0] || null;
}

function double(state, i) {
  if (i === 0) return null;
  const prev = state.results[i - 1];
  if (!prev || prev.rule !== 'covered') return null;
  const tgt = defOf(state, prev.target);
  if (!tgt || tgt.level !== 'line') return null;
  const b = state.front.line[i];
  const nb = state.front.line[i - 1];
  const w = pickSecond(state, (b.x + nb.x) / 2);
  if (w) state.watched.add(w.id);
  return { target: prev.target, partner: nb.id, watch: w ? w.id : null };
}

function climb(state, i) {
  const b = state.front.line[i];
  const d = pickSecond(state, b.x);
  return d ? { target: d.id } : null;
}

function cutoff(state, i) {
  const b = state.front.line[i];
  const d = state.front.defenders
    .filter((e) => e.level === 'line' && e.cover != null && !state.targeted.has(e.id) && e.u < b.u)
    .sort(byNearest(b.x))[0];
  return d && Math.abs(d.x - b.x) <= CLIMB_REACH ? { target: d.id } : null;
}

export const RULES = { covered, double, climb, cutoff };

export function runScheme(front, scheme) {
  for (const row of scheme.rules) {
    if (!Object.hasOwn(RULES, row.when)) throw new Error(`runScheme: unknown rule "${row.when}"`);
  }
  const state = { front, targeted: new Set(), watched: new Set(), pending: [], results: [] };
  const blocks = {};
  const techs = {};
  const combos = [];
  const last = front.line.length - 1;

  front.line.forEach((b, i) => {
    for (const row of scheme.rules) {
      if (row.at === 'playEnd' && i !== 0) continue;
      if (row.at === 'backEnd' && i !== last) continue;
      const res = RULES[row.when](state, i);
      if (!res) continue;
      state.targeted.add(res.target);
      state.pending = state.pending.filter((id) => id !== res.target);
      state.results[i] = { rule: row.when, ...res };
      blocks[b.id] = res.target;
      const tgt = defOf(state, res.target);
      const sh = row.when === 'covered' ? shade(b.u, tgt.u) : 'none';
      if (row.when === 'double') {
        const watch = res.watch;
        techs[b.id] = { tech: row.tech, shade: sh, watch };
        techs[res.partner] = { tech: row.tech, shade: techs[res.partner].shade, watch };
        combos.push({ owner: b.id, partner: res.partner, target: res.target, watch });
      } else {
        techs[b.id] = { tech: row.tech, shade: sh, watch: null };
      }
      return;
    }
  });

  const nOf = (id) => front.line.find((l) => l.id === id).n;
  combos.sort((a, b) => nOf(a.owner) - nOf(b.owner));
  const free = front.defenders
    .filter((d) => !state.targeted.has(d.id) && !state.watched.has(d.id))
    .map((d) => d.id);
  return { side: front.side, blocks, techs, combos, free };
}
