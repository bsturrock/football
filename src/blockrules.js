import { C, CBs, DEF, EXTRA, LBs, LG, LT, OFF, RG, RT, SFs, TE, WRs } from './players.js';
import { S } from './state.js';

// ---------- block rules (B-007-6) ----------
// Each blocker's job is a list of rules, tried in order; the first rule that finds an unclaimed defender wins. resolveBlocks reads them
// against the front the play is actually facing, once at the snap (and once more after the handoff), and writes the target into p.blk
// and a name log into S.blk; offense.js keeps that man (locked once engaged, kept all play), so nothing here runs per frame.
// Rules are written for the base side (the play's hole to -x, tight end +x) and mirrored by flip: only the blocker names swap, since
// a rule reads the defenders by where they stand.  Rule = [kind, arg]:
//   on       the man covering me: within COVERED_DX of me at the line (COVERED_DY)
//   down     nearest line man toward the hole from me (head up counts)
//   reach    outside shade: the line man on the playside of me, nearest REACH_AIM out
//   edge     the outermost line man on the playside (the kick-out man; B-007-8 makes it a real kick)
//   backer   ['backer','mike'] the linebacker nearest the center; ['backer','ps'] the one nearest the hole on the playside
//   boxS     the safety rolled into the box on the playside
//   deep     the safety nearest me;  corner  the corner covering me;  any  nearest man in the box
export const COVERED_DX = 1.0, COVERED_DY = 2.5, REACH_DX = 3.5, REACH_AIM = 2.0, BOX_Y = 7, BOX_X = 8;
const MIRROR = {LT:'RT', RT:'LT', LG:'RG', RG:'LG'};
const bodyOf = n => ({LT, LG, C, RG, RT, TE, WR0:WRs[0], WR1:WRs[1], WR2:WRs[2], FB:EXTRA.find(e => e.pos === 'FB'), TE2:EXTRA.find(e => e.pos === 'TE')})[n];
const inBox = d => d.role === 'DL' || d.role === 'LB' || !!d.fit;
const nearest = (list, f) => { let best = null, bd = 1e9; for(const d of list){ const k = f(d); if(k < bd){ bd = k; best = d; } } return best; };
export const labels = () => {
  const m = new Map();
  [['DL', DEF.filter(d => d.role === 'DL')], ['LB', LBs], ['CB', CBs], ['S', SFs]].forEach(([n, l]) => [...l].sort((a, b) => a.x - b.x).forEach((d, i) => m.set(d, n + i)));
  return m;
};

// the defender a rule picks for blocker p among `free` (unclaimed), or null
function pick(rule, p, free, ctx){
  const {los, h, ps} = ctx, line = free.filter(d => d.role === 'DL' || (d.fit && d.y - los <= COVERED_DY) || d.y - los <= COVERED_DY), dx = d => d.x - p.x;
  switch(rule[0]){
    case 'on': return nearest(line.filter(d => Math.abs(dx(d)) <= COVERED_DX + 1e-6 && d.y - los <= COVERED_DY), d => Math.abs(dx(d)));
    case 'down': { const dir = Math.sign(h - p.x) || ps; return nearest(line.filter(d => d.y - los <= COVERED_DY && dx(d)*dir >= -COVERED_DX - 1e-6), d => Math.hypot(dx(d), d.y - p.y)); }
    case 'reach': return nearest(line.filter(d => dx(d)*ps >= -0.3 && dx(d)*ps <= REACH_DX), d => Math.abs(d.x - (p.x + ps*REACH_AIM)));
    case 'edge': return nearest(line, d => d.x*-ps);
    case 'backer': {
      const lbs = free.filter(d => d.role === 'LB');
      if(rule[1] === 'mike') return nearest(lbs, d => Math.abs(d.x));
      return nearest(lbs.filter(d => d.x*ps > -1.5), d => Math.abs(d.x - h));
    }
    case 'boxS': return free.find(d => d.fit && d.role === 'S' && Math.sign(d.x) === ps) || null;
    case 'deep': return nearest(free.filter(d => d.role === 'S'), d => Math.abs(d.x - p.x));
    case 'corner': return free.find(d => d.role === 'CB' && d.assign === p) || null;
    case 'any': return nearest(free.filter(d => inBox(d) && d.y - los <= BOX_Y && Math.abs(d.x) <= BOX_X), d => Math.hypot(dx(d), d.y - p.y));
  }
  return null;
}
// the blockers of a play, in the order they claim: linemen and tight end nearest the hole first, then the extras, then the receivers
function blockers(rules, flip){
  const order = n => n === 'FB' || n === 'TE2' ? 1 : n.startsWith('WR') ? 2 : 0, h = S.hole;
  return Object.entries(rules).map(([n, spec]) => { const name = flip > 0 ? n : MIRROR[n] || n; return {name, p:bodyOf(name), spec, o:order(n)}; }).filter(b => b.p)
    .sort((a, b) => a.o - b.o || Math.abs(a.p.x - h) - Math.abs(b.p.x - h));
}
// again: after the handoff. Engaged (locked) men and pullers keep theirs; everyone else is read against where the defense is now.
export function resolveBlocks(play, flip, again = false){
  const rules = play.src.rules; if(!rules) return;
  const los = S.los, h = S.hole = play.hole ?? 0, ps = Math.sign(h) || 1, ctx = {los, h, ps};
  const bl = blockers(rules, flip);
  const keep = p => again && p.blk && p.blk.stun <= 0 && (p.locked || (p.via && p.via.length));
  for(const b of bl) if(!keep(b.p)) b.p.blk = null;
  const claimed = new Set(OFF.map(o => o.blk).filter(Boolean));
  const take = (b, d) => { b.p.blk = d; claimed.add(d); };
  const free = () => DEF.filter(d => d.stun <= 0 && !claimed.has(d));
  for(let k = 0; k < 3; k++) for(const b of bl){
    if(b.p.blk || !b.spec[k]) continue;
    const d = pick(b.spec[k], b.p, free(), ctx); if(d) take(b, d);
  }
  for(const b of bl){   // a lineman or tight end with nothing named takes the nearest man in the box
    if(b.p.blk || b.o) continue;
    const d = pick(['any'], b.p, free(), ctx); if(d) take(b, d);
  }
  const lab = labels(); S.blk = Object.fromEntries(bl.map(b => [b.name, b.p.blk ? lab.get(b.p.blk) || '?' : null]));
}
