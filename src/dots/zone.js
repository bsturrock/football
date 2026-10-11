// Inside zone: a rule table run by the assignment engine, plus the runtime switch rule.
import { readFront, HEAD_UP } from './front.js';
import { runScheme, CLIMB_REACH } from './assign.js';
import { LB_ROLES } from './roster.js';

export { LINE_DEPTH } from './front.js';
export const SWITCH_DIST = 2.0;
// the longer-held blocker on the DL must have held him this long before the climber leaves, and the stayer must be on him; a late-engaging stayer no longer delays a climber who has held since early
export const COMBO_HOLD = 0.3;
// F-3: a climb off a double that has been on together at least this long while the LB attacks downhill (the LB's own commit and speed decide, no fixed meet depth)
export const COMBO_TOUCH = 0.1;
// F-3: the LB counts as attacking downhill (a fill) at this speed toward the line, yd/s; a filling LB runs about 3.5, a flowing one mostly sideways
export const LB_FILL_V = 1.5;
// Human track rule: a blocker owns the vertical runway this far either side of him; a committed LB in a member's track (or across his face) is what releases the climber. A passive LB never does.
export const TRACK_HALF = 1.5;

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

export function zoneSwitch(players, ballPos, ctx) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out = [];
  const claimed = claimedSet(players);
  const mid = (c) => {
    const o = byId.get(c.owner), p = byId.get(c.partner);
    return o && p ? (o.x + p.x) / 2 : 0;
  };
  const combos = [...((ctx && ctx.combos) || [])]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ctx.side * mid(b.c) - ctx.side * mid(a.c) || a.i - b.i)
    .map((e) => e.c);
  for (const c of combos) {
    const o = byId.get(c.owner);
    const p = byId.get(c.partner);
    if (!o || !p) continue;
    if (o.block?.target !== c.target || p.block?.target !== c.target) continue; // already switched
    const dl = byId.get(c.target);
    const on = (x) => x.block?.target === c.target && x.block.engaged;
    const plan = byId.get(c.watch);
    const free = unclaimedInReach(players, ballPos, ctx, claimed, mid(c));
    let w = plan && !claimed.has(plan.id) ? plan : null;
    if (w) {
      const best = free.find((d) => d !== w);
      if (best && dangerOf(w, ballPos, ctx) - dangerOf(best, ballPos, ctx) > DANGER_MARGIN) w = best;
    } else w = free[0] ?? null;
    if (!w) continue;
    claimed.add(w.id);
    // The climber is re-judged every tick from where the linebacker fits; nothing is locked.
    const go = () => {
      if (!dl || dl.react?.state === 'winning') return;
      const fitX = ctx.defGoals?.[w.id]?.x ?? w.x;
      const taker = pickClimber(o, p, dl, fitX, ctx.side);
      const stayer = taker === o ? p : o;
      if (!on(stayer)) return;
      const dO = Math.hypot(w.x - o.x, w.y - o.y);
      const dP = Math.hypot(w.x - p.x, w.y - p.y);
      const forced = Math.min(dO, dP) <= SWITCH_DIST; // a blitzing or fast-filling LB is on top of the double
      let ok = forced;
      if (!ok && ctx.committed?.[w.id]) {
        const inTrack = Math.abs(w.x - o.x) <= TRACK_HALF || Math.abs(w.x - p.x) <= TRACK_HALF;
        // a climber who has not yet reached the DL has nothing to leave: the hold is the stayer's alone
        const joint = on(o) && on(p) ? Math.min(o.block.held ?? 0, p.block.held ?? 0) : stayer.block.held ?? 0;
        const vy = -((w.selfVel ?? w.vel ?? { y: 0 }).y ?? 0);
        ok = inTrack && ((joint >= COMBO_TOUCH - 1e-9 && vy >= LB_FILL_V - 1e-9) || joint >= COMBO_HOLD - 1e-9); // the committed LB is in a member's track: attacking, or the DL is controlled
      }
      if (ok) out.push({ blocker: taker.id, target: w.id });
    };
    go();
  }
  return out;
}

// Who climbs: the blocker on the side of the DL where the linebacker fits comes off, the other overtakes.
export function pickClimber(o, p, dl, fitX, side) {
  const near = () => (Math.abs(p.x - fitX) < Math.abs(o.x - fitX) - 1e-9 ? p : o);
  if (!dl || (side !== 1 && side !== -1)) return near();
  const s = side * (fitX - dl.x);
  const playsideP = side * p.x > side * o.x ? p : o;
  const backsideP = playsideP === p ? o : p;
  if (s > HEAD_UP) return playsideP;
  if (s < -HEAD_UP) return backsideP;
  return near();
}
