// Perception (layer 1): what each player sees, from recorded world snapshots. Pure.
//
// Rule for the physics port: this module reads only positions it records in its own
// history, team/role/id, and contact facts (who is engaged on whom). Velocities are
// differences of recorded positions. Only worldSnapshot touches live player objects.
//
// Cue object from cuesFor(state, id) / perceiveAll(state). Same keys for everyone;
// null when the cue does not apply to his role. The observer's own position is the latest
// snapshot; everyone else is seen at (latest.t - delay), delay = his `reaction` if finite
// and >= 0, else REACTION_DELAY.
//   seen   t of the snapshot he sees others in.   delay  seconds of delay used.
//   tech   line player: { id, label, shade } of the line-level defender whose technique
//          blocker is him (smallest |du|). Line-level defender: his own techniqueOf
//          { blocker, label, shade }. label '0','1','2','2i','3','4','4i','5','6','7','9';
//          shade 'head' | 'playside' | 'backside' of the defender vs. that blocker.
//   track  line player: { ids, lb }. ids = defenders within TRACK_HALF laterally and
//          0 < dy <= TRACK_DEPTH above him, nearest first; lb = first of them in `lbs`, else null.
//   lbs    line player: { [id]: state } for every second-level box defender at the snap.
//          'crossing' (in my track, |vx| >= FLOW_V and |vx| > -vy), 'covering' (vy >= DROP_V or
//          mirroring a back within MIRROR_DIST), 'filling' (-vy >= FILL_V and >= |vx|),
//          'flowing' (|vx| >= FLOW_V), else 'sitting'. First match wins.
//   felt   line-level defender: 'double' (2+ contacts), one contact: 'pass' (blocker vy <= -HAT_V),
//          'reach' (side*vx >= REACH_V), else 'base'; no contact: 'down' (across man tied up or moved
//          DOWN_MOVE away), 'pass' (across man vy <= -HAT_V), else 'none'.
//   hat    defender: mean line vy >= HAT_V 'low', <= -HAT_V 'high', else 'none'.
//   flow   defender: { kind: 'split' | 'fast' | 'slow' | 'none', dir } from mean line vx and the carrier's vx.
//   key    second-level box defender: { id } of the guard nearer his creation x.
import { LINE_ROLES } from './numbering.js';
import { HEAD_UP, LINE_DEPTH, shade } from './front.js';
import { TRACK_HALF } from './zone.js';

export { TRACK_HALF };
export const REACTION_DELAY = 0.2;
export const HISTORY_S = 1.0;
export const VEL_WINDOW = 0.1;
export const SIT_V = 0.8;
export const FILL_V = 1.5;
export const FLOW_V = 1.5;
export const DROP_V = 1.0;
export const REACH_V = 1.0;
export const HAT_V = 0.5;
export const FLOW_FAST = 3.0;
export const TRACK_DEPTH = 8;
export const MIRROR_DIST = 3;
export const MIRROR_V = 1.0;
export const DOWN_MOVE = 0.5;
export const BOX_OUTSIDE = 2.0;
export const BOX_COUNT_DEPTH = 7.0;

const EPS = 1e-9;
const LABELS = [['0', '1', '1'], ['2', '2i', '3'], ['4', '4i', '5'], ['6', '7', '9']];

const cmpId = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const isLine = (p) => p.team === 'offense' && LINE_ROLES.includes(p.role);
const byId = (snapshot, id) => snapshot.players.find((p) => p.id === id);

// The adapter: the only function that reads live player objects.
export function worldSnapshot(players, { t, los, side, carrierId = null }) {
  const out = [];
  const contacts = [];
  for (const p of players) {
    const e = { id: p.id, team: p.team, role: p.role, x: p.x, y: p.y };
    if (Number.isFinite(p.reaction)) e.reaction = p.reaction;
    out.push(e);
    if (p.block && p.block.engaged && p.block.target != null) contacts.push({ blocker: p.id, defender: p.block.target });
  }
  return { t, los, side, carrierId, players: out, contacts };
}

export function createPerception(snapshot, { centerId }) {
  const snap = {};
  for (const p of snapshot.players) snap[p.id] = { x: p.x, y: p.y };
  const lbIds = boxCount(snapshot).ids.filter((id) => byId(snapshot, id).y - snapshot.los > LINE_DEPTH);
  return { los: snapshot.los, side: snapshot.side, carrierId: snapshot.carrierId, centerId, snap, history: [snapshot], lbIds };
}

export function observe(state, snapshot) {
  const h = [...state.history, snapshot];
  const cutoff = snapshot.t - HISTORY_S;
  let keep = 0;
  for (let i = 0; i < h.length; i++) if (h[i].t <= cutoff + EPS) keep = i;
  state.history = h.slice(keep);
}

export function seenAt(state, t) {
  const h = state.history;
  let found = null;
  for (const s of h) if (s.t <= t + EPS) found = s;
  return found ?? h[0];
}

export function velocityOf(state, id, t) {
  const a = seenAt(state, t);
  const b = seenAt(state, t - VEL_WINDOW);
  const pa = byId(a, id);
  const pb = byId(b, id);
  if (a === b || !pa || !pb || a.t === b.t) return { x: 0, y: 0 };
  const dt = a.t - b.t;
  return { x: (pa.x - pb.x) / dt, y: (pa.y - pb.y) / dt };
}

// ---- technique ----

function lineSlots(snapshot, centerId) {
  const line = snapshot.players.filter(isLine).sort((a, b) => a.x - b.x || cmpId(a.id, b.id));
  const ci = line.findIndex((p) => p.id === centerId);
  if (ci < 0) return null;
  const slots = line.map((p, i) => ({ k: Math.abs(i - ci), x: p.x, player: p, ghost: false }));
  const left = line.slice(0, ci);
  const right = line.slice(ci + 1);
  for (const [arr, dir] of [[left, -1], [right, 1]]) {
    if (arr.length !== 2) continue;
    const outer = dir < 0 ? arr[0] : arr[1];
    const prev = dir < 0 ? arr[1] : arr[0];
    slots.push({ k: 3, x: outer.x + (outer.x - prev.x), player: outer, ghost: true });
  }
  return { slots, center: line[ci] };
}

export function techniqueOf(snapshot, defenderId, opts) {
  const t = techniqueFull(snapshot, defenderId, opts);
  return t ? { blocker: t.blocker, label: t.label, shade: t.shade } : null;
}

function techniqueFull(snapshot, defenderId, { centerId }) {
  const d = byId(snapshot, defenderId);
  if (!d || d.team !== 'defense' || d.y - snapshot.los > LINE_DEPTH) return null;
  const set = lineSlots(snapshot, centerId);
  if (!set) return null;
  let best = null;
  for (const s of set.slots) if (!best || Math.abs(d.x - s.x) < Math.abs(d.x - best.x) - EPS) best = s;
  const du = d.x - best.x;
  const toCenter = Math.sign(set.center.x - best.x);
  const col = Math.abs(du) <= HEAD_UP ? 0 : Math.sign(du) === toCenter ? 1 : 2;
  const cx = set.center.x;
  return {
    blocker: best.player.id,
    label: LABELS[best.k][col],
    shade: shade(snapshot.side * (best.player.x - cx), snapshot.side * (d.x - cx)),
    du,
  };
}

// ---- box ----

export function boxCount(snapshot) {
  const blockers = snapshot.players.filter((p) => isLine(p) && p.y >= snapshot.los - LINE_DEPTH);
  if (blockers.length === 0) return { count: 0, ids: [], blockers: [] };
  const lo = Math.min(...blockers.map((p) => p.x)) - BOX_OUTSIDE;
  const hi = Math.max(...blockers.map((p) => p.x)) + BOX_OUTSIDE;
  const box = snapshot.players
    .filter((p) => p.team === 'defense' && p.x >= lo && p.x <= hi && p.y - snapshot.los > 0 && p.y - snapshot.los <= BOX_COUNT_DEPTH)
    .sort((a, b) => a.x - b.x || cmpId(a.id, b.id));
  return { count: box.length, ids: box.map((p) => p.id), blockers: blockers.map((p) => p.id) };
}

// ---- cue pieces ----

function trackOf(view, me) {
  return view.players
    .filter((p) => p.team === 'defense' && Math.abs(p.x - me.x) <= TRACK_HALF && p.y - me.y > 0 && p.y - me.y <= TRACK_DEPTH)
    .sort((a, b) => (a.y - b.y) || cmpId(a.id, b.id))
    .map((p) => p.id);
}

function mirrorsBack(view, d, vOf, v) {
  return view.players.some((o) => {
    if (o.team !== 'offense' || LINE_ROLES.includes(o.role)) return false;
    if (Math.hypot(o.x - d.x, o.y - d.y) > MIRROR_DIST) return false;
    const ov = vOf(o.id);
    return Math.hypot(ov.x, ov.y) >= SIT_V && Math.hypot(ov.x - v.x, ov.y - v.y) <= MIRROR_V;
  });
}

function lbState(v, inTrack, mirrors) {
  if (inTrack && Math.abs(v.x) >= FLOW_V && Math.abs(v.x) > -v.y) return 'crossing';
  if (v.y >= DROP_V || mirrors) return 'covering';
  if (-v.y >= FILL_V && -v.y >= Math.abs(v.x)) return 'filling';
  if (Math.abs(v.x) >= FLOW_V) return 'flowing';
  return 'sitting';
}

function lbCue(state, view, me, track, vOf) {
  const out = {};
  for (const id of state.lbIds) {
    const d = byId(view, id);
    if (!d) continue;
    out[id] = lbState(vOf(id), track.includes(id), mirrorsBack(view, d, vOf, vOf(id)));
  }
  return out;
}

function feltCue(view, id, state, vOf) {
  const on = view.contacts.filter((c) => c.defender === id);
  if (on.length >= 2) return 'double';
  if (on.length === 1) {
    const v = vOf(on[0].blocker);
    if (v.y <= -HAT_V) return 'pass';
    return view.side * v.x >= REACH_V ? 'reach' : 'base';
  }
  const at = state.snap[id];
  const line = view.players.filter(isLine);
  let man = null;
  for (const p of line) {
    const s = state.snap[p.id];
    if (!s) continue;
    const dist = Math.hypot(s.x - at.x, s.y - at.y);
    if (!man || dist < man.dist - EPS) man = { p, s, dist };
  }
  if (!man) return 'none';
  const tiedUp = view.contacts.some((c) => c.blocker === man.p.id && c.defender !== id);
  const away = Math.sign(man.s.x - at.x);
  const moved = away === 0 ? Math.abs(man.p.x - man.s.x) : away * (man.p.x - man.s.x);
  if (tiedUp || moved >= DOWN_MOVE) return 'down';
  return vOf(man.p.id).y <= -HAT_V ? 'pass' : 'none';
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function hatCue(lineV) {
  const m = mean(lineV.map((v) => v.y));
  return m >= HAT_V ? 'low' : m <= -HAT_V ? 'high' : 'none';
}

function flowCue(lineV, carrierV) {
  const Lx = mean(lineV.map((v) => v.x));
  const Ly = mean(lineV.map((v) => v.y));
  const Bx = carrierV.x;
  const dirB = Math.sign(Bx);
  if (Math.abs(Bx) >= FLOW_V && Math.abs(Lx) >= FLOW_V / 2 && Math.sign(Bx) !== Math.sign(Lx)) return { kind: 'split', dir: dirB };
  if (Math.abs(Lx) >= FLOW_FAST && Math.abs(Bx) >= FLOW_FAST) return { kind: 'fast', dir: dirB };
  if (Math.abs(Lx) >= FLOW_V / 2 || Math.abs(Bx) >= FLOW_V || Ly >= HAT_V) {
    const dir = Math.abs(Bx) >= FLOW_V ? dirB : Math.abs(Lx) >= FLOW_V / 2 ? Math.sign(Lx) : 0;
    return { kind: 'slow', dir };
  }
  return { kind: 'none', dir: 0 };
}

function keyCue(state, view, id) {
  const cx = byId(view, state.centerId)?.x ?? 0;
  const guards = view.players
    .filter((p) => isLine(p) && p.id !== state.centerId)
    .sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx) || cmpId(a.id, b.id))
    .slice(0, 2);
  const at = state.snap[id];
  if (!guards.length || !at) return null;
  let best = guards[0];
  for (const g of guards) {
    const gs = state.snap[g.id] ?? g;
    const bs = state.snap[best.id] ?? best;
    if (Math.abs(gs.x - at.x) < Math.abs(bs.x - at.x) - EPS) best = g;
  }
  return { id: best.id };
}

function techCue(view, me, centerId) {
  if (me.team === 'defense') {
    return techniqueOf(view, me.id, { centerId });
  }
  let best = null;
  for (const d of view.players) {
    if (d.team !== 'defense') continue;
    const t = techniqueFull(view, d.id, { centerId });
    if (t && t.blocker === me.id && (!best || Math.abs(t.du) < Math.abs(best.du) - EPS)) best = { id: d.id, label: t.label, shade: t.shade, du: t.du };
  }
  return best ? { id: best.id, label: best.label, shade: best.shade } : null;
}

export function cuesFor(state, id) {
  const latest = state.history[state.history.length - 1];
  const mine = byId(latest, id);
  const delay = mine && Number.isFinite(mine.reaction) && mine.reaction >= 0 ? mine.reaction : REACTION_DELAY;
  const seen = seenAt(state, latest.t - delay);
  const view = { ...seen, players: seen.players.map((p) => (p.id === id ? mine : p)) };
  const me = byId(view, id);
  const vOf = (pid) => velocityOf(state, pid, seen.t);
  const lineV = view.players.filter(isLine).map((p) => vOf(p.id));
  const cues = { seen: seen.t, delay, tech: null, track: null, lbs: null, felt: null, hat: null, flow: null, key: null };
  if (!me) return cues;
  const centerId = state.centerId;
  cues.tech = techCue(view, me, centerId);
  if (isLine(me)) {
    const ids = trackOf(view, me);
    cues.lbs = lbCue(state, view, me, ids, vOf);
    cues.track = { ids, lb: ids.find((d) => Object.hasOwn(cues.lbs, d)) ?? null };
  }
  if (me.team === 'defense') {
    if (me.y - view.los <= LINE_DEPTH) cues.felt = feltCue(view, id, state, vOf);
    cues.hat = hatCue(lineV);
    cues.flow = flowCue(lineV, state.carrierId != null ? vOf(state.carrierId) : { x: 0, y: 0 });
    if (state.lbIds.includes(id)) cues.key = keyCue(state, view, id);
  }
  return cues;
}

export function perceiveAll(state) {
  const latest = state.history[state.history.length - 1];
  const out = {};
  for (const p of latest.players) out[p.id] = cuesFor(state, p.id);
  return out;
}
