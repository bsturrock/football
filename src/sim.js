// ---------- sim runner ----------
// ?sim=N&seed=S: plays N CPU run plays with no rendering and writes one JSON line into <pre id="simout">.
// Pile stats come from game state (tackle/ragdoll bodies near the holder, p.ph without .bubble), not from any pile code.
// physMs is null under --virtual-time-budget (performance.now does not advance during synchronous code); read it with a real clock
const SIM_DT = 1/60, PILE_R = 1.3, WINDOW_T = 0.4, PUSH_GAIN = 0.5, PLAY_MAX_S = 40, BOX_DY = 5, BOX_DX = 8, BOX_CX = 0;   // box: defenders within BOX_DY of the line and BOX_DX of the snap spot (field x BOX_CX; the center drifts by the handoff)

// mulberry32; replaces Math.random only when ?sim is on. It runs when this module loads, and main.js imports
// sim.js first with no static imports here, so player ratings and masses (rolled at load) are seeded too.
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

// g: the game objects, passed in by main.js so this file has no imports (it must load before any module that rolls random numbers)
export function runSim(n, step, g){
  const {physBall, physCount, physDown, perf, ALL, OFF, DEF, RB, PLAYS, DEF_CALLS, nextPlay, newGame, setupPlay, S, ball} = g;
  const ballY = h => h.ph ? 50 - physBall(h).z : h.y;
  if(!window.CANNON){ out({error:'physics failed to load'}); return; }
  // forced choices: names match case-insensitively and are stored canonical; form and side wait for B-007-3/4
  const byName = (list, v) => v == null ? null : list.find(x => x.name.toLowerCase() === v.trim().toLowerCase());
  const force = {play:null, form:Q.get('form'), front:null, side:null};
  for(const [key, list, label] of [['play', PLAYS.filter(p => p.run), 'play'], ['front', DEF_CALLS, 'front']]){
    if(!Q.has(key)) continue;
    const hit = byName(list, Q.get(key));
    if(!hit){ out({error:'unknown ' + label + ' ' + Q.get(key)}); return; }
    force[key] = hit.name;
  }
  if(Q.has('side')){
    const sd = Q.get('side').toUpperCase();
    if(sd !== 'L' && sd !== 'R'){ out({error:'unknown side ' + Q.get('side')}); return; }
    force.side = sd;
  }
  S.force = force;   // read by cpu.js (play), state.js (front) and later formations and flip
  if(force.front) setupPlay();   // the first play was set up before the force existed
  const yards = [], wins = [], physMs = [];
  const byPlay = {}, boxes = [], frees = [];
  let timeouts = 0, pushPlays = 0, bodiesMax = 0, win = null;
  const closeWin = () => {   // a window counts once it lasted WINDOW_T
    if(win && win.t >= WINDOW_T) wins.push({dur:win.t, gain:win.y1 - win.y0, off:win.off});
    win = null;
  };
  for(let i = 0; i < n; i++){
    let startY = null, endY = 0, t = 0, pushed = false, pname = null, measured = false;
    while(S.phase !== 'dead' && t < PLAY_MAX_S){
      step(SIM_DT); t += SIM_DT;
      const c = ball.state === 'held' ? ball.holder : null;
      if(S.phase === 'live' && c){
        const y = ballY(c); if(startY === null){ startY = S.los; pname = PLAYS[S.play].name; } endY = y;
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
    const timedOut = S.phase !== 'dead';   // hit PLAY_MAX_S: counted in timeouts, left out of yards
    if(timedOut) timeouts++;
    else if(startY !== null){
      yards.push(endY - startY);
      const b = byPlay[pname] || (byPlay[pname] = {ys:[], stuff:0}); b.ys.push(endY - startY); if(endY - startY <= 0) b.stuff++;
    }
    const played = wins.filter(w => w.play === undefined); played.forEach(w => { w.play = i; });
    if(played.some(w => w.off && w.gain >= PUSH_GAIN)) pushed = true;
    if(pushed) pushPlays++;
    nextPlay(); if(S.phase === 'over') newGame();   // a finished game starts the next one
  }
  const pushes = wins.filter(w => w.off && w.gain >= PUSH_GAIN);
  const byPlayOut = {}; for(const k of Object.keys(byPlay).sort()){ const b = byPlay[k]; byPlayOut[k] = {n:b.ys.length, ypc:mean(b.ys), stuffPct:+(100*b.stuff/b.ys.length).toFixed(1)}; }
  out({plays:n, timeouts, yards:{mean:mean(yards), median:med(yards)}, pileWindows:wins.length, pushPlays, pushPlayRate:+(pushPlays/n).toFixed(3),
    pushDurS:{median:med(pushes.map(w => w.dur)), p90:pct(pushes.map(w => w.dur), 0.9)},
    pushGainYd:{median:med(pushes.map(w => w.gain)), p90:pct(pushes.map(w => w.gain), 0.9)},
    bodiesMax, physMs:physMs.some(x => x > 0) ? {median:med(physMs), p95:pct(physMs, 0.95)} : {median:null, p95:null},
    force, byPlay:byPlayOut, boxMean:mean(boxes), freeBox:mean(frees)});
}
