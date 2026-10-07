import { KEYS } from './ratings.js';   // ratings.js, roster.js, formations.js (pure) and util.js roll nothing at load, so importing them before seedRandom runs is safe
import { formByName } from './formations.js';
import { ROSTER, fieldCounts, persName, rateRosters } from './roster.js';

// ---------- sim runner ----------
// ?sim=N&seed=S: plays N CPU run plays with no rendering and writes one JSON line into <pre id="simout">.
// Pile stats come from game state (tackle/ragdoll bodies near the holder, p.ph without .bubble), not from any pile code.
// physMs is null under --virtual-time-budget (performance.now does not advance during synchronous code); read it with a real clock
const SIM_DT = 1/60, PILE_R = 1.3, WINDOW_T = 0.4, PUSH_GAIN = 0.5, PLAY_MAX_S = 40, BOX_DY = 5, BOX_DX = 8, BOX_CX = 0, SIM_TEAM_EVERY = 20, BIG_YD = 10, STUFF_YD = 0;   // box: defenders within BOX_DY of the line and BOX_DX of the snap spot (field x BOX_CX; the center drifts by the handoff)

// mulberry32; replaces Math.random only when ?sim is on. It runs when this module loads, and main.js imports
// sim.js first and its only import is ratings.js (and via it util.js), neither of which rolls at load, so player ratings and masses (rolled at load) are seeded too.
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
  const {physBall, physCount, physDown, perf, ALL, OFF, DEF, RB, PLAYS, DEF_CALLS, nextPlay, newGame, setupPlay, S, ball} = g;
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
  let timeouts = 0, pushPlays = 0, bodiesMax = 0, win = null;
  const closeWin = () => {   // a window counts once it lasted WINDOW_T
    if(win && win.t >= WINDOW_T) wins.push({dur:win.t, gain:win.y1 - win.y0, off:win.off});
    win = null;
  };
  const teamAvg = side => { const ps = ALL.filter(p => p.team === side), o = {}; KEYS.forEach(k => { o[k] = mean(ps.map(p => p.rt[k])); }); return o; };
  const olRecog = Q.has('olrecog') ? Number(Q.get('olrecog')) : null, blkEv = {stuntPlays:0, passed:0, missed:0, wrong:0};   // B-007-9: force OL+TE awareness; count the re-read events
  const setRecog = () => { if(olRecog === null) return; [...ROSTER.O.filter(r => r.pos === 'OL' || r.pos === 'TE'), ...OFF.filter(o => o.pos === 'OL' || o.pos === 'TE')].forEach(r => { r.rt.recog = olRecog; }); };
  setRecog();
  let regens = 0, fieldO = null, fieldD = null; const reads = [];   // S.read per play (B-006-3): {key, choice, wrong}, null when the play had no zone read
  for(let i = 0; i < n; i++){
    let startY = null, endY = 0, t = 0, pushed = false, pname = null, measured = false; const drive0 = S.drive;
    while(S.phase !== 'dead' && t < PLAY_MAX_S){
      step(SIM_DT); t += SIM_DT;
      const c = ball.state === 'held' ? ball.holder : null;
      if(S.phase === 'live' && c){
        const y = ballY(c); if(startY === null){ startY = S.los; pname = PLAYS[S.play].name; tally(calls, pname); tally(byFront[S.front] || (byFront[S.front] = {}), pname); tally(byCall[S.defCall.name] || (byCall[S.defCall.name] = {}), pname); }   // B-007-13: call shares overall, per front, per defensive call
        endY = y;
        if(c === RB && !measured){   // the back gets the ball: count the box, and who is free in it
          measured = true;
          const inBox = DEF.filter(d => Math.abs(d.y - S.los) <= BOX_DY && Math.abs(d.x - BOX_CX) <= BOX_DX);
          boxes.push(inBox.length);
          frees.push(inBox.filter(d => d.stun <= 0 && !(d.eng > 0) && !d.bt && !OFF.some(o => o.blk === d)).length);
        }
        const cnt = physCount(); bodiesMax = Math.max(bodiesMax, cnt.players);
        if(cnt.players) physMs.push(perf.phys);
        const near = ALL.filter(p => p !== c && p.ph && !p.ph.bubble && Math.hypot(p.x - c.x, p.y - c.y) < PILE_R);
        if(!(c.ph && physDown(c)) && near.length >= 2){
          if(!win) win = {t:0, y0:y, y1:y, off:false};
          win.t += SIM_DT; win.y1 = y; if(near.some(p => OFF.includes(p))) win.off = true;
        } else closeWin();
      }
    }
    closeWin();
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
  out({plays:n, timeouts, ypc:mean(yards), stuffPct:yards.length ? +(100*yards.filter(y => y <= STUFF_YD).length/yards.length).toFixed(1) : null, bigPct:yards.length ? +(100*yards.filter(y => y >= BIG_YD).length/yards.length).toFixed(1) : null,
    spotYards:{mean:mean(spotYards), median:med(spotYards)}, yards:{mean:mean(yards), median:med(yards), p10:pct(yards, 0.1), p90:pct(yards, 0.9), max:yards.length ? +Math.max(...yards).toFixed(3) : null}, pileWindows:wins.length, pile:{whistles:S.pile.whistles, frames:S.pile.frames, pushPlays:S.pile.pushes.length, pushGainYd:{median:med(S.pile.pushes.map(x => x.gain)), p90:pct(S.pile.pushes.map(x => x.gain), 0.9)}, pushDurS:{median:med(S.pile.pushes.map(x => x.dur)), p90:pct(S.pile.pushes.map(x => x.dur), 0.9)}}, pushPlays, pushPlayRate:+(pushPlays/n).toFixed(3),
    pushDurS:{median:med(pushes.map(w => w.dur)), p90:pct(pushes.map(w => w.dur), 0.9)},
    pushGainYd:{median:med(pushes.map(w => w.gain)), p90:pct(pushes.map(w => w.gain), 0.9)},
    bodiesMax, physMs:physMs.some(x => x > 0) ? {median:med(physMs), p95:pct(physMs, 0.95)} : {median:null, p95:null},
    read:{n:reads.filter(r => r.choice).length, noDecision:reads.filter(r => !r.choice).length, wrongPct:reads.some(r => r.choice) ? +(100*reads.filter(r => r.wrong).length/reads.filter(r => r.choice).length).toFixed(1) : null, choices:reads.filter(r => r.choice).reduce((o, r) => { const c = o[r.choice] || (o[r.choice] = {n:0, ypc:0}); c.ypc = +((c.ypc*c.n + r.y)/++c.n).toFixed(2); return o; }, {}), wrongYpc:mean(reads.filter(r => r.choice && r.wrong).map(r => r.y)), rightYpc:mean(reads.filter(r => r.choice && !r.wrong).map(r => r.y))},
    force, field:{off:fieldO, def:fieldD}, roster:{O:ROSTER.O.length, D:ROSTER.D.length, ids:new Set([...ROSTER.O, ...ROSTER.D].map(r => r.id)).size, on:ALL.map(p => p.id).join(' ')}, teams:{regens, every:SIM_TEAM_EVERY, O:teamAvg('O'), D:teamAvg('D')}, byPlay:byPlayOut, calls, byFront, slant:{'Slant Left':byCall['Slant Left'] || {}, 'Slant Right':byCall['Slant Right'] || {}}, boxMean:mean(boxes), freeBox:mean(frees), blkEv});
}
