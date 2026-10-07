import { C, CBs, DEF, EXTRA, LBs, LG, LT, OFF, RG, RT, SFs, TE, WRs } from './players.js';
import { lack } from './ratings.js';
import { S } from './state.js';
import { BOX_X, GRID_K as GK } from './formations.js';
import { BLOCK_D, dist } from './util.js';

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
//   pull     ['pull','kick'|'wrap'|'trap']: I leave the line and run to a target the rule picks (B-007-8, states below); no target = the next rule
//            kick  the first defender outside the hole (playside of it) with y within los-KICK_BACK..los+KICK_FWD; the nearest to the hole; I aim at his inside shoulder (KICK_X)
//            wrap  the nearest unblocked playside linebacker beyond los+WRAP_Y
//            trap  the first line man past the center on my pull side that nobody blocks
//   deep     the safety nearest me;  corner  the corner covering me;  any  nearest man in the box within ANY_DX of me (nobody is sent across the formation)
// Double team (B-007-7). Per blocker p.dbl = {d, mate, post, t, state}; absent = single. The climber is the uncovered man who joins, the post man the covered neighbour who keeps d.
// A double is set at the snap only (the handoff re-read keeps a double or a climber that is not released).
//   state     event                                                             next
//   single    double rule finds the covered neighbour's man (snap)              climber: double; neighbour: post, double
//   single    the post man took someone else at the snap (pair never completed) single (dbl cleared)
//   double    climber engaged on d CLIMB_T, or engaged and a free LB within CLIMB_NEAR of d or of him, or one in CLIMB_RANGE moving downhill at COMMIT_V of his speed,
//             and a free LB within CLIMB_RANGE   climber: climbing (blk = the LB); post man: released (single on d)
//   double    no free LB in range                                               double (stays, asked again every frame)
//   double    d is down, or either man was re-targeted                          both released (the zone/man code re-picks)
//   climbing  the LB is down                                                    released (zoneBlock re-picks)
// Pull (B-007-8). Per puller p.pull = {kind, tgt, state, t, reach}; set at the snap only (the handoff re-read keeps a puller that is pulling or engaged; one that finished unengaged takes his next rule).
// The path is PULL_DEPTH behind the line for PULL_FLAT yd along it, then up to the aim point (offense.js runBlock runs it at PULL_V x speed); S.pulls logs {name, kind, tgt, reach} for probes.
//   state     event                                                         next
//   set       rule found a target (snap)                                    pulling (p.via = the two waypoints, p.blk = target)
//   set       rule found no target                                          no pull (the next rule runs)
//   pulling   target down (stun)                                            free: via cleared, p.blk re-picked by block()
//   pulling   within ENGAGED of the target                                  engaged (reach = t; p.locked, kept all play)
//   pulling   re-targeted (p.blk changed)                                    free (via cleared)
//   engaged   target down                                                   free
//   engaged   re-targeted (p.blk changed)                                    free
//   free      (end)                                                         p.pull.state stays 'free' for the play
// B-021: the windows below were written on the old 2.2 yd line grid; GK (formations.js GRID_K) carries them onto the new line grid (OL_GAP 1.35 yd): x0.61.
// KICK_X is a shoulder width, so it takes the body width (x0.7) instead.
// B-021: two bodies this close are locked up (was 1.4, x0.7 body width); offense.js and blockrules read it; B-031: the lock distance plus a margin
export const ENGAGE_R = BLOCK_D + 0.1;   // B-031 (pair-pose)
export const PULL_V = 1.3, PULL_DEPTH = 1.8, PULL_FLAT = 1.2, PULL_VIA_R = 0.8, PLAYSIDE_X = 1.5*GK, KICK_X = 0.35, KICK_BACK = 1, KICK_FWD = 3, WRAP_Y = 1.5;   // PULL_VIA_R: a waypoint counts as reached this close
// Re-read on a stunt (B-007-9). A slant counts as a crossing stunt for the re-read and for the WRONG roll (every line man's gap moves); a blitz does not. Per lineman p.rr = {state, d, home, t, acc, miss}; set at the snap for a man whose target is a stunting defender (crossing stunt: d.stunt, not a blitzer).
// Awareness (p.rt.recog) sets the mistakes: READ_O = READ_BASE - recog/READ_K is how long he takes to see his man left, MISS_P*lack keeps his old man MISS_HOLD s more, WRONG_P*lack takes his second rule's man at the snap.
// offense.js rereadCheck asks every REREAD_DT while he has an rr; events go to S.blkEv ({name, ev:'passed'|'missed'|'wrong', t}).
//   state     event                                                                 next
//   set       target left his snap spot by LEFT_DX while the stunt is live          reading (t = 0; miss rolled: MISS_P*lack(recog))
//   set       target already free (stunt over) before he left LEFT_DX                 no rr
//   set       target down, or p.blk re-targeted by someone else                     no rr (the zone/man code owns him)
//   reading   t >= READ_O (+ MISS_HOLD when the miss rolled), a free line man in my lane  passed, or missed when the miss rolled (p.blk = him, unlocked, ruled); event logged
//   reading   same time, nobody free in my lane                                      reading (asked again every REREAD_DT), kept after GIVEUP_T (stays on his man; missed event still logged)
//   reading   target down                                                           no rr
//   passed / missed / kept   (terminal; the handoff re-read keeps him)
// The miss event is logged when the miss is rolled, so a missed blocker shows even when his old man comes back.
export const READ_BASE = 0.45, READ_K = 250, MISS_P = 0.5, MISS_HOLD = 0.4, WRONG_P = 0.15, LEFT_DX = 1.2*GK, REREAD_DT = 0.1, GIVEUP_T = 0.8;
// S.climbed: true once a climb happened this play; B-007-10's climb counter reads it.
export const CLIMB_T = 0.5, CLIMB_NEAR = 2.5, CLIMB_RANGE = 6, ENGAGED = ENGAGE_R, COMMIT_V = 0.5, NEIGHBOUR_DX = 3*GK, BEHIND_Y = 1.5;   // NEIGHBOUR_DX: the next lineman is no further than this; BEHIND_Y: a blocker does not pick a man this far behind him   // COMMIT_V: a linebacker moving downhill (toward the line) faster than this share of his own run speed has committed
export const COVERED_DX = 1.0*GK, COVERED_DY = 2.5, REACH_DX = 3.5*GK, REACH_AIM = 2.0*GK, BOX_Y = 7, ANY_DX = 5*GK, LANE_DX = 1.8*GK, ZONE_KEEP = 3*GK, CLIMB_LANE_DX = 6*GK;   // ZONE_KEEP: offense.js zoneBlock drops an unengaged, unruled target this far from the lane
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
      return nearest(lbs.filter(d => d.x*ps > -PLAYSIDE_X), d => Math.abs(d.x - h));
    }
    case 'boxS': return free.find(d => d.fit && d.role === 'S' && Math.sign(d.x) === ps) || null;
    case 'double': {
      const nb = !ctx.again && ctx.neighbour(p, rule[1] || 'playside');   // a double is set at the snap only
      if(!nb || nb.dbl || nb.via && nb.via.length) return null;
      if(DEF.some(d => d.stun <= 0 && Math.abs(dx(d)) <= COVERED_DX + 1e-6 && d.y - los <= COVERED_DY)) return null;   // covered: he has a man of his own
      const held = nb.blk && nb.blk.stun <= 0 && (nb.blk.role === 'DL' || nb.blk.y - los <= COVERED_DY) ? nb.blk : null;
      return held || nearest(line.filter(d => Math.abs(d.x - nb.x) <= COVERED_DX + 1e-6), d => Math.abs(d.x - nb.x));
    }
    case 'pull': {
      if(ctx.again || p.pull) return null;   // a pull is set at the snap only
      const dir = Math.sign(h - p.x) || ps;
      let d = null;
      if(rule[1] === 'kick') d = nearest(free.filter(e => inBox(e) && (e.x - h)*ps > 0 && e.y - los >= -KICK_BACK && e.y - los <= KICK_FWD), e => Math.abs(e.x - h));
      else if(rule[1] === 'wrap') d = nearest(free.filter(e => e.role === 'LB' && e.x*ps > -PLAYSIDE_X && e.y - los > WRAP_Y), e => Math.hypot(dx(e), e.y - p.y));
      else if(rule[1] === 'trap') d = nearest(free.filter(e => e.role === 'DL' && (e.x - C.x)*dir > 0), e => Math.abs(e.x - C.x));
      if(!d) return null;
      return d;
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
    if(side !== 'playside' && side !== 'backside'){ const n = bodyOf(flip > 0 ? side : MIRROR[side] || side); return n && n !== p && linemen.includes(n) ? n : null; }
    const dir = side === 'playside' ? ps : -ps, i = linemen.indexOf(p) + dir*1;
    return linemen[i] && Math.abs(linemen[i].x - p.x) < NEIGHBOUR_DX ? linemen[i] : null;
  }};
  const keep = p => again && p.blk && p.blk.stun <= 0 && (p.locked || p.eng > 0 || (p.via && p.via.length) || (p.dbl && p.dbl.state !== 'released') || (p.rr && p.rr.state !== 'set'));   // engaged, pulling, or in a double (driving or climbing)
  if(!again){ S.climbed = false; S.pulls = []; S.blkEv = []; OFF.forEach(o => { o.rr = null; }); }
  for(const b of bl) if(!keep(b.p)){ b.p.blk = null; b.p.ruled = false; b.p.dbl = null; if(!again){ b.p.via = null; b.p.pull = null; } }
  const claimed = new Set(OFF.map(o => o.blk).filter(Boolean));
  // a safety in the box, or a zone pick out of the lane window, would be dropped by zoneBlock on frame 1: mark those `ruled` so it plays
  // them until the man is down (p.locked stays "engaged", the one thing the after-handoff read keeps)
  const pulls = [], wrong = [];
  const resv = new Map();   // a line man a doubler took before his post man did: d -> {post man, doubler}; the post man may still take him
  const take = (b, d, rule) => {
    const r = resv.get(d); if(r && r.post === b.p) b.p.dbl = {d, mate:r.doubler, post:true, t:0, state:'double'};
    if(rule[0] === 'double'){
      const nb = ctx.neighbour(b.p, rule[1] || 'playside');
      b.p.dbl = {d, mate:nb, post:false, t:0, state:'double'}; b.p.ruled = true;
      if(nb.blk === d) nb.dbl = {d, mate:b.p, post:true, t:0, state:'double'}; else resv.set(d, {post:nb, doubler:b.p});
    }
    if(rule[0] === 'pull'){
      const dir = Math.sign(h - b.p.x) || ps, aim = rule[1] === 'kick' ? d.x - dir*KICK_X : d.x;
      b.p.via = [{x:b.p.x + dir*PULL_FLAT, y:los - PULL_DEPTH}, {x:aim, y:d.y}]; b.p.pull = {kind:rule[1], tgt:d, state:'pulling', t:0, reach:null};
      pulls.push({name:b.name, kind:rule[1], p:b.p});
    }
    b.p.blk = d; claimed.add(d); if(rule[0] === 'boxS' || (b.p.lane != null && Math.abs(d.x - b.p.lane) >= ZONE_KEEP)) b.p.ruled = true; };
  const free = b => DEF.filter(d => d.stun <= 0 && (!claimed.has(d) || (resv.get(d) || {}).post === b.p));
  const stunting = !again && DEF.some(isCrosser); if(!again) S.blkStunt = stunting;   // only a play with a crossing stunt rolls awareness: other plays draw no random numbers
  for(let k = 0; k < 3; k++) for(const b of bl){
    if(b.p.blk || !b.spec[k]) continue;
    // B-007-12: a Draw pass-setter (first rule 'pass', held by offense.js) takes no wrong read
    if(k === 0 && stunting && !b.o && b.spec[1] && b.spec[0][0] !== 'pass' && !['pull', 'double'].includes(b.spec[0][0]) && !['pull', 'double'].includes(b.spec[1][0]) && Math.random() < WRONG_P*lack(b.p, 'recog')){
      const d2 = pick(b.spec[1], b.p, free(b), ctx);   // a wrong read: his second-priority man, when it is a different one
      if(d2 && d2 !== pick(b.spec[0], b.p, free(b), ctx)){ take(b, d2, b.spec[1]); wrong.push(b); continue; }
    }
    const d = pick(b.spec[k], b.p, free(b), ctx); if(d) take(b, d, b.spec[k]);
  }
  for(const b of bl){   // a lineman or tight end with nothing named takes the nearest man in the box
    if(b.p.blk || b.o) continue;
    const d = pick(['any'], b.p, free(b), ctx); if(d) take(b, d, ['any']);
  }
  for(const b of bl){ const m = b.p.dbl; if(m && !m.post && m.mate.blk !== m.d) b.p.dbl = null; }   // the post man took someone else: a single block after all
  if(!again) for(const b of bl){
    const d = b.p.blk;
    if(!b.o && d && isCrosser(d) && !b.p.pull && !b.p.dbl) b.p.rr = {state:'set', d, home:d.x, t:0, acc:0, miss:false};
    if(wrong.includes(b)) S.blkEv.push({name:b.name, ev:'wrong', t:0});
  }
  const lab = labels(); for(const u of pulls) S.pulls.push({name:u.name, kind:u.kind, tgt:lab.get(u.p.blk) || '?', p:u.p});
  S.blk = Object.fromEntries(bl.map(b => [b.name, b.p.blk ? lab.get(b.p.blk) || '?' : null]));
}
const isCrosser = d => !!d.stunt && !d.stunt.blitz;
// the lineman's re-read, from offense.js every REREAD_DT: see "Re-read on a stunt" above
export function rereadCheck(p, dt){
  const m = p.rr; if(!m || m.state !== 'set' && m.state !== 'reading') return;
  m.acc += dt; if(m.acc < REREAD_DT) return;
  const step = m.acc; m.acc = 0;
  if(m.d.stun > 0 || (m.state === 'set' && p.blk !== m.d)){ p.rr = null; return; }
  if(m.state === 'set'){
    if(m.d.stunt && m.d.stunt.st === 'free'){ p.rr = null; return; }
    if(Math.abs(m.d.x - m.home) < LEFT_DX) return;
    m.state = 'reading'; m.t = 0; m.miss = Math.random() < MISS_P*lack(p, 'recog');
    if(m.miss) S.blkEv.push({name:nameOf(p), ev:'missed', t:+S.clock.toFixed(2)});
    return;
  }
  m.t += step;
  const due = READ_BASE - p.rt.recog/READ_K + (m.miss ? MISS_HOLD : 0);
  if(m.t < due) return;
  const claimed = new Set(OFF.filter(o => o !== p && o.blk && !(o.rr && o.rr.state === 'reading')).map(o => o.blk));
  const ctx = {los:S.los, h:S.hole, ps:Math.sign(S.hole) || 1};
  const d = pick(['line'], p, DEF.filter(e => e.stun <= 0 && e !== m.d && !claimed.has(e)), ctx);
  if(d){ p.blk = d; p.locked = false; p.ruled = true; p.eng = 0; m.state = m.miss ? 'missed' : 'passed'; if(!m.miss) S.blkEv.push({name:nameOf(p), ev:'passed', t:+S.clock.toFixed(2)}); }
  else if(m.t > due + GIVEUP_T) m.state = 'kept';   // nobody has come into my lane yet: ask again every REREAD_DT
}
const nameOf = p => Object.keys(S.blk || {}).find(n => bodyOf(n) === p) || '?';
// the climber's check, every frame from offense.js: leave the double for the nearest unblocked linebacker when it is time
export function climbCheck(p, dt){
  const m = p.dbl; if(!m || m.post) return;
  if(m.state === 'climbing'){ if(p.blk !== m.lb || m.lb.stun > 0) m.state = 'released'; return; }   // the LB is down (or he was re-targeted)
  if(m.state !== 'double') return;
  const d = m.d;
  if(d.stun > 0 || p.blk !== d || m.mate.blk !== d){ m.state = 'released'; if(m.mate.dbl) m.mate.dbl.state = 'released'; return; }
  if(dist(p, d) < ENGAGED) m.t += dt;
  const backer = e => e.role === 'LB' && e.stun <= 0 && !OFF.some(o => o !== p && o.blk === e);   // unblocked: the tight end's edge man is not one to climb to
  const commit = e => dist(e, d) < CLIMB_NEAR || dist(e, p) < CLIMB_NEAR || (dist(e, p) < CLIMB_RANGE && e.vy < -COMMIT_V*e.spd);
  const near = m.t > 0 && DEF.some(e => backer(e) && commit(e));
  if(m.t < CLIMB_T && !near) return;
  const lb = nearest(DEF.filter(e => backer(e) && dist(e, p) < CLIMB_RANGE && e.y >= p.y - BEHIND_Y), e => dist(e, p));
  if(!lb) return;
  p.blk = lb; p.ruled = true; m.state = 'climbing'; m.lb = lb; if(m.mate.dbl) m.mate.dbl.state = 'released'; S.climbed = true;
}
// the puller's check, every frame from offense.js while he has a pull: engaged when he reaches the target, free when the target goes down
export function pullCheck(p, dt){
  const m = p.pull; if(!m || m.state === 'free') return;
  m.t += dt;
  if(m.tgt.stun > 0 || p.blk !== m.tgt){ m.state = 'free'; p.via = null; return; }
  if(m.state === 'pulling' && dist(p, m.tgt) < ENGAGED){ m.state = 'engaged'; m.reach = m.t; }
}
