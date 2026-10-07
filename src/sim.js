import { KEYS, MENTAL } from './ratings.js';   // ratings.js, roster.js, formations.js (pure) and util.js roll nothing at load, so importing them before seedRandom runs is safe
import { BOX_X as BOX_DX, formByName } from './formations.js';
import { ROSTER, fieldCounts, persName, rateRosters } from './roster.js';
import { BODY_H, BODY_W, FACE_RATE, HOLD_R, PILE_R, bearing, faceLean, faceYaw } from './util.js';

// ---------- SIM OUTPUT FIELDS (the one line in <pre id="simout">; CLAUDE.md "Sim check" points here) ----------
// Run: ?sim=N&seed=S (same seed, same line). Force params: &play=<run play>&front=<defensive call> (case-insensitive; an unknown or pass play gives {"error":...}), &form=&side=L|R
// (echoed only until B-007-3/4), &olrecog=N (every OL and TE recog, re-applied after each team regen), &know=N (B-032-4: zone/gap/pass of every OL, TE and FB, same re-apply), &pers=11|12|21|22 and &dpers=nickel|base|odd (aliases 4-2-5, 4-3-4, 3-4-4; also work
// on a normal page load; unknown gives {"error":...}). The dump is written when the sim finishes: ~35-40 s for N=100 under swiftshader (~0.4 s a play; N=300 wants alarm 180+).
// Fields:
//   plays, timeouts, ypc, stuffPct (yards <= 0), bigPct (yards >= 10), yards {mean, median, p10, p90, max}
//   spotYards {mean, median}: the spot endPlay ended at minus los; a score or turnover uses the last ball y
//   teams {regens, every, O, D}: mean ratings; rateTeams runs every SIM_TEAM_EVERY = 20 plays, a no-op under flat ratings
//   pileWindows, pushPlays, pushPlayRate, pushDurS, pushGainYd; pile {whistles, frames per state, pushPlays, pushGainYd, pushDurS}: pile.js's own record of plays that reached pushing (session totals)
//   B-008/B-010 pile shape: stillPlays/stillMaxS (plays where the runner, in contact (touched within 1 s), moved under STILL_V yd/s for over STILL_S s in a row; the longest such stretch, s),
//     flatPct/flatFrames (share of frames (live, then POST_S 1 s of dead ball after the whistle) a body off his feet STAY_T s or more and on the turf or with the torso top under BODY_H yd (a tackler hanging upright on a runner still on his feet is not a pile body) had its torso within FLAT_DEG of horizontal), heightLayers {median, p90, max} (per play, the highest torso top of a body off his feet STAY_T s or more and on the turf or with the torso top under BODY_H yd (a tackler hanging upright on a runner still on his feet is not a pile body), in body widths (FLAT_H 0.66 BODY_W: a body lying on his side; on his back or front he is 0.4 BODY_W)),
//     playS {median, p90, max} (live seconds from the snap to the end of the play)
//   bodiesMax: total physics body count; pile counters count tackle/ragdoll bodies only (p.ph && !p.ph.bubble)
//   physMs {median/p95}: NOT reliable here (performance.now does not advance in one synchronous task): never compare; use ?debug in a real browser for frame and physics ms
//   read {n: zone plays decided, noDecision: stuffed before deciding, wrongPct: share not the noiseless best lane, choices {name: {n, ypc}}, wrongYpc, rightYpc} (from S.read)
//   blk {"front R|L": {slot: {target label: n}}} (B-030): S.blk at the snap per defensive front and flip (R = tight end right), keyed by the rule slot (the play's base side: a flipped play's LT is the base RT), the target labels from blockrules.js labels() (DL0.. left to right on the field, LB0.., CB, S);
//     pullReach {"slot kind" (base slot): {n, reached, pct}}: pullers per slot and kind, and how many got within ENGAGED of the target at some point in the play (p.pull.reach set)
//   force; byPlay; boxMean; freeBox
//   blkEv {stuntPlays: plays with a crossing stunt (slants count) at the snap, passed, missed, wrong}: blockers' stunt re-read events from S.blkEv
//   bust {plays, rolled, byFamily {zone, gap: {rolled, busts, pct, byKind {wrong, none, late, noclimb: n}}}, byBand {"0-19".."80-99": {rolled, busts, pct}}} (B-032-4): from S.bust (blockrules.js), read at the end of each play that snapped;
//     rolled = blockers who took a draw (a null kind is rolled, not a bust); byKind counts every non-null kind, 'none' included; busts and pct count only wrong, late and noclimb ('none' is a bust that changed nothing, so it is not counted);
//     pct = 100*busts/rolled; byBand groups by the blocker's knowledge for the play's family (his rating, floored to bands of 20; know 99 is in 80-99). &know=N sets zone, gap and pass of every OL, TE and FB (re-applied after each team regen), echoed as force.know; a non-number or a value outside 0-99 gives {"error":...} ("know out of range N")
//   calls {play: n}, byFront {front: {play: n}}, slant {'Slant Left','Slant Right': {play: n}}: what the CPU called (B-007-13)
//   with &pers/&dpers: force.pers/dpers, field {off, def} (position counts on the last play) and roster {O, D, ids unique, on}
//   facing {frames, sqPct, errDeg, leanDeg, maxLeanDeg, maxOffDeg, heldFrames, sqPctWithHeld, errDegWithHeld, turnBack {n, medianS, p90S}, holdTurnBack {n, medianS, p90S}} (B-020):
//     a shadow face per defender turned by animate's rule (the sim never runs animate); sqPct/errDeg/leanDeg over battle frames (sqPct within 25 deg of square, errDeg off-square with the
//     intended lean removed); turnBack: seconds from a shed until the shadow face is within 25 deg of his velocity heading (still frames dropped).
//     B-023: the hold-through-a-gap rule is gone, so heldFrames is 0, sqPctWithHeld = sqPct, errDegWithHeld = errDeg and holdTurnBack.n is 0.
//   jitter {D, O: frames, turnDegPerFrame, reversalsPerS, posJitterYd, leanStepDeg, bearStepDeg, leanFlipsPerS, byErr {frameShare, turnShare} by error under JIT_SMALL_DEG / to JIT_ONSET_DEG / over;
//     D only: bigTurnOnsets {perS, mode, jump, slow}, modeSwitchesPerS (per engaged second)} (B-022)
//   jitterLost {lost {reason: n}, flickerBack}: a defender's faceAt target lost (it goes with his battle); reasons (B-023) stun | tow (a blocker running past him ended it) | freeT (a shed) | ended (any other end); flickerBack: re-engaged within JIT_FLICKER_S
//   pair {frames, minD, medD, p90D, overlapPct, farPct} (B-023): the centre distance between a defender and his blocker over live battle frames (yd); overlapPct: share under BODY_W; farPct: share over PAIR_FAR 1.0
//   battles {formed, set, move, recover} (B-023): battle objects formed, and how many reached each phase
//   fire {n, medYd, p10Yd, p90Yd, backPct, n3, med3Yd, back3Pct} (B-023): each DL's depth gain (yd, > 0 = forward) from the first live frame to his first battle forming (n..backPct) and to FIRE_T 0.3 s after it (n3, med3Yd, back3Pct, only that first battle if it lasts that long); back: share pushed back

// ---------- sim runner ----------
// ?sim=N&seed=S: plays N CPU run plays with no rendering and writes one JSON line into <pre id="simout">.
// Pile stats (and the B-008/B-010 shape keys) come from game state (tackle/ragdoll bodies near the holder, p.ph without .bubble), not from any pile code.
// physMs is null under --virtual-time-budget (performance.now does not advance during synchronous code); read it with a real clock
const BAND_W = 20, BAND_NAMES = ['0-19', '20-39', '40-59', '60-79', '80-99'], BUST_KINDS = ['wrong', 'late', 'noclimb'], KNOW_POS = ['OL', 'TE', 'FB'];   // B-032-4
const SQUARE_DEG = 25, FACE_V = 0.4, TURN_MAX = 2, SIM_DT = 1/60, WINDOW_T = 0.4, PUSH_GAIN = 0.5, PLAY_MAX_S = 40, BOX_DY = 5, BOX_CX = 0, SIM_TEAM_EVERY = 20, BIG_YD = 10, STUFF_YD = 0, FLAT_H = 0.66*BODY_W, STILL_V = 0.3, STILL_S = 1, STAY_T = 1, FLAT_DEG = 30, POST_S = 1;   // box: defenders within BOX_DY of the line and BOX_DX of the snap spot (field x BOX_CX; the center drifts by the handoff)

// mulberry32; replaces Math.random only when ?sim is on. It runs when this module loads, and main.js imports
// sim.js first and its imports (ratings.js, formations.js, roster.js, util.js) are pure and roll nothing at load, so player ratings and masses (rolled at load) are seeded too.
const Q = new URLSearchParams(location.search);
if(Q.has('sim')) seedRandom(Number(Q.get('seed')) || 1);
function seedRandom(seed){
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const pct = (xs, q) => { if(!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(q*s.length))].toFixed(3); };
const med = xs => { if(!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return +(s.length % 2 ? s[m] : (s[m-1] + s[m])/2).toFixed(3); };
const mean = xs => xs.length ? +(xs.reduce((a, b) => a + b, 0)/xs.length).toFixed(3) : null;
function out(o){
  const el = document.createElement('pre'); el.id = 'simout'; el.textContent = JSON.stringify(o); document.body.appendChild(el);
}

// g: the game objects, passed in by main.js so this file's only import is ratings.js (it must load before any module that rolls random numbers)
export function runSim(n, step, g){
  const {physBall, physCount, physDown, physPose, physSpeed, perf, ALL, OFF, DEF, RB, PLAYS, DEF_CALLS, nextPlay, newGame, setupPlay, S, ball} = g;
  const ballY = h => h.ph ? 50 - physBall(h).z : h.y;
  if(!window.CANNON){ out({error:'physics failed to load'}); return; }
  // forced choices: names match case-insensitively and are stored canonical; form and side wait for B-007-3/4
  const byName = (list, v) => v == null ? null : list.find(x => x.name.toLowerCase() === v.trim().toLowerCase());
  const force = {play:null, form:null, front:null, side:null, pers:null, dpers:null};
  for(const [key, list, label] of [['play', PLAYS.filter(p => p.run), 'play'], ['front', DEF_CALLS, 'front']]){
    if(!Q.has(key)) continue;
    const hit = byName(list, Q.get(key));
    if(!hit){ out({error:'unknown ' + label + ' ' + Q.get(key)}); return; }
    force[key] = hit.name;
  }
  for(const [key, kind] of [['pers', 'off'], ['dpers', 'def']]){   // personnel: pers 11|12|21|22, dpers nickel|base|odd (also 4-2-5, 4-3-4, 3-4-4)
    if(!Q.has(key)) continue;
    const v = persName(kind, Q.get(key));
    if(!v){ out({error:'unknown ' + key + ' ' + Q.get(key)}); return; }
    force[key] = v;
  }
  if(Q.has('form')){   // an offensive formation (formations.js); it brings its own personnel, so a ?pers= that disagrees is an error
    const f = formByName(Q.get('form'));
    if(!f){ out({error:'unknown form ' + Q.get('form')}); return; }
    if(force.pers && force.pers !== f.pers){ out({error:'form ' + f.name + ' is personnel ' + f.pers + ', not ' + force.pers}); return; }
    force.form = f.name;
  }
  if(Q.has('side')){
    const sd = Q.get('side').toUpperCase();
    if(sd !== 'L' && sd !== 'R'){ out({error:'unknown side ' + Q.get('side')}); return; }
    force.side = sd;
  }
  const fp = force.play && PLAYS.find(p => p.name === force.play);   // B-007-10: a forced play with a formation list rejects a form or personnel it cannot run from
  if(fp && fp.forms && ((force.form && !fp.forms.includes(force.form)) || (force.pers && !fp.forms.some(n => formByName(n).pers === force.pers)))){ out({error:fp.name + ' runs from ' + fp.forms.join(', ') + ', not ' + (force.form || 'personnel ' + force.pers)}); return; }
  S.force = force;   // read by cpu.js (play), state.js (front) and later formations and flip
  if(force.front || force.pers || force.dpers || force.form || force.side) setupPlay();   // the first play was set up before the force existed
  const yards = [], spotYards = [], wins = [], physMs = [];
  const byPlay = {}, boxes = [], frees = [], calls = {}, byFront = {}, byCall = {}, tally = (o, k) => { o[k] = (o[k] || 0) + 1; };   // B-007-13: counts of the plays run, overall, per front, per defensive call
  // B-020: animate() does not run here, so p.face never moves. Each defender gets a shadow face that turns by animate's rule
  // (face += wrap(target - face)*min(1, dt*FACE_RATE); target = faceYaw, else his velocity heading when speed > FACE_V), reset each play to his p.face.
  // Engaged frames (a battle, not a body, not stunned) score the shadow face against the bearing to his blocker or nearest double-teamer:
  // errDeg = off square with the intended lean removed, leanDeg = the lean itself, sqPct = share of frames within SQUARE_DEG of square including the lean.
  // Turn-back: from a battle ending (shed, step-around) until the shadow face is within SQUARE_DEG of his velocity heading, capped at TURN_MAX s.
  const fc = {frames:0, square:0, err:0, lean:0, maxLean:0, maxOff:0, hFrames:0, hSquare:0, hErr:0}, shadow = new Map(), turn = {shed:[], hold:[]};
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), deg = r => r*180/Math.PI;
  // B-022 jitter: every engaged player (a battle object, live, not a body; blockers and defenders apart) gets a shadow face turned by
  // animate's rule. Per engaged frame: |turn| of the shadow face, a reversal when the turn's sign flips (turns under JIT_EPS rad ignored),
  // and the position's second difference |x[t] - 2x[t-1] + x[t-2]| (yd, both axes) for position jitter that is not facing.
  const JIT_EPS = 0.002, JIT_ONSET_DEG = 25, JIT_JUMP_DEG = 10, JIT_SMALL_DEG = 10, JIT_FLICKER_S = 0.5, jit = {D:{n:0, turn:0, rev:0, pos:0, lean:0, bear:0, flips:0, b:[0,0,0], nb:[0,0,0], sw:0, on:0, onMode:0, onJump:0, onSlow:0}, O:{n:0, turn:0, rev:0, pos:0, lean:0, bear:0, flips:0, b:[0,0,0], nb:[0,0,0], on:0, onMode:0, onJump:0, onSlow:0}}, js = new Map(); jit.lost = {}; jit.flicker = 0;
  const jitter = () => {
    const battles = new Set(DEF.filter(d => d.bt).map(d => d.bt));   // a blocker's p.bt goes stale in a sim (animate never clears it): he is engaged only while his defender holds the same battle
    for(const p of ALL){
      const m = js.get(p) || (js.set(p, {f:p.face, ds:0, x1:null, y1:null, x2:null, y2:null, ok:0}), js.get(p));
      const sp = Math.hypot(p.vx, p.vy), fy = faceYaw(p, ball, S), tgt = fy !== null ? fy : (sp > FACE_V ? Math.atan2(p.vx, -p.vy) : null);
      let turn = 0, err = 0, lean = null, bear = null; const ft = p.faceAt;
      if(fy !== null && ft){ lean = faceLean(p, ft, ball, S); bear = bearing(p, ft); }
      if(!p.ph && p.act !== 'down' && p.act !== 'dive' && p.act !== 'fall' && tgt !== null){ const e = err = wrap(tgt - m.f); turn = e*Math.min(1, SIM_DT*FACE_RATE); m.f += turn; }
      const eng = (p.team === 'D' ? !!p.bt : battles.has(p.bt)) && !p.ph && !p.latch && p.stun <= 0 && p.act !== 'down';
      if(p.team === 'D' && (eng || m.wasEng) && tgt !== null){   // big-turn onsets (target over JIT_ONSET_DEG off the face, the frame before it was not) and what moved: the target kind (faceAt vs heading), a jump of the target, or the face lagging a moving one
        const big = Math.abs(deg(err)) > JIT_ONSET_DEG, was = m.big === true;
        if(big && !was){ jit.D.on++; if(m.fyNull !== (fy === null)) jit.D.onMode++; else if(m.tgt !== undefined && Math.abs(deg(wrap(tgt - m.tgt))) > JIT_JUMP_DEG) jit.D.onJump++; else jit.D.onSlow++; }
        m.big = big;
      } else m.big = false;
      if(p.team === 'D' && m.fyNull !== undefined && m.fyNull !== (fy === null) && (eng || m.wasEng || (m.lostAt !== undefined && S.clock - m.lostAt < JIT_FLICKER_S))) jit.D.sw++;   // the target switched between his blocker and his heading, near a battle
      if(p.team === 'D' && m.fyNull === false && fy === null && !p.ph){   // faceAt target lost: why (stun, a shed, or another end), and whether it came back within JIT_FLICKER_S
        const why = p.stun > 0 ? 'stun' : p.towT === S.clock ? 'tow' : p.freeT > 0 ? 'freeT' : 'ended';   // B-023: his faceAt goes only with his battle: a shed (freeT), a tow end (blocker running past), a stun, or another end (pancake and release show as stun or ended)
        jit.lost[why] = (jit.lost[why] || 0) + 1; m.lostAt = S.clock;
      }
      if(p.team === 'D' && m.fyNull === true && fy !== null && m.lostAt !== undefined && S.clock - m.lostAt < JIT_FLICKER_S) jit.flicker++;
      m.wasEng = eng; m.fyNull = fy === null; m.tgt = tgt;
      if(eng){
        const j = jit[p.team];
        m.ok++; j.n++; j.turn += Math.abs(turn);
        { const bk = Math.abs(deg(err)) < JIT_SMALL_DEG ? 0 : Math.abs(deg(err)) < JIT_ONSET_DEG ? 1 : 2; j.b[bk] += Math.abs(turn); j.nb[bk]++; }   // where the turning comes from: frames within 10 deg of the target, 10-25, over 25
        if(m.ok > 1){   // target changes: the lean term, the bearing term, a sign flip of the lean, the target switching between faceAt and the heading
          if(lean !== null && m.lean !== null){ j.lean += Math.abs(lean - m.lean); j.bear += Math.abs(wrap(bear - m.bear)); if(Math.abs(lean) > 0.01 && Math.abs(m.lean) > 0.01 && Math.sign(lean) !== Math.sign(m.lean)) j.flips++; }
        }
        if(Math.abs(turn) > JIT_EPS){ const sg = Math.sign(turn); if(m.ds && sg !== m.ds) j.rev++; m.ds = sg; }
        if(m.ok >= 3 && m.x2 !== null) j.pos += Math.hypot(p.x - 2*m.x1 + m.x2, p.y - 2*m.y1 + m.y2);
      } else { m.ok = 0; m.ds = 0; }
      m.lean = lean; m.bear = bear; m.x2 = m.x1; m.y2 = m.y1; m.x1 = p.x; m.y1 = p.y;
    }
  };
  // B-023 engagement: every live battle frame logs the centre distance between the defender and his blocker (histogram, PAIR_BIN yd bins), overlap (under BODY_W) and far (over PAIR_FAR) frames,
  // and each battle object counts once per phase it reached (battles: formed, then set, move, recover).
  const PAIR_BIN = 0.01, PAIR_BINS = 300, PAIR_FAR = 1.0, pairH = new Array(PAIR_BINS).fill(0), bseen = new WeakMap(), bat = {formed:0, set:0, move:0, recover:0}, pr = {n:0, over:0, far:0, min:Infinity}, fire = {y0:new Map(), got:new Set(), got3:new Set(), gotB:new Map(), fwd:[], fwd3:[]}, FIRE_T = 0.3;   // fire: each DL's depth at the first live frame, and how far upfield-to-backfield he got by the time his first battle formed (yd; > 0 = forward)
  const pairQ = q => { let k = 0, c = 0; while(k < PAIR_BINS - 1 && c + pairH[k] < q*pr.n) c += pairH[k++]; return +((k + 0.5)*PAIR_BIN).toFixed(3); };
  const facing = () => {
    jitter();
    for(const d of DEF){
      if(d.role === 'DL' && !fire.y0.has(d)) fire.y0.set(d, d.y);
      if(d.bt && !d.ph && !d.latch){
        const dd = Math.hypot(d.x - d.bt.o.x, d.y - d.bt.o.y); pairH[Math.min(PAIR_BINS - 1, Math.floor(dd/PAIR_BIN))]++; pr.n++; pr.min = Math.min(pr.min, dd);
        if(d.role === 'DL' && d.bt.age >= FIRE_T && fire.gotB.get(d) === d.bt && !fire.got3.has(d)){ fire.got3.add(d); fire.fwd3.push(fire.y0.get(d) - d.y); }
        if(dd < BODY_W) pr.over++; if(dd > PAIR_FAR) pr.far++;
        let r = bseen.get(d.bt); if(!r){ r = new Set(); bseen.set(d.bt, r); bat.formed++; if(d.role === 'DL' && fire.y0.has(d) && !fire.got.has(d)){ fire.got.add(d); fire.gotB.set(d, d.bt); fire.fwd.push(fire.y0.get(d) - d.y); } }
        if(!r.has(d.bt.phase)){ r.add(d.bt.phase); bat[d.bt.phase]++; }
      }
      let m = shadow.get(d); if(!m){ m = {f:d.face, eng:false, hold:false, t:null, k:null}; shadow.set(d, m); }
      const sp = Math.hypot(d.vx, d.vy), fy = faceYaw(d, ball, S), vy = sp > FACE_V ? Math.atan2(d.vx, -d.vy) : null, tgt = fy !== null ? fy : vy;
      if(!d.ph && d.act !== 'down' && d.act !== 'dive' && d.act !== 'fall' && tgt !== null) { const e = wrap(tgt - m.f); m.f += e*Math.min(1, SIM_DT*FACE_RATE); }
      const live = !d.ph && !d.latch && d.stun <= 0, eng = !!d.bt && live, hold = false;   // B-023: no hold-through-a-gap rule any more; the fields stay (heldFrames 0)
      if(eng || hold){
        const qs = [...(d.bt ? [d.bt.o] : []), ...(d.faceAt ? [d.faceAt] : []), ...OFF.filter(q => q.blk === d && !(q.ph && q.ph.bubble) && Math.hypot(q.x - d.x, q.y - d.y) < HOLD_R)];
        let e = Infinity, off = Infinity, lean = 0;
        for(const q of qs){
          const l = faceLean(d, q, ball, S), x = Math.abs(wrap(m.f - bearing(d, q) - l)), y = Math.abs(wrap(m.f - bearing(d, q)));
          if(x < e){ e = x; off = y; lean = Math.abs(l); }
        }
        if(eng){
          fc.frames++; fc.err += e; fc.lean += lean; if(deg(off) <= SQUARE_DEG) fc.square++;
          fc.maxLean = Math.max(fc.maxLean, lean); fc.maxOff = Math.max(fc.maxOff, off);
        } else { fc.hFrames++; fc.hErr += e; if(deg(off) <= SQUARE_DEG) fc.hSquare++; }
      }
      if(!eng && m.eng && live && d.freeT > 0.8){ m.t = 0; m.k = 'shed'; }   // he just shed his blocker (freeT is set to 0.9 then): time the turn back
      else if(!hold && m.hold && !d.bt && live){ m.t = 0; m.k = 'hold'; }    // a hold just ended with no battle: time the turn back too
      m.eng = eng; m.hold = hold;
      if(m.t !== null){
        if(!live) m.t = null;
        else {
          m.t += SIM_DT;
          if(vy === null) m.t = null;   // standing still after the shed or the hold: no heading to turn back to, not a turn-back
          else if(vy !== null && Math.abs(wrap(m.f - vy)) <= SQUARE_DEG*Math.PI/180){ turn[m.k].push(m.t); m.t = null; }
          else if(m.t >= TURN_MAX){ turn[m.k].push(TURN_MAX); m.t = null; }
        }
      }
    }
  };
  const stillMax = [], flat = {n:0, ok:0}, heights = [], playLen = []; let stillPlays = 0;
  let hMax = 0;
  const fallen = () => { for(const p of ALL) if(p.ph && !p.ph.bubble && physPose(p).fallT >= STAY_T && (physDown(p) || physPose(p).topY < BODY_H)){   // fallen bodies: tilt and height
    const q = physPose(p); flat.n++; if(Math.abs(q.spineY) < Math.sin(FLAT_DEG*Math.PI/180)) flat.ok++;
    hMax = Math.max(hMax, q.topY);
  } };
  let timeouts = 0, pushPlays = 0, bodiesMax = 0, win = null;
  const closeWin = () => {   // a window counts once it lasted WINDOW_T
    if(win && win.t >= WINDOW_T) wins.push({dur:win.t, gain:win.y1 - win.y0, off:win.off});
    win = null;
  };
  const teamAvg = side => { const ps = ALL.filter(p => p.team === side), o = {}; KEYS.forEach(k => { o[k] = mean(ps.map(p => p.rt[k])); }); return o; };
  // B-032-4 (bust-sim): &know=N forces zone/gap/pass of every OL, TE and FB; bust tallies from S.bust (blockrules.js entries {name, fam, know, kind})
  let knowN = null;
  if(Q.has('know')){ const kv = Q.get('know').trim(); knowN = kv === '' ? NaN : Number(kv); if(!Number.isFinite(knowN)){ out({error:'unknown know ' + Q.get('know')}); return; }
    if(knowN < 0 || knowN > 99){ out({error:'know out of range ' + knowN}); return; }   // ratings are 0-99
    force.know = knowN; }
  const bustT = {plays:0, rolled:0, byFamily:{zone:{rolled:0, busts:0, byKind:{}}, gap:{rolled:0, busts:0, byKind:{}}}, byBand:BAND_NAMES.map(() => ({rolled:0, busts:0}))};
  const tallyBust = list => {
    bustT.plays++;
    for(const e of list){
      const f = bustT.byFamily[e.fam], b = bustT.byBand[Math.max(0, Math.min(BAND_NAMES.length - 1, Math.floor(e.know/BAND_W)))], hit = e.kind && BUST_KINDS.includes(e.kind);
      bustT.rolled++; f.rolled++; b.rolled++;
      if(e.kind) f.byKind[e.kind] = (f.byKind[e.kind] || 0) + 1;
      if(hit){ f.busts++; b.busts++; }
    }
  };
  const olRecog = Q.has('olrecog') ? Number(Q.get('olrecog')) : null, blkEv = {stuntPlays:0, passed:0, missed:0, wrong:0};   // B-007-9: force OL+TE awareness; count the re-read events
  const setRecog = () => {
    if(knowN !== null) [...ROSTER.O.filter(r => KNOW_POS.includes(r.pos)), ...OFF.filter(o => KNOW_POS.includes(o.pos))].forEach(r => { MENTAL.forEach(k => { r.rt[k] = knowN; }); });   // B-032-4
    if(olRecog === null) return; [...ROSTER.O.filter(r => r.pos === 'OL' || r.pos === 'TE'), ...OFF.filter(o => o.pos === 'OL' || o.pos === 'TE')].forEach(r => { r.rt.recog = olRecog; }); };
  setRecog();
  const blkLog = {}, pullReach = {}, MIRROR_SLOT = {LT:'RT', RT:'LT', LG:'RG', RG:'LG'}, slotOf = nm => S.flip > 0 ? nm : MIRROR_SLOT[nm] || nm;   // B-030: a copy of blockrules.js MIRROR on purpose (sim.js must load before players.js, which rolls at load, so it cannot import blockrules.js): the rule slot (the play's base side), whichever way the play flipped
  let regens = 0, fieldO = null, fieldD = null; const reads = [];   // S.read per play (B-006-3): {key, choice, wrong}, null when the play had no zone read
  for(let i = 0; i < n; i++){
    shadow.clear(); js.clear(); fire.y0.clear(); fire.got.clear(); fire.got3.clear(); fire.gotB.clear(); DEF.forEach(p => { p.towT = undefined; });
    hMax = 0; let stillT = 0, stillBest = 0, liveT = 0, startY = null, endY = 0, t = 0, pushed = false, pname = null, measured = false, pullsNow = []; const drive0 = S.drive;
    while(S.phase !== 'dead' && t < PLAY_MAX_S){
      step(SIM_DT); t += SIM_DT; if(S.phase === 'live') facing();
      fallen();
      const c = ball.state === 'held' ? ball.holder : null;
      if(S.phase === 'live' && c){
        const y = ballY(c); if(startY === null){ startY = S.los; pname = PLAYS[S.play].name; tally(calls, pname); tally(byFront[S.front] || (byFront[S.front] = {}), pname); tally(byCall[S.defCall.name] || (byCall[S.defCall.name] = {}), pname);
          const bf = blkLog[S.front + ' ' + (S.flip > 0 ? 'R' : 'L')] || (blkLog[S.front + ' ' + (S.flip > 0 ? 'R' : 'L')] = {}); for(const [nm, tg] of Object.entries(S.blk || {})){ const bn = slotOf(nm), bs = bf[bn] || (bf[bn] = {}); bs[tg] = (bs[tg] || 0) + 1; }
          pullsNow = (S.pulls || []).slice(); }   // B-007-13: call shares overall, per front, per defensive call
        endY = y;
        if(c === RB && !measured){   // the back gets the ball: count the box, and who is free in it
          measured = true;
          const inBox = DEF.filter(d => Math.abs(d.y - S.los) <= BOX_DY && Math.abs(d.x - BOX_CX) <= BOX_DX);
          boxes.push(inBox.length);
          frees.push(inBox.filter(d => d.stun <= 0 && !(d.eng > 0) && !d.bt && !OFF.some(o => o.blk === d)).length);
        }
        const cnt = physCount(); bodiesMax = Math.max(bodiesMax, cnt.players);
        if(cnt.players) physMs.push(perf.phys);
        liveT += SIM_DT;
        if(c.ph && physPose(c).touched && physSpeed(c) < STILL_V){ stillT += SIM_DT; stillBest = Math.max(stillBest, stillT); } else stillT = 0;
        const near = ALL.filter(p => p !== c && p.ph && !p.ph.bubble && Math.hypot(p.x - c.x, p.y - c.y) < PILE_R);
        if(!(c.ph && physDown(c)) && near.length >= 2){
          if(!win) win = {t:0, y0:y, y1:y, off:false};
          win.t += SIM_DT; win.y1 = y; if(near.some(p => OFF.includes(p))) win.off = true;
        } else closeWin();
      }
    }
    closeWin();
    for(const u of pullsNow){ const pk = slotOf(u.name) + ' ' + u.kind, r = pullReach[pk] || (pullReach[pk] = {n:0, reached:0}); r.n++; if(u.p.pull && u.p.pull.reach !== null) r.reached++; }
    for(let k = 0; k < POST_S/SIM_DT && S.phase === 'dead'; k++){ step(SIM_DT); fallen(); }   // the dead ball: the pile settles, measured POST_S s after the whistle (S.deadT is 2.2 s, so no next play starts)
    if(startY !== null && S.bust) tallyBust(S.bust);   // B-032-4: the plays that snapped
    if(startY !== null){ playLen.push(liveT); if(stillBest > STILL_S) stillPlays++; stillMax.push(stillBest); if(hMax > 0) heights.push(hMax/FLAT_H); }
    fieldO = fieldCounts(OFF); fieldD = fieldCounts(DEF);   // who was on the field for this play (pos counts), the last play's printed
    const timedOut = S.phase !== 'dead';   // hit PLAY_MAX_S: counted in timeouts, left out of yards
    if(timedOut) timeouts++;
    else if(startY !== null){
      yards.push(endY - startY);
      if(S.read) reads.push({...S.read, y:endY - startY});
      spotYards.push((S.drive === drive0 ? S.los : endY) - startY);   // where endPlay spotted it (forward progress included); a drive change (score, turnover, safety) resets los, so those use the last ball y
      const b = byPlay[pname] || (byPlay[pname] = {ys:[], stuff:0}); b.ys.push(endY - startY); if(endY - startY <= STUFF_YD) b.stuff++;
    }
    const played = wins.filter(w => w.play === undefined); played.forEach(w => { w.play = i; });
    if(played.some(w => w.off && w.gain >= PUSH_GAIN)) pushed = true;
    if(pushed) pushPlays++;
    if((i + 1) % SIM_TEAM_EVERY === 0 && i + 1 < n && !S.over){ rateRosters(); regens++; }   // fresh teams every SIM_TEAM_EVERY plays (a no-op change under flat ratings); skipped when the game just ended, since newGame rates again
    if(S.blkStunt) blkEv.stuntPlays++;   // B-007-9: plays with a crossing stunt at the snap
    if(S.blkEv) S.blkEv.forEach(e => { blkEv[e.ev]++; });
    nextPlay(); if(S.phase === 'over') newGame();   // a finished game starts the next one
    setRecog();   // B-007-9
  }
  const pushes = wins.filter(w => w.off && w.gain >= PUSH_GAIN);
  const byPlayOut = {}; for(const k of Object.keys(byPlay).sort()){ const b = byPlay[k]; byPlayOut[k] = {n:b.ys.length, ypc:mean(b.ys), stuffPct:+(100*b.stuff/b.ys.length).toFixed(1)}; }
  const bustOut = {plays:bustT.plays, rolled:bustT.rolled, byFamily:Object.fromEntries(Object.entries(bustT.byFamily).map(([k, f]) => [k, {rolled:f.rolled, busts:f.busts, pct:f.rolled ? +(100*f.busts/f.rolled).toFixed(1) : null, byKind:f.byKind}])), byBand:Object.fromEntries(BAND_NAMES.map((nm, i) => [nm, {rolled:bustT.byBand[i].rolled, busts:bustT.byBand[i].busts, pct:bustT.byBand[i].rolled ? +(100*bustT.byBand[i].busts/bustT.byBand[i].rolled).toFixed(1) : null}]))};
  out({plays:n, timeouts, ypc:mean(yards), stuffPct:yards.length ? +(100*yards.filter(y => y <= STUFF_YD).length/yards.length).toFixed(1) : null, bigPct:yards.length ? +(100*yards.filter(y => y >= BIG_YD).length/yards.length).toFixed(1) : null,
    spotYards:{mean:mean(spotYards), median:med(spotYards)}, yards:{mean:mean(yards), median:med(yards), p10:pct(yards, 0.1), p90:pct(yards, 0.9), max:yards.length ? +Math.max(...yards).toFixed(3) : null}, pileWindows:wins.length, pile:{whistles:S.pile.whistles, frames:S.pile.frames, pushPlays:S.pile.pushes.length, pushGainYd:{median:med(S.pile.pushes.map(x => x.gain)), p90:pct(S.pile.pushes.map(x => x.gain), 0.9)}, pushDurS:{median:med(S.pile.pushes.map(x => x.dur)), p90:pct(S.pile.pushes.map(x => x.dur), 0.9)}}, pushPlays, pushPlayRate:+(pushPlays/n).toFixed(3),
    pushDurS:{median:med(pushes.map(w => w.dur)), p90:pct(pushes.map(w => w.dur), 0.9)},
    pushGainYd:{median:med(pushes.map(w => w.gain)), p90:pct(pushes.map(w => w.gain), 0.9)},
    stillPlays, stillMaxS:{p90:pct(stillMax, 0.9), max:stillMax.length ? +Math.max(...stillMax).toFixed(2) : null}, flatFrames:flat.n, flatPct:flat.n ? +(100*flat.ok/flat.n).toFixed(1) : null, heightLayers:{median:med(heights), p90:pct(heights, 0.9), max:heights.length ? +Math.max(...heights).toFixed(2) : null}, playS:{median:med(playLen), p90:pct(playLen, 0.9), max:playLen.length ? +Math.max(...playLen).toFixed(2) : null},
    bodiesMax, physMs:physMs.some(x => x > 0) ? {median:med(physMs), p95:pct(physMs, 0.95)} : {median:null, p95:null},
    read:{n:reads.filter(r => r.choice).length, noDecision:reads.filter(r => !r.choice).length, wrongPct:reads.some(r => r.choice) ? +(100*reads.filter(r => r.wrong).length/reads.filter(r => r.choice).length).toFixed(1) : null, choices:reads.filter(r => r.choice).reduce((o, r) => { const c = o[r.choice] || (o[r.choice] = {n:0, ypc:0}); c.ypc = +((c.ypc*c.n + r.y)/++c.n).toFixed(2); return o; }, {}), wrongYpc:mean(reads.filter(r => r.choice && r.wrong).map(r => r.y)), rightYpc:mean(reads.filter(r => r.choice && !r.wrong).map(r => r.y))},
    blk:blkLog, pullReach:Object.fromEntries(Object.entries(pullReach).map(([k, r]) => [k, {...r, pct:+(100*r.reached/r.n).toFixed(1)}])),
    force, field:{off:fieldO, def:fieldD}, roster:{O:ROSTER.O.length, D:ROSTER.D.length, ids:new Set([...ROSTER.O, ...ROSTER.D].map(r => r.id)).size, on:ALL.map(p => p.id).join(' ')}, teams:{regens, every:SIM_TEAM_EVERY, O:teamAvg('O'), D:teamAvg('D')}, byPlay:byPlayOut, calls, byFront, slant:{'Slant Left':byCall['Slant Left'] || {}, 'Slant Right':byCall['Slant Right'] || {}}, boxMean:mean(boxes), freeBox:mean(frees), blkEv, bust:bustOut, jitterLost:{lost:jit.lost, flickerBack:jit.flicker}, pair:{frames:pr.n, minD:pr.n ? +pr.min.toFixed(3) : null, medD:pr.n ? pairQ(0.5) : null, p90D:pr.n ? pairQ(0.9) : null, overlapPct:pr.n ? +(100*pr.over/pr.n).toFixed(2) : null, farPct:pr.n ? +(100*pr.far/pr.n).toFixed(2) : null}, battles:bat, fire:{n:fire.fwd.length, medYd:med(fire.fwd), p10Yd:pct(fire.fwd, 0.1), p90Yd:pct(fire.fwd, 0.9), backPct:fire.fwd.length ? +(100*fire.fwd.filter(v => v < 0).length/fire.fwd.length).toFixed(1) : null, n3:fire.fwd3.length, med3Yd:med(fire.fwd3), back3Pct:fire.fwd3.length ? +(100*fire.fwd3.filter(v => v < 0).length/fire.fwd3.length).toFixed(1) : null}, jitter:Object.fromEntries(['D','O'].map(k => [k, {frames:jit[k].n, turnDegPerFrame:jit[k].n ? +deg(jit[k].turn/jit[k].n).toFixed(3) : null, reversalsPerS:jit[k].n ? +(jit[k].rev/(jit[k].n*SIM_DT)).toFixed(2) : null, posJitterYd:jit[k].n ? +(jit[k].pos/jit[k].n).toFixed(4) : null, leanStepDeg:jit[k].n ? +deg(jit[k].lean/jit[k].n).toFixed(3) : null, bearStepDeg:jit[k].n ? +deg(jit[k].bear/jit[k].n).toFixed(3) : null, leanFlipsPerS:jit[k].n ? +(jit[k].flips/(jit[k].n*SIM_DT)).toFixed(2) : null, byErr:{frameShare:jit[k].nb.map(v => +(v/(jit[k].n || 1)).toFixed(3)), turnShare:jit[k].b.map(v => +(v/(jit[k].turn || 1)).toFixed(3))}, ...(k === 'D' ? {bigTurnOnsets:{perS:jit.D.n ? +(jit.D.on/(jit.D.n*SIM_DT)).toFixed(2) : null, mode:jit.D.onMode, jump:jit.D.onJump, slow:jit.D.onSlow}, modeSwitchesPerS:jit.D.n ? +(jit.D.sw/(jit.D.n*SIM_DT)).toFixed(2) : null} : {})}])), facing:{frames:fc.frames, sqPct:fc.frames ? +(100*fc.square/fc.frames).toFixed(1) : null, errDeg:fc.frames ? +deg(fc.err/fc.frames).toFixed(1) : null, leanDeg:fc.frames ? +deg(fc.lean/fc.frames).toFixed(1) : null, maxLeanDeg:+deg(fc.maxLean).toFixed(1), maxOffDeg:+deg(fc.maxOff).toFixed(1), heldFrames:fc.hFrames, sqPctWithHeld:fc.frames + fc.hFrames ? +(100*(fc.square + fc.hSquare)/(fc.frames + fc.hFrames)).toFixed(1) : null, errDegWithHeld:fc.frames + fc.hFrames ? +deg((fc.err + fc.hErr)/(fc.frames + fc.hFrames)).toFixed(1) : null, turnBack:{n:turn.shed.length, medianS:med(turn.shed), p90S:pct(turn.shed, 0.9)}, holdTurnBack:{n:turn.hold.length, medianS:med(turn.hold), p90S:pct(turn.hold, 0.9)}}});
}
