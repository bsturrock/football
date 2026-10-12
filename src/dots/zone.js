// Inside zone: a rule table run by the assignment engine, plus the runtime switch rule.
import { readFront, LINE_DEPTH } from './front.js';
import { runScheme, CLIMB_REACH } from './assign.js';
import { LB_ROLES } from './roster.js';
import { ballPast, project } from './geometry.js';

export { LINE_DEPTH } from './front.js';
export const SWITCH_DIST = 2.0;
// F-55: a combo comes off its DL only when the watched LB declares (see zoneSwitch), and then only after the pair has been on the DL together this long
export const COMBO_TOUCH = 0.1;
// F-55: while the LB sits the pair rides the DL; this many yd past the LOS the LB is forced to choose and the man on his side comes off
export const RIDE_DEPTH = 5.0;
// Human track rule: a blocker owns the vertical runway this far either side of him; an LB who declares in a member's track (or across his face) is what releases the climber. A sitting LB never does.
export const TRACK_HALF = 1.5;
// F-55 #8: an LB is leaving the play only when all three hold: he is backside of the climber's track (beyond TRACK_HALF), he moves away from the playside at least LB_AWAY_V (yd/s), and he runs laterally faster than he fills downhill. An LB who attacks downhill is walled off instead (climb-spec: "LB suddenly attacks downhill: square up and drive/wall off"). Human: "let the LB leave the play and look for more dangerous players to block".
export const LB_AWAY_V = 1.5;
// T-94: how far ahead (s) the double projects the LB's motion when deciding who climbs (tunable)
export const PICK_LEAD = 0.2;
// T-94: how much nearer (yd) the LB's projected spot the partner must be before he climbs instead of the uncovered owner (tunable; judged by eye)
export const PICK_PRIOR = 0.3;

const row = (r) => Object.freeze(r);
export const INSIDE_ZONE = Object.freeze({
  rules: Object.freeze([
    row({ when: 'covered', at: 'backEnd', tech: 'cutoff' }), // backside end lineman: block the end man (F-54 #5 / R-5: plain inside zone never leaves him)
    row({ when: 'covered', tech: 'zone' }), // covered: block the man over you
    row({ when: 'double', tech: 'combo' }), // uncovered: double the playside neighbour's man, watch the LB
    row({ when: 'climb', tech: 'climb' }), // two uncovered: climb to the linebacker
    row({ when: 'cutoff', tech: 'cutoff' }), // otherwise cut off the backside
  ]),
});

// Zone read: the quarterback reads the backside end man, so a man-short line leaves him and the end lineman climbs. Not used by any play yet.
export const ZONE_READ = Object.freeze({
  rules: Object.freeze([
    row({ when: 'spare', at: 'backEnd', tech: 'climb' }), // man short: leave the backside end man, climb to the free linebacker
    ...INSIDE_ZONE.rules,
  ]),
});

// How each box defender is accounted for, by what the offense does about him (box = ids from boxCount, else every numbered defender):
// - block: a lineman's block target is he (by = those linemen);
// - watch: nobody blocks him and a combo's watch is he (by = the combo's owner and partner);
// - read: under a scheme with the spare row, the end lineman left the edge man to the quarterback (he is front.edge and free; by = []);
// - free: none of these, including box defenders runScheme did not number (by = []).
export function zonePlan(players, numbers, los, { scheme = INSIDE_ZONE, box = null } = {}) {
  const front = readFront(players, numbers, los);
  const plan = runScheme(front, scheme);
  const { blocks, combos, free, techs } = plan;
  const end = front.line[front.line.length - 1];
  const spared = scheme.rules.some((r) => r.when === 'spare') && front.edge != null && end != null
    && techs[end.id]?.tech === 'climb' && blocks[end.id] !== front.edge && free.includes(front.edge);
  const accounted = {};
  for (const id of box ?? front.defenders.map((d) => d.id)) {
    const by = Object.keys(blocks).filter((k) => blocks[k] === id);
    const watcher = combos.find((c) => c.watch === id);
    if (by.length) accounted[id] = { how: 'block', by };
    else if (watcher) accounted[id] = { how: 'watch', by: [watcher.owner, watcher.partner] };
    else if (spared && id === front.edge) accounted[id] = { how: 'read', by: [] };
    else accounted[id] = { how: 'free', by: [] };
  }
  return { ...plan, front, accounted };
}

// Danger to the ball: how far the linebacker's fit point (his live goal, else where he stands) is from the ball. Smaller is more dangerous; no ball, no difference.
export const DANGER_MARGIN = 1.0;
const fitOf = (d, ctx) => ctx?.defGoals?.[d.id] ?? d;
export function dangerOf(d, ballPos, ctx) {
  if (!ballPos) return 0;
  const f = fitOf(d, ctx);
  return Math.hypot(f.x - ballPos.x, f.y - ballPos.y);
}

// Every id a blocker is currently blocking, plus any extra ids.
export function claimedSet(players, extra = []) {
  const s = new Set(extra);
  for (const p of players) if (p.block?.target != null) s.add(p.block.target);
  return s;
}

// Unclaimed linebackers whose fit is within CLIMB_REACH of x, most dangerous first (stable on ties).
export function unclaimedInReach(players, ballPos, ctx, claimed, x) {
  return players
    .filter((d) => LB_ROLES.includes(d.role) && !claimed.has(d.id) && Math.abs(fitOf(d, ctx).x - x) <= CLIMB_REACH)
    .map((d, i) => ({ d, i, k: dangerOf(d, ballPos, ctx) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((e) => e.d);
}

// F-55: an LB declares when either member sees him crossing his face, or filling/crossing inside his track (cues only)
const declaredFor = (o, p, ctx) => (d) => !!d && [o, p].some((m) => {
  const cu = ctx.cues?.(m.id);
  const st = cu?.lbs?.[d.id];
  return st === 'crossing' || (st === 'filling' && !!cu.track?.ids?.includes(d.id));
});

// The LB a combo watches this tick (or null). Precedence:
// 1. an unclaimed LB who has declared (plan watch first, then `free` order): an LB who fills into my track is mine, whoever the plan watched;
// 2. else the unclaimed plan watch, unless the most dangerous other free LB beats him by more than DANGER_MARGIN;
// 3. else (no unclaimed plan watch) the most dangerous unclaimed LB in reach.
// If the danger choice is itself declared it is kept.
function watchFor(plan, free, claimed, ballPos, ctx, declaredBy) {
  let w = plan && !claimed.has(plan.id) ? plan : null;
  if (w) {
    const best = free.find((d) => d !== w);
    if (best && dangerOf(w, ballPos, ctx) - dangerOf(best, ballPos, ctx) > DANGER_MARGIN) w = best;
  } else w = free[0] ?? null;
  if (!declaredBy(w)) w = [plan, ...free].find((d) => d && !claimed.has(d.id) && declaredBy(d)) ?? w;
  return w;
}

export function zoneSwitch(players, ballPos, ctx) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const side = ctx?.side === -1 ? -1 : 1;
  const out = [];
  const claimed = claimedSet(players);
  const mid = (c) => {
    const o = byId.get(c.owner), p = byId.get(c.partner);
    return o && p ? (o.x + p.x) / 2 : 0;
  };
  const combos = [...((ctx && ctx.combos) || [])]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => side * mid(b.c) - side * mid(a.c) || a.i - b.i)
    .map((e) => e.c);
  for (const c of combos) {
    const o = byId.get(c.owner);
    const p = byId.get(c.partner);
    if (!o || !p) continue;
    if (o.block?.target !== c.target || p.block?.target !== c.target) continue; // already switched
    const dl = byId.get(c.target);
    const on = (x) => x.block?.target === c.target && x.block.engaged;
    const declaredBy = declaredFor(o, p, ctx);
    // T-76: the double drove the DL past him: an LB at or under the DL's depth who has not declared is not worth climbing to
    // (going sideways or backwards); keep driving the DL, or take an LB still upfield. A declared LB (filling into a
    // member's track, crossing his face: a blitzing or fast-filling LB) is taken wherever he is.
    const behind = (d) => !!d && !!dl && d.y <= dl.y && !declaredBy(d);
    const planAll = byId.get(c.watch);
    const plan = behind(planAll) ? null : planAll;
    const free = unclaimedInReach(players, ballPos, ctx, claimed, mid(c)).filter((d) => !behind(d));
    const w = watchFor(plan, free, claimed, ballPos, ctx, declaredBy);
    if (!w) continue;
    claimed.add(w.id);
    // The climber is re-judged every tick from where the linebacker is; nothing is locked.
    const go = () => {
      if (!dl || dl.react?.state === 'winning') return;
      const taker = pickClimber(o, p, w);
      const stayer = taker === o ? p : o;
      if (!on(stayer)) return;
      const dO = Math.hypot(w.x - o.x, w.y - o.y);
      const dP = Math.hypot(w.x - p.x, w.y - p.y);
      const forced = Math.min(dO, dP) <= SWITCH_DIST; // a blitzing or fast-filling LB is on top of the double
      const declared = declaredBy(w);
      const bothOn = on(o) && on(p);
      // a climber who has not yet reached the DL has nothing to leave: the hold is the stayer's alone
      const joint = bothOn ? Math.min(o.block.held ?? 0, p.block.held ?? 0) : stayer.block.held ?? 0;
      const ride = bothOn && !declared && ctx.los != null && dl.y >= ctx.los + RIDE_DEPTH - 1e-9; // the LB sat as long as the pair could ride
      const ok = forced || (declared && joint >= COMBO_TOUCH - 1e-9) || ride;
      if (ok) out.push({ blocker: taker.id, target: w.id });
    };
    go();
  }
  // F-55 #8, the human: "why would this ever happen? let the LB leave the play and look for more dangerous players to block".
  // One rule for every unengaged climber (combo member or single, released blocks too): he drops his LB once the LB is gone,
  // and takes the most dangerous unclaimed LB in reach who is not gone either (none: he keeps his man).
  // Gone = clearly outside the climber's track on the backside, running away from the play (not filling downhill: see LB_AWAY_V);
  // P-3: or the ball is already past him (RELEASE_PAST upfield), so the climber looks for other work.
  const leaving = (lb, from) => {
    const v = lb.selfVel ?? lb.vel ?? { x: 0, y: 0 };
    const away = -side * v.x;
    return side * (lb.x - from.x) < -TRACK_HALF && away >= LB_AWAY_V && away > -v.y;
  };
  const lbGone = (lb, from) => leaving(lb, from) || (ballPos != null && ballPast(lb, ballPos));
  const gone = new Set(out.map((e) => e.blocker));
  for (const m of players) {
    const t = m.block?.target;
    if (t == null || m.block.engaged || gone.has(m.id)) continue;
    const lb = byId.get(t);
    if (!lb || !LB_ROLES.includes(lb.role) || !lbGone(lb, m)) continue;
    const next = unclaimedInReach(players, ballPos, ctx, claimed, m.x).find((d) => d.id !== lb.id && !lbGone(d, m));
    if (!next) continue;
    out.push({ blocker: m.id, target: next.id });
    claimed.add(next.id);
    gone.add(m.id);
  }
  trackPickup(players, ballPos, ctx, out, claimed);
  return out;
}

// F-55 #3, the human's track rule: a lineman blocks a track (a runway), not a man; whoever enters it is his.
// Line-level defenders are those within LINE_DEPTH of the LOS when the rule first runs (the snap), kept per play in ctx.
const lineLevel = new WeakMap();
function lineIds(players, ctx) {
  let ids = lineLevel.get(ctx);
  if (!ids) {
    ids = new Set(players.filter((p) => p.team === 'defense' && ctx.los != null && p.y - ctx.los <= LINE_DEPTH).map((p) => p.id));
    lineLevel.set(ctx, ids);
  }
  return ids;
}

// A line defender who left his blocker's track into another blocker's becomes that blocker's man; the vacated blocker
// takes the line defender now in his own track, else climbs (his track's LB, else the nearest unclaimed in reach).
// Appends retargets to `out`; nobody retargets twice per tick, a defender gets one new blocker per tick.
export function trackPickup(players, ballPos, ctx, out, claimed = claimedSet(players)) {
  if (!ctx?.cues || ctx.los == null) return out;
  const line = lineIds(players, ctx);
  const side = ctx.side === -1 ? -1 : 1;
  const done = new Set(out.map((e) => e.blocker)); // retargeted this tick
  const tracks = new Map(); // blocker id -> track ids
  const blockers = players.filter((p) => p.block && p.block.target != null && !p.block.released).filter((p) => {
    const t = ctx.cues(p.id)?.track;
    if (t) tracks.set(p.id, t.ids);
    return !!t;
  });
  const target = new Map(blockers.map((b) => [b.id, b.block.target])); // live targets as retargets are decided
  for (const e of out) if (target.has(e.blocker)) target.set(e.blocker, e.target);
  const holders = (id) => blockers.filter((b) => target.get(b.id) === id);
  const inTrack = (b, id) => tracks.get(b.id).includes(id);
  const order = (a, b) => side * b.x - side * a.x || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  const fresh = new Set(); // defenders who got a new blocker this tick
  const vacated = [];
  const cands = players.filter((d) => d.team === 'defense' && line.has(d.id)).sort(order);
  for (const d of cands) {
    const cur = holders(d.id);
    if (!cur.length || cur.some((b) => inTrack(b, d.id))) continue; // free, or still in his blocker's track
    const takers = blockers.filter((b) => !done.has(b.id) && !cur.includes(b) && inTrack(b, d.id) && !(() => {
      const e = target.get(b.id);
      const eng = b.block.engaged && e !== d.id && inTrack(b, e) && line.has(e);
      return eng && holders(e).length === 1; // two men in one track: the nearer stays his, unless he is double-teamed
    })());
    if (!takers.length) continue;
    takers.sort((a, b) => Math.abs(a.x - d.x) - Math.abs(b.x - d.x) || order(a, b));
    const x = takers[0];
    out.push({ blocker: x.id, target: d.id });
    done.add(x.id);
    fresh.add(d.id);
    target.set(x.id, d.id);
    for (const b of cur) if (!done.has(b.id)) vacated.push(b);
  }
  vacated.sort(order);
  for (const v of vacated) {
    if (done.has(v.id)) continue;
    const mine = tracks.get(v.id);
    const taken = (id) => holders(id).some((b) => b !== v);
    let pick = mine.map((id) => players.find((p) => p.id === id)).find((d) => d && line.has(d.id) && !fresh.has(d.id) && d.id !== v.block.target && !taken(d.id));
    if (!pick) {
      const was = new Set(blockers.map((b) => b.block.target)); // claims this rule just rewrote are read from `target` instead
      const live = new Set([...claimed].filter((id) => !was.has(id)));
      for (const [b, t] of target) if (b !== v.id) live.add(t);
      const cu = ctx.cues(v.id);
      const lb = mine.find((id) => Object.hasOwn(cu.lbs ?? {}, id) && !live.has(id));
      pick = lb ? players.find((p) => p.id === lb) : unclaimedInReach(players, ballPos, ctx, live, v.x)[0];
    }
    if (!pick) continue;
    out.push({ blocker: v.id, target: pick.id });
    done.add(v.id);
    target.set(v.id, pick.id);
  }
  return out;
}

// Who climbs: the LB's direction decides (his spot PICK_LEAD ahead, same blocker-side velocity read as the climb row). The uncovered owner is the default; the partner climbs only when nearer that spot by more than PICK_PRIOR.
export function pickClimber(o, p, lb) {
  const q = project(lb, lb.selfVel ?? lb.vel, PICK_LEAD);
  return Math.abs(o.x - q.x) - Math.abs(p.x - q.x) > PICK_PRIOR + 1e-9 ? p : o;
}
