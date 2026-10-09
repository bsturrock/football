// New scheme = new rule table; new rule = new RULES entry `(state, i) => {target, partner?, watch?} | null`.
// Scheme-agnostic assignment engine: runs an ordered rule table over a front read. Pure.
import { shade } from './front.js';
import { A_GAP_HALF } from './numbering.js';

export const CLIMB_REACH = 4 * A_GAP_HALF; // two line splits

const idCmp = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const byNearest = (ref) => (a, b) =>
  (Math.abs(a.x - ref) - Math.abs(b.x - ref)) || (Math.abs(a.n) - Math.abs(b.n)) || idCmp(a.id, b.id);
const defOf = (state, id) => state.front.defenders.find((d) => d.id === id);

function covered(state, i) {
  const { front, targeted, pending } = state;
  const b = front.line[i];
  const inReach = (d) => Math.abs(d.x - b.x) <= CLIMB_REACH;
  const ids = [...(front.covered[b.id] || []), ...pending].filter((id) => !targeted.has(id));
  const uniq = [...new Set(ids)];
  const cands = uniq.map((id) => defOf(state, id)).filter(inReach);
  if (!cands.length) return null;
  cands.sort((a, c) => (c.u - a.u) || idCmp(a.id, c.id));
  const target = cands[0];
  const kept = uniq.filter((id) => pending.includes(id) && !inReach(defOf(state, id)));
  state.pending = [...kept, ...cands.slice(1).map((d) => d.id)];
  return { target: target.id };
}

function pickSecond(state, ref) {
  const { front, targeted, watched } = state;
  return front.defenders
    .filter((d) => d.level === 'second' && !targeted.has(d.id) && !watched.has(d.id))
    .sort(byNearest(ref))[0] || null;
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
  return d && Math.abs(d.x - b.x) <= CLIMB_REACH ? { target: d.id } : null;
}

function cutoff(state, i) {
  const b = state.front.line[i];
  const d = state.front.defenders
    .filter((e) => e.level === 'line' && !state.targeted.has(e.id) && e.u < b.u)
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
