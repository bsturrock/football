// Inside zone: a rule table run by the assignment engine, plus the runtime switch rule.
import { readFront, HEAD_UP } from './front.js';
import { runScheme } from './assign.js';

export { LINE_DEPTH } from './front.js';
export const SWITCH_DIST = 2.0;
// the longer-held blocker on the DL must have held him this long before the climber leaves, and the stayer must be on him; a late-engaging stayer no longer delays a climber who has held since early
export const COMBO_HOLD = 0.3;

const row = (r) => Object.freeze(r);
export const INSIDE_ZONE = Object.freeze({
  rules: Object.freeze([
    row({ when: 'covered', at: 'backEnd', tech: 'cutoff' }), // backside tackle covered: cut him off
    row({ when: 'covered', tech: 'zone' }), // covered: block the man over you
    row({ when: 'double', tech: 'combo' }), // uncovered: double the playside neighbour's man, watch the LB
    row({ when: 'climb', tech: 'climb' }), // two uncovered: climb to the linebacker
    row({ when: 'cutoff', tech: 'cutoff' }), // otherwise cut off the backside
  ]),
});

export function zonePlan(players, numbers, los) {
  const front = readFront(players, numbers, los);
  const { side, blocks, techs, combos, free } = runScheme(front, INSIDE_ZONE);
  return { side, blocks, techs, combos, free, front };
}

export function zoneSwitch(players, ballPos, ctx) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out = [];
  for (const c of (ctx && ctx.combos) || []) {
    const o = byId.get(c.owner);
    const p = byId.get(c.partner);
    const w = byId.get(c.watch);
    if (!o || !p || !w) continue;
    if (o.block?.target === c.watch || p.block?.target === c.watch) continue;
    const dl = byId.get(c.target);
    const on = (x) => x.block?.target === c.target && x.block.engaged;
    // The climber is re-judged every tick from where the linebacker fits; nothing is locked.
    const go = () => {
      if (!dl || dl.react?.state === 'winning') return;
      const fitX = ctx.defGoals?.[c.watch]?.x ?? w.x;
      const taker = pickClimber(o, p, dl, fitX, ctx.side);
      const stayer = taker === o ? p : o;
      if (!on(stayer)) return;
      const held = Math.max(...[o, p].filter(on).map((x) => x.block.held ?? 0));
      if (held >= COMBO_HOLD - 1e-9) out.push({ blocker: taker.id, target: w.id });
    };
    if (ctx.committed?.[c.watch]) go();
    else {
      const dO = Math.hypot(w.x - o.x, w.y - o.y);
      const dP = Math.hypot(w.x - p.x, w.y - p.y);
      if (Math.min(dO, dP) <= SWITCH_DIST) go();
    }
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
