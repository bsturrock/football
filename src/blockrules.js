import { C, CBs, DEF, EXTRA, LBs, LG, LT, OFF, RG, RT, SFs, TE, WRs } from './players.js';
import { S } from './state.js';
import { dist } from './util.js';

// ---------- block rules (B-007-6) ----------
// Each blocker's job is a list of rules, tried in order; the first rule that finds an unclaimed defender wins. resolveBlocks reads them
// against the front the play is actually facing, once at the snap (and once more after the handoff), and writes the target into p.blk
// and a name log into S.blk; offense.js keeps that man (locked once engaged, kept all play), so nothing here runs per frame.
// Rules are written for the base side (the play's hole to -x, tight end +x) and mirrored by flip: only the blocker names swap, since
// a rule reads the defenders by where they stand.  Rule = [kind, arg]:
//   on       the man covering me: within COVERED_DX of me at the line (COVERED_DY)
//   line     the nearest line man within LANE_DX of my lane (p.lane on a zone play, else where I stand; today's zone window: a man shaded between two of us goes to the nearer
//            claimer in claim order, so a back-side guard is not sent after the man the center should take)
//   down     nearest line man toward the hole from me (head up counts)
//   reach    outside shade: the line man on the playside of me, nearest REACH_AIM out
//   edge     the outermost line man on the playside (the kick-out man; B-007-8 makes it a real kick)
//   backer   ['backer','mike'] the linebacker nearest the center; ['backer','ps'] the one nearest the hole on the playside;
//            ['backer','near'] the one nearest me (a tie goes away from the hole)
//   boxS     the safety rolled into the box on the playside
//   double   ['double','playside'|'backside'|<blocker name>]: I have nobody on me, so I join the neighbour on that side against the line man covering him (the neighbour is the post man and keeps him; I
//            am the climber). Not offered when I am covered, or when the neighbour is already in a double
//   deep     the safety nearest me;  corner  the corner covering me;  any  nearest man in the box within ANY_DX of me (nobody is sent across the formation)
// Double team (B-007-7). Per blocker p.dbl = {d, mate, post, t, state}, absent = single. States: double (two men drive d) -> climbing (the climber has gone to a
// linebacker, the post man is single again) or released (d is down, or the pair was never completed). The climber leaves after CLIMB_T engaged on d, or at once
// (once engaged) when a linebacker is within CLIMB_NEAR of d or of him, or one within CLIMB_RANGE has committed (downhill at COMMIT_V of his run speed), for the nearest unblocked linebacker within CLIMB_RANGE of him; none in range, he stays on d.
export const CLIMB_T = 0.5, CLIMB_NEAR = 2.5, CLIMB_RANGE = 6, ENGAGED = 1.4, COMMIT_V = 0.5;   // COMMIT_V: a linebacker moving downhill (toward the line) faster than this share of his own run speed has committed
export const COVERED_DX = 1.0, COVERED_DY = 2.5, REACH_DX = 3.5, REACH_AIM = 2.0, BOX_Y = 7, BOX_X = 8, ANY_DX = 5, LANE_DX = 1.8, ZONE_KEEP = 3;   // ZONE_KEEP: offense.js zoneBlock drops an unengaged, unruled target this far from the lane
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
  const {los, h, ps} = ctx, line = free.filter(d => d.role === 'DL' || d.y - los <= COVERED_DY), dx = d => d.x - p.x;
  switch(rule[0]){
    case 'on': return nearest(line.filter(d => Math.abs(dx(d)) <= COVERED_DX + 1e-6 && d.y - los <= COVERED_DY), d => Math.abs(dx(d)));
    case 'line': { const lane = p.lane ?? p.x; return nearest(line.filter(d => Math.abs(d.x - lane) < LANE_DX), d => Math.hypot(dx(d), d.y - p.y)); }
    case 'down': { const dir = Math.sign(h - p.x) || ps; return nearest(line.filter(d => d.y - los <= COVERED_DY && dx(d)*dir >= -COVERED_DX - 1e-6), d => Math.hypot(dx(d), d.y - p.y)); }
    case 'reach': return nearest(line.filter(d => dx(d)*ps >= -0.3 && dx(d)*ps <= REACH_DX), d => Math.abs(d.x - (p.x + ps*REACH_AIM)));
    case 'edge': return nearest(line, d => d.x*-ps);
    case 'backer': {
      const lbs = free.filter(d => d.role === 'LB');
      if(rule[1] === 'mike') return nearest(lbs, d => Math.abs(d.x));
      if(rule[1] === 'near') return nearest(lbs, d => Math.abs(dx(d)) + (Math.sign(d.x) === ps ? 0.01 : 0));   // straight up from where I stand; a tie goes away from the hole, so a climber doesn't cross it
      return nearest(lbs.filter(d => d.x*ps > -1.5), d => Math.abs(d.x - h));
    }
    case 'boxS': return free.find(d => d.fit && d.role === 'S' && Math.sign(d.x) === ps) || null;
    case 'double': {
      const nb = !ctx.again && ctx.neighbour(p, rule[1] || 'playside');   // a double is set at the snap only
      if(!nb || nb.dbl || nb.via && nb.via.length) return null;
      if(DEF.some(d => d.stun <= 0 && d.role === 'DL' && Math.abs(dx(d)) <= COVERED_DX + 1e-6 && d.y - los <= COVERED_DY)) return null;   // covered: he has a man of his own
      const held = nb.blk && nb.blk.stun <= 0 && (nb.blk.role === 'DL' || nb.blk.y - los <= COVERED_DY) ? nb.blk : null;
      return held || nearest(line.filter(d => Math.abs(d.x - nb.x) <= COVERED_DX + 1e-6), d => Math.abs(d.x - nb.x));
    }
    case 'deep': return nearest(free.filter(d => d.role === 'S'), d => Math.abs(d.x - p.x));
    case 'corner': return free.find(d => d.role === 'CB' && d.assign === p) || null;
    case 'any': return nearest(free.filter(d => inBox(d) && d.y - los <= BOX_Y && Math.abs(d.x) <= BOX_X && Math.abs(dx(d)) <= ANY_DX), d => Math.hypot(dx(d), d.y - p.y));
  }
  return null;
}
// the blockers of a play, in the order they claim: linemen and tight end nearest the hole first, then the extras, then the receivers
function blockers(rules, flip){
  const order = n => n === 'FB' || n === 'TE2' ? 1 : n.startsWith('WR') ? 2 : 0, h = S.hole, ps = Math.sign(h) || 1;
  return Object.entries(rules).map(([n, spec]) => { const name = flip > 0 ? n : MIRROR[n] || n; return {name, p:bodyOf(name), spec, o:order(n)}; }).filter(b => b.p)
    .sort((a, b) => a.o - b.o || Math.abs(a.p.x - h) - Math.abs(b.p.x - h) || (b.p.x - a.p.x)*ps);   // a tie goes to the blocker nearer the playside
}
// again: after the handoff. Engaged men and pullers keep theirs; every other blocker (unengaged, not pulling) is read again against where the defense is now.
export function resolveBlocks(play, flip, again = false){
  const h = S.hole = play.hole ?? 0, rules = play.src.rules; if(!rules) return;
  const los = S.los, ps = Math.sign(h) || 1, bl = blockers(rules, flip);
  const linemen = bl.filter(b => b.p.role === 'OL' || b.p === TE).map(b => b.p).sort((a, b) => a.x - b.x);
  const ctx = {los, h, ps, again, neighbour:(p, side) => {   // the lineman next to me on the playside or the backside, or the one named (a name mirrors with the play)
    if(side !== 'playside' && side !== 'backside') return bodyOf(flip > 0 ? side : MIRROR[side] || side) || null;
    const dir = side === 'playside' ? ps : -ps, i = linemen.indexOf(p) + dir*1;
    return linemen[i] && Math.abs(linemen[i].x - p.x) < 3 ? linemen[i] : null;
  }};
  const keep = p => again && p.blk && p.blk.stun <= 0 && (p.locked || p.eng > 0 || (p.via && p.via.length) || (p.dbl && p.dbl.state !== 'released'));   // engaged, pulling, or in a double (driving or climbing)
  if(!again) S.climbed = false;
  for(const b of bl) if(!keep(b.p)){ b.p.blk = null; b.p.ruled = false; b.p.dbl = null; }
  const claimed = new Set(OFF.map(o => o.blk).filter(Boolean));
  // a safety in the box, or a zone pick out of the lane window, would be dropped by zoneBlock on frame 1: mark those `ruled` so it plays
  // them until the man is down (p.locked stays "engaged", the one thing the after-handoff read keeps)
  const resv = new Map();   // a line man a doubler took before his post man did: d -> {post man, doubler}; the post man may still take him
  const take = (b, d, rule) => {
    const r = resv.get(d); if(r && r.post === b.p) b.p.dbl = {d, mate:r.doubler, post:true, t:0, state:'double'};
    if(rule[0] === 'double'){
      const nb = ctx.neighbour(b.p, rule[1] || 'playside');
      b.p.dbl = {d, mate:nb, post:false, t:0, state:'double'}; b.p.ruled = true;
      if(nb.blk === d) nb.dbl = {d, mate:b.p, post:true, t:0, state:'double'}; else resv.set(d, {post:nb, doubler:b.p});
    }
    b.p.blk = d; claimed.add(d); if(rule[0] === 'boxS' || (b.p.lane != null && Math.abs(d.x - b.p.lane) >= ZONE_KEEP)) b.p.ruled = true; };
  const free = b => DEF.filter(d => d.stun <= 0 && (!claimed.has(d) || (resv.get(d) || {}).post === b.p));
  for(let k = 0; k < 3; k++) for(const b of bl){
    if(b.p.blk || !b.spec[k]) continue;
    const d = pick(b.spec[k], b.p, free(b), ctx); if(d) take(b, d, b.spec[k]);
  }
  for(const b of bl){   // a lineman or tight end with nothing named takes the nearest man in the box
    if(b.p.blk || b.o) continue;
    const d = pick(['any'], b.p, free(b), ctx); if(d) take(b, d, ['any']);
  }
  for(const b of bl){ const m = b.p.dbl; if(m && !m.post && m.mate.blk !== m.d) b.p.dbl = null; }   // the post man took someone else: a single block after all
  const lab = labels(); S.blk = Object.fromEntries(bl.map(b => [b.name, b.p.blk ? lab.get(b.p.blk) || '?' : null]));
}
// the climber's check, every frame from offense.js: leave the double for the nearest unblocked linebacker when it is time
export function climbCheck(p, dt){
  const m = p.dbl; if(!m || m.post || m.state !== 'double') return;
  const d = m.d;
  if(d.stun > 0 || p.blk !== d || m.mate.blk !== d){ m.state = 'released'; return; }
  if(dist(p, d) < ENGAGED) m.t += dt;
  const backer = e => e.role === 'LB' && e.stun <= 0 && !OFF.some(o => o !== p && o.blk === e);   // unblocked: the tight end's edge man is not one to climb to
  const commit = e => dist(e, d) < CLIMB_NEAR || dist(e, p) < CLIMB_NEAR || (dist(e, p) < CLIMB_RANGE && e.vy < -COMMIT_V*e.spd);
  const near = m.t > 0 && DEF.some(e => backer(e) && commit(e));
  if(m.t < CLIMB_T && !near) return;
  const lb = nearest(DEF.filter(e => backer(e) && dist(e, p) < CLIMB_RANGE && e.y >= p.y - 1.5), e => dist(e, p));
  if(!lb) return;
  p.blk = lb; p.ruled = true; m.state = 'climbing'; if(m.mate.dbl) m.mate.dbl.state = 'released'; S.climbed = true;
}
