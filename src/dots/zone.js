// Inside zone: a rule table run by the assignment engine, plus the runtime switch rule.
import { readFront } from './front.js';
import { runScheme } from './assign.js';

export { LINE_DEPTH } from './front.js';
export const SWITCH_DIST = 2.0;
// the blocker who stays must have held the DL this long before his partner climbs
export const COMBO_HOLD = 0.5;

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
    const holds = (x) =>
      x.block?.target === c.target && x.block.engaged && (x.block.held ?? 0) >= COMBO_HOLD - 1e-9;
    // The climber is fixed the first tick a trigger fires and kept (ctx.climbers) until the combo switches;
    // positions drifting must not hand the climb to the other blocker.
    const go = (pick) => {
      const locked = ctx.climbers?.[c.owner];
      const taker = locked === o.id ? o : locked === p.id ? p : pick;
      if (dl && dl.react?.state !== 'winning' && holds(taker === o ? p : o)) out.push({ blocker: taker.id, target: w.id });
      else if (!locked) ctx.climbers = { ...ctx.climbers, [c.owner]: taker.id };
    };
    const cm = ctx.committed?.[c.watch];
    if (cm) {
      const dxO = Math.abs(o.x - cm.x);
      const dxP = Math.abs(p.x - cm.x);
      go(dxP < dxO - 1e-9 ? p : o);
      continue;
    }
    const dO = Math.hypot(w.x - o.x, w.y - o.y);
    const dP = Math.hypot(w.x - p.x, w.y - p.y);
    if (Math.min(dO, dP) > SWITCH_DIST) continue;
    const lo = Math.abs(o.x - w.x);
    const lp = Math.abs(p.x - w.x);
    go(lp < lo - 1e-9 ? p : o);
  }
  return out;
}
