import { C, CBs, DEF, EXTRA, LBs, LG, LT, OFF, RG, RT, SFs, TE, WRs } from './players.js';
import { lack } from './ratings.js';
import { S } from './state.js';
import { BOX_X, GRID_K as GK, OL_GAP, TACKLE_BACK } from './formations.js';
import { dist } from './util.js';

// ---------- block rules (B-007-6) ----------
// Each blocker's job is a list of rules, tried in order; the first rule that finds an unclaimed defender wins. resolveBlocks reads them
// (claim order: see blockers() below) against the front the play is actually facing, once at the snap (and once more after the handoff), and writes the target into p.blk
// and a name log into S.blk; offense.js keeps that man (locked once engaged, kept all play), so nothing here runs per frame.
// Rules are written for the base side (the play's hole to -x, tight end +x) and mirrored by flip: only the blocker names swap, since
// a rule reads the defenders by where they stand.  Rule = [kind, arg]:
//   on       the man covering me: within COVERED_DX of me at the line (COVERED_DY)
//   line     the nearest line man within LANE_DX of my lane (p.lane on a zone play, else where I stand; today's zone window: a man shaded between two of us goes to the nearer
//            claimer in claim order, so a back-side guard is not sent after the man the center should take)
//   down     nearest line man toward the hole from me (head up counts)
//   reach    outside shade: the line man on the playside of me, nearest REACH_AIM out
//   edge     the outermost line man on the playside (the kick-out man; B-007-8 makes it a real kick)
//   backer   ['backer','mike'] the linebacker nearest the center (two equally near: the one on the hole side); ['backer','ps'] the one nearest the hole on the playside;
//            ['backer','near'] the one nearest me (a tie goes away from the hole)
//   boxS     the safety rolled into the box on the playside
//   double   ['double','playside'|'backside'|<blocker name>]: I have nobody on me, so I join the neighbour on that side against the line man covering him (the neighbour is the post man and keeps him; I
//            am the climber). Not offered when I am covered, or when the neighbour is already in a double. A third entry 'cov' (B-030) offers it even when I am covered (the Power/Counter tackle
//            leaves the end man to the kick-out and joins the guard's man)
//   later    never matches: it pushes the next rule to the next pass, after every blocker's first rules have claimed (B-030: on an odd front the tackle's 'down' claims the 5-tech before the kicker's pull picks the man outside him; on an even front the tackle's 'cov' double has already left the end man to the kick)
//   back     nearest line man away from the hole from me (head up counts); none = no target, the next rule runs (B-030)
//   pull     ['pull','kick'|'wrap'|'lead'|'trap']: I leave the line and run to a target the rule picks (B-007-8, states below); no target = the next rule
//            kick  the first defender outside the hole (playside of it) with y within los-KICK_BACK..los+KICK_FWD; the nearest to the hole; I aim at his inside shoulder (KICK_X)
//            wrap  the nearest unblocked playside linebacker beyond los+WRAP_Y; ['pull','wrap','ps'] the one nearest the hole instead (B-030: the double climbs to the Mike, the wrapper takes the playside backer)
//            lead  (B-016) no kick-out man outside the hole: the box defender on my playside nearest the hole, the first threat (the Toss guard leads up on him)
//            trap  the first line man past the center on my pull side that nobody blocks
//   (B-015) reserve: a man standing on a lineman who has not blocked yet and has an `on` rule still to try is not taken by a roaming rule (down, back) or a second tight end's on / line / reach / edge; a wrong-man bust may still take him
//   deep     the safety nearest me;  corner  the corner covering me;  any  nearest man in the box within ANY_DX of me (nobody is sent across the formation)
// A rule may carry a guard (B-030, per form): rule.need = a blocker name that must be on the field, rule.not = one that must not (a Power with no fullback sends the guard to kick; with one, to wrap).
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
// Pull (B-007-8). Per puller p.pull = {kind, tgt, state, t, reach, ox}; set at the snap only (the handoff re-read keeps a puller that is pulling or engaged; one that finished unengaged takes his next rule).
// The path is PULL_DEPTH behind the line for PULL_FLAT yd along it, then up to the aim point (offense.js runBlock runs it at PULL_V x speed); S.pulls logs {name, kind, tgt, reach} for probes. ox = the kick offset from the target's x (-dir*KICK_X for a kick, 0 otherwise); offense.js runBlock moves the last waypoint every frame to the target + ox + his velocity x the lead (the puller's time to reach him, at most PULL_LEAD_T), B-061.
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
export const ENGAGE_R = 0.98;   // B-021: two bodies this close are locked up (was 1.4, x0.7 body width); offense.js and blockrules read it
export const PULL_V = 1.3, PULL_DEPTH = 1.8 + TACKLE_BACK /* B-053 (ol-v-set): the tackles sit TACKLE_BACK deeper, the path stays as clear of them as before */, PULL_FLAT = 1.2, PULL_VIA_R = 0.8, PLAYSIDE_X = 1.5*GK, KICK_X = 0.35, KICK_BACK = 1, KICK_FWD = 3, WRAP_Y = 1.5;   // PULL_VIA_R: a waypoint counts as reached this close
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
export const BACKER_TIE = 0.01;   // B-015: two backers this close count as equally near ('mike' breaks the tie toward the hole, 'near' away from it)
export const COVER_EPS = 1e-3;   // B-030: a defender exactly COVERED_DX off (a float tie, e.g. the nickel guard) counts as covered, the same way in every covered test
export const COVERED_DX = 1.0*GK, COVERED_DY = 2.5, REACH_DX = 3.5*GK, REACH_AIM = 2.0*GK, BOX_Y = 7, ANY_DX = 5*GK, LANE_DX = 1.8*GK, ZONE_KEEP = 3*GK, CLIMB_LANE_DX = 6*GK;   // ZONE_KEEP: offense.js zoneBlock drops an unengaged, unruled target this far from the lane
// Scheme knowledge (B-032-2). At the snap every lineman, tight end and back-blocker (not a receiver) rolls one bust draw: chance BUST_MAX*(1-know/99)^2, know = his rating for the
// play's family (FAMILY: scheme 'zone' -> p.rt.zone, 'man' -> p.rt.gap; p.rt.pass is kept for pass pro later). The draw is always taken (same seed, same stream), and S.bust gets
// one {name, fam, know, kind} per rolled blocker: kind null = no bust. A bust shows only through its result:
//   wrong   his rule would give him a man: he takes his next rule's man instead, else the man in the neighbour lane away from the hole; his own man stays free
//   late    he is a puller (B-032-3 applies the delay)         noclimb / late   he is the climber of a double (half of the bust band each; B-032-3 applies it)
//   none    busted but no other man to take (or the double / pull never formed): he blocks his man as usual
//   no man on the rule that would assign him = no bust there (the next rule is tried); WRONG_RULES: the wrong man comes from the next rule only if it is a line rule, else the neighbour lane
//   a double's post man busts late / noclimb only (never wrong); the freed man sits in `left`, so the snap and handoff reads skip him
// B-032-3 applies the late / noclimb kinds. The bust lands on the man who moves: a puller (his own bust), the climber of a double (his own bust, or the post man's: the post man only
// busts through the double, so his kind is handed to the climber when the double forms; if both busted, the climber's own wins). No new random draws; at know 99 no kind is ever set.
//   state              event                                      next                                          test (forced know 35, Power)
//   pull set + late    p.pull.t < LATE_PULL_T (0.4 s)             stays at his spot, eyes on the target         pull-arrival time (p.pull.reach) 0.4 s+ later
//   pull set + late    p.pull.t >= LATE_PULL_T                    pulling (as a normal pull)                    same
//   double + late      m.t < CLIMB_T + LATE_CLIMB_T (0.5 s)       stays on the double (no near-LB early climb   climb time +0.5 s
//                      before LATE_CLIMB_T either)
//   double + late      m.t >= CLIMB_T + LATE_CLIMB_T, LB found    climbing                                      same
//   double + noclimb   post man not falling                       stays on the double                           noclimb count: climbs 0 while the post man is up
//   double + noclimb   post man falling                           climbs as a normal climber (late rule off)    --
//   any                the target / double man goes down          free / released, as before                    unchanged
// A busted blocker skips the recog stunt roll. p.bustWrong keeps his wrong man through the handoff re-read.
export const BUST_MAX = 0.35, LATE_PULL_T = 0.4, LATE_CLIMB_T = 0.5;
const WRONG_RULES = ['on', 'line', 'down', 'reach', 'back', 'edge'];   // a wrong man is a line man: never a backer or safety (an easier tackle for the defense)
let left = new Set();   // the men wrong-man busters left free this play: nobody else's snap or handoff read takes them (zoneBlock's lane pick may, later)
export const FAMILY = {zone:'zone', man:'gap'};
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
    case 'on': return nearest(line.filter(d => Math.abs(dx(d)) <= COVERED_DX + COVER_EPS && d.y - los <= COVERED_DY), d => Math.abs(dx(d)));
    case 'line': { const lane = p.lane ?? p.x; return nearest(line.filter(d => Math.abs(d.x - lane) < LANE_DX), d => Math.hypot(dx(d), d.y - p.y)); }
    case 'down': { const dir = Math.sign(h - p.x) || ps; return nearest(line.filter(d => d.y - los <= COVERED_DY && dx(d)*dir >= -COVERED_DX - COVER_EPS), d => Math.hypot(dx(d), d.y - p.y)); }
    case 'reach': return nearest(line.filter(d => dx(d)*ps >= -0.3 && dx(d)*ps <= REACH_DX), d => Math.abs(d.x - (p.x + ps*REACH_AIM)));
    case 'back': { const dir = Math.sign(h - p.x) || ps, away = line.filter(d => d.y - los <= COVERED_DY && dx(d)*-dir >= -COVERED_DX - COVER_EPS);
      return nearest(away, d => Math.hypot(dx(d), d.y - p.y)); }
    case 'edge': return nearest(line, d => d.x*-ps);
    case 'backer': {
      const lbs = free.filter(d => d.role === 'LB');
      if(rule[1] === 'mike') return nearest(lbs, d => Math.abs(d.x) + (d.x*ps < 0 ? BACKER_TIE : 0));   // B-015: two backers equally near the center (the nickel): the one on the hole side
      if(rule[1] === 'near') return nearest(lbs, d => Math.abs(dx(d)) + (Math.sign(d.x) === ps ? BACKER_TIE : 0));   // straight up from where I stand; a tie goes away from the hole, so a climber doesn't cross it
      return nearest(lbs.filter(d => d.x*ps > -PLAYSIDE_X), d => Math.abs(d.x - h));
    }
    case 'boxS': return free.find(d => d.fit && d.role === 'S' && Math.sign(d.x) === ps) || null;
    case 'double': {
      const nb = !ctx.again && ctx.neighbour(p, rule[1] || 'playside');   // a double is set at the snap only
      if(!nb || nb.dbl || nb.via && nb.via.length) return null;
      if(rule[2] !== 'cov' && DEF.some(d => d.stun <= 0 && Math.abs(dx(d)) <= COVERED_DX + COVER_EPS && d.y - los <= COVERED_DY)) return null;   // covered: he has a man of his own
      const held = nb.blk && nb.blk.stun <= 0 && (nb.blk.role === 'DL' || nb.blk.y - los <= COVERED_DY) ? nb.blk : null;
      return held || nearest(line.filter(d => Math.abs(d.x - nb.x) <= COVERED_DX + COVER_EPS), d => Math.abs(d.x - nb.x));
    }
    case 'pull': {
      if(ctx.again || p.pull) return null;   // a pull is set at the snap only
      const dir = Math.sign(h - p.x) || ps;
      let d = null;
      if(rule[1] === 'kick') d = nearest(free.filter(e => inBox(e) && (e.x - h)*ps > 0 && e.y - los >= -KICK_BACK && e.y - los <= KICK_FWD), e => Math.abs(e.x - h));
      else if(rule[1] === 'wrap') d = nearest(free.filter(e => e.role === 'LB' && e.x*ps > -PLAYSIDE_X && e.y - los > WRAP_Y), e => rule[2] === 'ps' ? Math.abs(e.x - h) : Math.hypot(dx(e), e.y - p.y));
      else if(rule[1] === 'lead') d = nearest(free.filter(e => inBox(e) && dx(e)*ps > 0 && e.y - los <= BOX_Y), e => Math.abs(e.x - h));
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
// the blockers of a play, in the order they claim: linemen and tight end nearest the hole first, then the extras, then the receivers.
// Claim order (B-016), in resolveBlocks: 1 bust draws (all, first, so the random stream is fixed); 2 pull-first pass, only a blocker whose spec[0] is a pull (pulls at spec[1]+ - Toss lead, Power no-FB kick, Counter kick - wait for their pass k); 3 passes k = 0..2 over this order, a rule that finds no man or is `later` waits for the next pass; (B-015: a roaming rule skips the man reserved for a lineman who still has an `on` rule); 4 `any` for a lineman with nothing
function blockers(rules, flip){
  const order = n => n === 'FB' || n === 'TE2' ? 1 : n.startsWith('WR') ? 2 : 0, h = S.hole, ps = Math.sign(h) || 1;
  return Object.entries(rules).map(([n, spec]) => { const name = flip > 0 ? n : MIRROR[n] || n; return {name, p:bodyOf(name), spec, o:order(n)}; }).filter(b => b.p)
    .sort((a, b) => a.o - b.o || Math.abs(a.p.x - h) - Math.abs(b.p.x - h) || (b.p.x - a.p.x)*ps);   // a tie goes to the blocker nearer the playside
}
// again: after the handoff. Engaged men and pullers keep theirs; every other blocker (unengaged, not pulling) is read again against where the defense is now.
export function resolveBlocks(play, flip, again = false){
  const h = S.hole = play.hole ?? 0, rules = play.src.rules; if(!again) S.bust = []; if(!rules) return;
  const los = S.los, ps = Math.sign(h) || 1, bl = blockers(rules, flip);
  const linemen = bl.filter(b => b.p.role === 'OL' || b.p === TE).map(b => b.p).sort((a, b) => a.x - b.x);
  const ctx = {los, h, ps, again, neighbour:(p, side) => {   // the lineman next to me on the playside or the backside, or the one named (a name mirrors with the play)
    if(side !== 'playside' && side !== 'backside'){ const n = bodyOf(flip > 0 ? side : MIRROR[side] || side); return n && n !== p && linemen.includes(n) ? n : null; }
    const dir = side === 'playside' ? ps : -ps, i = linemen.indexOf(p) + dir*1;
    return linemen[i] && Math.abs(linemen[i].x - p.x) < NEIGHBOUR_DX ? linemen[i] : null;
  }};
  const keep = p => again && p.blk && p.blk.stun <= 0 && (p.locked || p.eng > 0 || (p.via && p.via.length) || (p.dbl && p.dbl.state !== 'released') || (p.rr && p.rr.state !== 'set') || p.bustWrong);   // engaged, pulling, or in a double (driving or climbing)
  if(!again){ S.climbed = false; S.climbRec = []; S.pulls = []; S.blkEv = []; OFF.forEach(o => { o.rr = null; }); }
  for(const b of bl) if(!keep(b.p)){ b.p.blk = null; b.p.ruled = false; b.p.dbl = null; if(!again){ b.p.via = null; b.p.pull = null; } }
  if(!again) for(const b of bl) b.p.bustWrong = false;
  const claimed = new Set(OFF.map(o => o.blk).filter(Boolean));
  // a safety in the box, or a zone pick out of the lane window, would be dropped by zoneBlock on frame 1: mark those `ruled` so it plays
  // them until the man is down (p.locked stays "engaged", the one thing the after-handoff read keeps)
  const pulls = [], wrong = [];
  const resv = new Map();   // a line man a doubler took before his post man did: d -> {post man, doubler}; the post man may still take him
  const take = (b, d, rule) => {
    const r = resv.get(d); if(r && r.post === b.p) b.p.dbl = {d, mate:r.doubler, post:true, t:0, state:'double'};
    if(b.bust && !b.entry.kind && rule[0] === 'pull') b.entry.kind = 'late';
    if(b.bust && !b.entry.kind && rule[0] === 'double') b.entry.kind = b.bust.half ? 'late' : 'noclimb';
    if(rule[0] === 'double'){
      const nb = ctx.neighbour(b.p, rule[1] || 'playside');
      b.p.dbl = {d, mate:nb, post:false, t:0, state:'double'}; b.p.ruled = true;
      if(nb.blk === d) nb.dbl = {d, mate:b.p, post:true, t:0, state:'double'}; else resv.set(d, {post:nb, doubler:b.p});
    }
    if(rule[0] === 'pull'){
      const dir = Math.sign(h - b.p.x) || ps, aim = rule[1] === 'kick' ? d.x - dir*KICK_X : d.x;
      b.p.via = [{x:b.p.x + dir*PULL_FLAT, y:los - PULL_DEPTH}, {x:aim, y:d.y}]; b.p.pull = {kind:rule[1], tgt:d, state:'pulling', t:0, reach:null, ox:aim - d.x};
      pulls.push({name:b.name, kind:rule[1], p:b.p});
    }
    b.p.blk = d; claimed.add(d); if(rule[0] === 'boxS' || (b.p.lane != null && Math.abs(d.x - b.p.lane) >= ZONE_KEEP)) b.p.ruled = true; };
  if(!again) left = new Set();
  // a covered blocker next to a neighbour with a double rule toward him that could fire (uncovered, or 'cov'): he is that double's post man. An approximation: it does not check that the neighbour's earlier rules took no man; a double that never forms clears the kind at the end
  const postMan = b => bl.some(c => c !== b && c.spec.some(r => r[0] === 'double' && allowed(r) && ctx.neighbour(c.p, r[1] || 'playside') === b.p && (r[2] === 'cov' || !DEF.some(d => d.stun <= 0 && Math.abs(d.x - c.p.x) <= COVERED_DX + COVER_EPS && d.y - los <= COVERED_DY))));
  // B-015: a man standing on a lineman who has not blocked yet and still has an `on` rule to try is his; a roaming rule (down, back) or a back-blocker's line rule (second tight end) does not take him
  // (the Duo tight end's `down` took the end the right tackle covers, leaving the tackle with nobody). A man the roaming blocker is covered by himself stays his own (rule order).
  const ROAM = ['down', 'back'];
  const covering = (b, k) => {
    const set = new Set(); if(!(ROAM.includes(b.spec[k][0]) || b.o === 1 && ['on', 'line', 'reach', 'edge'].includes(b.spec[k][0]))) return set;
    for(const c of bl){
      if(c === b || c.p.blk || c.o || !c.spec.some((r, j) => j > k && r[0] === 'on' && allowed(r))) continue;
      const d = pick(['on'], c.p, free(c), ctx); if(d) set.add(d);
    }
    return set;
  };
  const free = b => DEF.filter(d => d.stun <= 0 && !left.has(d) && (!claimed.has(d) || (resv.get(d) || {}).post === b.p));
  if(!again){
    for(const b of bl){
      if(b.o > 1) continue;   // receivers' blocks are no scheme job
      const fam = FAMILY[play.scheme] || 'gap', know = b.p.rt[fam], chance = BUST_MAX*Math.pow(1 - know/99, 2), r = Math.random();
      b.bust = r < chance ? {half:r < chance/2} : null;   // the draw is taken for every blocker, busted or not
      b.entry = {name:b.name, fam, know, kind:null}; S.bust.push(b.entry);
    }
  }
  const stunting = !again && DEF.some(isCrosser); if(!again) S.blkStunt = stunting;   // only a play with a crossing stunt rolls awareness: other plays draw no random numbers
  // B-016: claim order. A blocker whose first rule is a pull claims before any plain rule: the man he leaves the line for (a trap, a kick-out) is picked while he is still free,
  // not left after the linemen nearest the hole took everyone (the pull rule falls to the next rule when it finds no one, as before)
  if(!again) for(const b of bl){
    const r = b.spec[0]; if(b.p.blk || !r || r[0] !== 'pull' || !allowed(r)) continue;
    const d = pick(r, b.p, free(b), ctx); if(d) take(b, d, r);
  }
  for(let k = 0; k < 3; k++) for(const b of bl){
    if(b.p.blk || !b.spec[k]) continue;
    const cov = covering(b, k), open = () => free(b).filter(e => !cov.has(e));   // B-015: the men reserved for a lineman who has an `on` rule still to try
    if(b.bust && !b.entry.kind && b.spec[k] && allowed(b.spec[k]) && !['later', 'pass', 'pull', 'double'].includes(b.spec[k][0])){
      const postOf = postMan(b), own = postOf ? null : pick(b.spec[k], b.p, open(), ctx), nx = b.spec[k + 1];
      if(postOf) b.entry.kind = b.bust.half ? 'late' : 'noclimb';   // provisional: cleared at the end when no double forms
      else if(own){   // no man on this rule: no bust here, the next rule is tried (the draw was taken at the snap)
      const others = free(b).filter(d => d !== own);   // his own man stays free
      let d2 = nx && allowed(nx) && WRONG_RULES.includes(nx[0]) ? pick(nx, b.p, others, ctx) : null;
      if(!d2) d2 = pick(['line'], {x:b.p.x, y:b.p.y, lane:(b.p.lane ?? b.p.x) - ps*OL_GAP}, others, ctx);
      if(d2){ take(b, d2, ['wrong']); b.p.ruled = true; b.p.bustWrong = true; left.add(own); b.entry.kind = 'wrong'; continue; }
      b.entry.kind = 'none';
      }
    }
    // B-007-12: a Draw pass-setter (first rule 'pass', held by offense.js) takes no wrong read
    if(k === 0 && stunting && !b.bust && allowed(b.spec[0]) && allowed(b.spec[1]) && !b.o && b.spec[1] && b.spec[0][0] !== 'pass' && !['pull', 'double'].includes(b.spec[0][0]) && !['pull', 'double'].includes(b.spec[1][0]) && Math.random() < WRONG_P*lack(b.p, 'recog')){
      const d2 = pick(b.spec[1], b.p, free(b), ctx);   // a wrong read: his second-priority man, when it is a different one
      if(d2 && d2 !== pick(b.spec[0], b.p, open(), ctx)){ take(b, d2, b.spec[1]); wrong.push(b); continue; }
    }
    if(!allowed(b.spec[k])) continue;
    const d = pick(b.spec[k], b.p, open(), ctx); if(d) take(b, d, b.spec[k]);
  }
  for(const b of bl){   // a lineman or tight end with nothing named takes the nearest man in the box
    if(b.p.blk || b.o) continue;
    const d = pick(['any'], b.p, free(b), ctx); if(d) take(b, d, ['any']);
  }
  for(const b of bl){ const m = b.p.dbl; if(m && !m.post && m.mate.blk !== m.d) b.p.dbl = null; }   // the post man took someone else: a single block after all
  if(!again) for(const b of bl) if((b.entry && (b.entry.kind === 'late' || b.entry.kind === 'noclimb')) && !b.p.pull && !b.p.dbl) b.entry.kind = 'none';   // the double never formed (or was dropped): busted, nothing to bust
  if(!again) for(const b of bl){   // B-032-3: the late / noclimb kind lands on the puller or the climber
    const k = b.entry && b.entry.kind; if(k !== 'late' && k !== 'noclimb') continue;
    if(b.p.pull){ if(k === 'late') b.p.pull.late = LATE_PULL_T; else b.entry.kind = 'none'; }   // a puller only busts late
    else if(b.p.dbl && !b.p.dbl.post){ const m = b.p.dbl; if(m.src) m.src.kind = 'none'; m.bust = k; m.src = b.entry; }   // the climber's own bust wins: the post man's had no effect
    else if(b.p.dbl){ const m = b.p.dbl.mate.dbl; if(m && !m.post && !m.bust){ m.bust = k; m.src = b.entry; } else b.entry.kind = 'none'; }
  }
  if(!again) for(const b of bl){
    const d = b.p.blk;
    if(!b.o && d && isCrosser(d) && !b.p.pull && !b.p.dbl) b.p.rr = {state:'set', d, home:d.x, t:0, acc:0, miss:false};
    if(wrong.includes(b)) S.blkEv.push({name:b.name, ev:'wrong', t:0});
  }
  const lab = labels(); for(const u of pulls) S.pulls.push({name:u.name, kind:u.kind, tgt:lab.get(u.p.blk) || '?', p:u.p});
  S.blk = Object.fromEntries(bl.map(b => [b.name, b.p.blk ? lab.get(b.p.blk) || '?' : null]));
}
const allowed = r => !r || ((!r.need || !!bodyOf(r.need)) && (!r.not || !bodyOf(r.not)));   // the form's personnel decides (B-030)
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
  const extra = m.bust === 'late' ? LATE_CLIMB_T : 0;   // B-032-3: a late climber waits this much longer
  if(m.bust === 'noclimb' && !m.mate.falling) return;   // stays on the double while the post man is up
  const near = m.t > extra && DEF.some(e => backer(e) && commit(e));
  if(m.t < CLIMB_T + extra && !near) return;
  const lb = nearest(DEF.filter(e => backer(e) && dist(e, p) < CLIMB_RANGE && e.y >= p.y - BEHIND_Y), e => dist(e, p));
  if(!lb) return;
  p.blk = lb; p.ruled = true; m.state = 'climbing'; m.lb = lb; if(m.mate.dbl) m.mate.dbl.state = 'released'; S.climbed = true;
  (S.climbRec || (S.climbRec = [])).push({p, lb, t0:S.clock, land:null, fill:null});   // B-012 (climb-timing): the sim's climb-before-fill readout
}
// the puller's check, every frame from offense.js while he has a pull: engaged when he reaches the target, free when the target goes down
export function pullCheck(p, dt){
  const m = p.pull; if(!m || m.state === 'free') return;
  m.t += dt;
  if(m.tgt.stun > 0 || p.blk !== m.tgt){ m.state = 'free'; p.via = null; return; }
  if(m.state === 'pulling' && dist(p, m.tgt) < ENGAGED){ m.state = 'engaged'; m.reach = m.t; p.via = []; }   // B-061: reached him: drop the rest of the path so driveAt locks him this frame (the led waypoint can run ahead of a man who is already in reach)
}
