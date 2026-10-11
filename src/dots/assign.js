// New scheme = new rule table; new rule = new RULES entry `(state, i) => {target, partner?, watch?} | null`.
// Scheme-agnostic assignment engine: runs an ordered rule table over a front read. Pure.
// General zone rules, on any alignment and personnel:
// - the surface ends one split outside each end lineman; line defenders beyond it are covered by nobody;
// - the backside end lineman blocks the backside end man (lowest u); the lineman just inside him
//   takes the end lineman's other covered men (hand-in);
// - nobody reaches past a teammate: a pending man outside the playside neighbour is dropped;
// - an uncovered lineman helps the adjacent covered teammate whose man is shaded toward him (between the two,
//   or head-up on the covered man: the playside helper first); one helper per covered man, one covered man per
//   helper, the last backside lineman never combos; pairs are named ace (C + guard), deuce (guard + tackle),
//   tag (tackle + TE), else combo; nobody left to help climbs;
// - the backside end lineman with no line defender to cut off cuts off the nearest second-level man in reach
//   (even one a combo watches);
// - a man-short line leaves the backside end man (plays contain): `spare` lets the end lineman, whose
//   covered man would be that end man, climb to a free second-level defender instead;
// - the Mike is the second-level man nearest the playside A gap; the others count from him (playside +1, +2,
//   backside -1, -2). Combos and climbers (units, playside first) get distinct LBs, each more backside than the
//   unit before it; pass one finds the units, pass two deals the LBs: most units served, then the Mike, then
//   the least total count distance from the Mike;
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

// Second-level men are taken by the Mike count (Mike 0, playside +1, +2, backside -1, -2). Every combo or
// climber (a "unit", in line order) asks for one; `planWatches` hands them out (see runScheme).
function pickSecond(state, ref) {
  const { front, targeted, watched, count } = state;
  const k = state.calls.length;
  state.calls.push(ref);
  const free = (e) => e.level === 'second' && !targeted.has(e.id) && !watched.has(e.id);
  let d = null;
  if (state.plan && k < state.plan.length) {
    d = state.plan[k] == null ? null : front.defenders.find((e) => e.id === state.plan[k] && free(e)) || null;
  } else {
    d = front.defenders
      .filter((e) => free(e) && Math.abs(e.x - ref) <= CLIMB_REACH)
      .sort((a, c) => (Math.abs(count.get(a.id)) - Math.abs(count.get(c.id)))
        || (count.get(c.id) - count.get(a.id)) || idCmp(a.id, c.id))[0] || null;
  }
  return d;
}

// Best matching of units (their reference x, in line order) to second-level men: distinct, each more backside
// than the one before (a playside unit never watches a more backside LB), most units served first, then the
// Mike served, then the smallest total distance in count from the Mike.
function planWatches(front, count, refs) {
  const lbs = front.defenders.filter((d) => d.level === 'second')
    .sort((a, c) => (count.get(c.id) - count.get(a.id)) || idCmp(a.id, c.id));
  let best = null;
  const cur = [];
  const rec = (k, last, matched, mike, dist) => {
    if (k === refs.length) {
      const better = !best || matched > best.matched || (matched === best.matched
        && (mike > best.mike || (mike === best.mike && dist < best.dist)));
      if (better) best = { plan: [...cur], matched, mike, dist };
      return;
    }
    for (const d of lbs) {
      const c = count.get(d.id);
      if (c >= last || Math.abs(d.x - refs[k]) > CLIMB_REACH) continue;
      cur[k] = d.id;
      rec(k + 1, c, matched + 1, mike + (c === 0 ? 1 : 0), dist + Math.abs(c));
    }
    cur[k] = null;
    rec(k + 1, last, matched, mike, dist);
  };
  rec(0, Infinity, 0, 0, 0);
  return best ? best.plan : [];
}

// Mike: the second-level man nearest the playside A gap centre; count the others by lateral order from him.
function mikeCount(front) {
  const seconds = front.defenders.filter((d) => d.level === 'second');
  const gapX = front.centerX + front.side * A_GAP_HALF;
  const mike = [...seconds].sort((a, c) =>
    (Math.abs(a.x - gapX) - Math.abs(c.x - gapX)) || (a.y - c.y) || idCmp(a.id, c.id))[0] || null;
  const count = new Map();
  if (!mike) return { mike: null, count };
  count.set(mike.id, 0);
  const tie = (a, c) => (a.y - c.y) || idCmp(a.id, c.id);
  const rest = seconds.filter((d) => d !== mike);
  rest.filter((d) => d.u >= mike.u).sort((a, c) => (a.u - c.u) || tie(a, c)).forEach((d, k) => count.set(d.id, k + 1));
  rest.filter((d) => d.u < mike.u).sort((a, c) => (c.u - a.u) || tie(a, c)).forEach((d, k) => count.set(d.id, -(k + 1)));
  return { mike: mike.id, count };
}

// An uncovered lineman helps the adjacent covered teammate whose man is shaded toward him (between them, or
// head-up; head-up: the playside helper first). The playside neighbour is looked at first. Not the last man.
function double(state, i) {
  const { front } = state;
  if (i === front.line.length - 1) return null;
  const b = front.line[i];
  const prev = state.results[i - 1];
  const nb = front.line[i - 1];
  if (prev && prev.rule === 'covered' && !state.helped.has(nb.id)) {
    const tgt = defOf(state, prev.target);
    if (tgt && tgt.level === 'line' && tgt.u - nb.u <= HEAD_UP) {
      const w = pickSecond(state, (b.x + nb.x) / 2);
      if (w) state.watched.add(w.id);
      return { target: prev.target, partner: nb.id, watch: w ? w.id : null };
    }
  }
  const ob = front.line[i + 1];
  if (i + 1 < front.line.length - 1) {
    const probe = covered({ ...state, pending: [...state.pending] }, i + 1);
    const tgt = probe && defOf(state, probe.target);
    if (tgt && tgt.level === 'line' && tgt.u - ob.u >= -HEAD_UP) {
      const w = pickSecond(state, (b.x + ob.x) / 2);
      if (w) state.watched.add(w.id);
      return { target: probe.target, partner: ob.id, watch: w ? w.id : null, deferred: true };
    }
  }
  return null;
}

function climb(state, i) {
  const b = state.front.line[i];
  const d = pickSecond(state, b.x);
  return d ? { target: d.id } : null;
}

// With no line defender left to cut off, the backside end lineman cuts off the nearest untargeted second-level
// man in reach (a combo's watch does not exclude him: zoneSwitch skips a watch already claimed by a block).
function cutoff(state, i) {
  const { front, targeted } = state;
  const b = front.line[i];
  const d = front.defenders
    .filter((e) => e.level === 'line' && e.cover != null && !targeted.has(e.id) && e.u < b.u)
    .sort(byNearest(b.x))[0];
  if (d && Math.abs(d.x - b.x) <= CLIMB_REACH) return { target: d.id };
  if (i !== front.line.length - 1) return null;
  const s = front.defenders
    .filter((e) => e.level === 'second' && !targeted.has(e.id) && Math.abs(e.x - b.x) <= CLIMB_REACH + 1e-9)
    .sort(byNearest(b.x))[0];
  return s ? { target: s.id } : null;
}

function spare(state, i) {
  const { front } = state;
  if (i !== front.line.length - 1) return null;
  if (front.edge == null || state.targeted.has(front.edge)) return null;
  const probe = covered({ ...state, pending: [...state.pending] }, i);
  if (!probe || probe.target !== front.edge) return null;
  const lb = pickSecond(state, front.line[i].x);
  return lb ? { target: lb.id } : null;
}

export const RULES = { covered, double, climb, cutoff, spare };

const PAIR_NAMES = ['ace', 'deuce', 'tag'];
// Pair name from the positions on the line counted out from the C: C+guard ace, guard+tackle deuce, tackle+TE tag.
function pairName(front, owner, partner) {
  const n = (id) => front.line.find((l) => l.id === id).n;
  const a = n(owner);
  const c = n(partner);
  const lo = Math.min(Math.abs(a), Math.abs(c));
  if (Math.abs(Math.abs(a) - Math.abs(c)) !== 1 || (lo > 0 && Math.sign(a) !== Math.sign(c))) return 'combo';
  return PAIR_NAMES[lo] || 'combo';
}

export function runScheme(front, scheme) {
  for (const row of scheme.rules) {
    if (!Object.hasOwn(RULES, row.when)) throw new Error(`runScheme: unknown rule "${row.when}"`);
  }
  const { mike, count } = mikeCount(front);
  // Pass one hands every unit the nearest LB in count and records where the units are; pass two deals the LBs
  // by the best matching for those units.
  const first = runPass(front, scheme, mike, count, null);
  if (!first.calls.length) return first.result;
  return runPass(front, scheme, mike, count, planWatches(front, count, first.calls)).result;
}

function runPass(front, scheme, mike, count, plan) {
  const state = {
    front, targeted: new Set(), watched: new Set(), pending: [], results: [],
    count, plan, calls: [], helped: new Set(), joined: new Map(),
  };
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
      if (!res.deferred) {
        state.targeted.add(res.target);
        state.pending = state.pending.filter((id) => id !== res.target);
      }
      state.results[i] = { rule: row.when, ...res };
      blocks[b.id] = res.target;
      const tgt = defOf(state, res.target);
      const sh = row.when === 'covered' ? shade(b.u, tgt.u) : 'none';
      if (row.when === 'double') {
        const watch = res.watch;
        techs[b.id] = { tech: row.tech, shade: sh, watch };
        state.helped.add(res.partner);
        if (techs[res.partner]) techs[res.partner] = { tech: row.tech, shade: techs[res.partner].shade, watch };
        else state.joined.set(res.partner, { tech: row.tech, watch });
        combos.push({ owner: b.id, partner: res.partner, target: res.target, watch });
      } else {
        const j = row.when === 'covered' ? state.joined.get(b.id) : null;
        techs[b.id] = j ? { tech: j.tech, shade: sh, watch: j.watch } : { tech: row.tech, shade: sh, watch: null };
      }
      return;
    }
  });

  const nOf = (id) => front.line.find((l) => l.id === id).n;
  combos.sort((a, b) => nOf(a.owner) - nOf(b.owner));
  const free = front.defenders
    .filter((d) => !state.targeted.has(d.id) && !state.watched.has(d.id))
    .map((d) => d.id);
  const pairs = combos.map((c) => ({ name: pairName(front, c.owner, c.partner), owner: c.owner, partner: c.partner }));
  return { result: { side: front.side, blocks, techs, combos, free, mike, pairs }, calls: state.calls };
}
