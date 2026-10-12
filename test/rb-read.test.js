import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { engagedOn, BODY_RADIUS } from '../src/dots/blocking.js';
import { PACES } from '../src/dots/steering.js';
import {
  LANES, GAP_BACK, LANE_AHEAD, PRESSURE_DIST, BEND_MAX, laneWindows,
  scoreLanes, READS, CALL_LANES, CALL_FALLBACK, AIM_LEG, readCall, pickCrease,
} from '../src/dots/carrier.js';
import { hardCore } from '../src/dots/steering.js';
import { LINE_DEPTH, readFront } from '../src/dots/front.js';
import { SCRIPTS, WHO } from '../src/dots/defense.js';

const DT = 1 / 60;
const LOS = 25;
const CAP = 240; // 4 s
const REPORT = process.env.RB_READ_REPORT === '1';

const defenders = (play) => play.players.filter((p) => p.team === 'defense');
const lineNo = (play, n) => play.players.find((p) => play.numbers[p.id] === n);

// Park every defender far from the play.
function park(play) {
  defenders(play).forEach((d, i) => { d.x = 15 + i; d.y = 45; });
}

// F-54 #3: noTe, because base 'te' has only two free defenders once RT climbs to the MLB and the TE takes the SLB; this needs three.
test('F-35 #9: with the playside A, B, C filled he cuts back to the backside', () => {
  const play = createPlay(LOS, 'insideZone', { tackles: false, personnel: 'noTe' });
  play.snap();
  const run = play.run;
  const prevMid = [];
  for (let i = 0; i < CAP && !run.locked && play.ball.phase !== 'dead'; i++) {
    park(play);
    const wins = laneWindows(play.players, run.line, run.side).filter((w) => w.side === 'play').slice(0, 3);
    // Fillers come only from FREE defenders: none engaged and none targeted by any blocker. A defender a
    // blocker climbs to (a double team's watch linebacker) leaves the pool and another free one fills his window,
    // so the windows stay filled by unblocked threats however the blockers retarget.
    const isFree = (d) => engagedOn(play.players, d.id).length === 0
      && !play.players.some((o) => o.team === 'offense' && o.block?.target === d.id);
    const ds = defenders(play).filter(isFree);
    // The windows slide with the line during the step: aim each filler at where its window will be.
    wins.forEach((w, k) => {
      const mid = (w.lo + w.hi) / 2;
      ds[k].x = mid + (prevMid[k] === undefined ? 0 : mid - prevMid[k]);
      ds[k].y = LOS + BODY_RADIUS;
      prevMid[k] = mid;
    });
    // Guard against fixture drift: each playside window holds a free defender in the read band.
    const after = laneWindows(play.players, run.line, run.side).filter((w) => w.side === 'play').slice(0, 3);
    after.forEach((w, k) => {
      assert.ok(defenders(play).some((d) => isFree(d) && d.x >= w.lo && d.x <= w.hi
        && d.y >= LOS - GAP_BACK && d.y <= LOS + LANE_AHEAD), `tick ${i}: window ${k} has no free defender`);
    });
    play.step(DT);
  }
  assert.ok(run.locked, 'committed within 4 s');
  assert.equal(run.lane.side, 'back', `lane ${JSON.stringify(run.lane)} x ${run.x}`);
  const center = lineNo(play, 0);
  assert.ok((run.x - center.x) * run.side < 0, `run.x ${run.x} center ${center.x}`);
});

// Steps a play, returns {handoff, commit, steps, moves[]} with per-tick RB steps.
function timed(opts) {
  const play = createPlay(LOS, 'insideZone', opts);
  play.snap();
  const run = play.run;
  const rb = play.player('RB');
  const out = { play, handoff: null, commit: null, moves: [], laneOk: true, pressing: [] };
  for (let n = 1; n <= CAP && play.ball.phase !== 'dead'; n++) {
    const before = { x: rb.x, y: rb.y };
    const wasCarried = run.carried;
    const wasLocked = run.locked;
    play.step(DT);
    out.moves.push({ n, d: Math.hypot(rb.x - before.x, rb.y - before.y), pressing: run.carried && !run.locked && wasCarried });
    if (out.handoff === null && run.carried) out.handoff = n;
    if (run.carried && !run.locked && !LANES.some((l) => l.side === run.lane.side && l.name === run.lane.name)) out.laneOk = false;
    if (out.commit === null && run.locked && !wasLocked) { out.commit = n; }
    if (out.commit !== null && n > out.commit + 60) break;
    if (out.commit !== null && run.locked) { /* keep going to measure the burst */ }
  }
  return out;
}

test('F-35 #9: patience press then burst (accel off and on)', () => {
  for (const accel of [false, true]) {
    const o = timed({ accel, tackles: false });
    const { play } = o;
    const rb = play.player('RB');
    assert.ok(o.handoff !== null && o.commit !== null, `accel ${accel} handoff ${o.handoff} commit ${o.commit}`);
    assert.ok(o.commit - o.handoff <= Math.ceil(play.run.patience / DT) + 1,
      `accel ${accel} committed ${o.commit - o.handoff} ticks after the handoff`);
    assert.ok(o.laneOk, 'lane is a LANES entry while pressing');
    const pressCap = PACES.press.frac * rb.speed * DT;
    const pressMoves = o.moves.filter((m) => m.n > o.handoff && m.n < o.commit);
    const burst = o.moves.filter((m) => m.n > o.commit && m.n <= o.commit + Math.round(0.5 / DT));
    if (!accel) {
      for (const m of pressMoves) assert.ok(m.d <= pressCap + 1e-9, `accel off tick ${m.n} step ${m.d} > ${pressCap}`);
      const quick = o.moves.filter((m) => m.n > o.commit && m.n <= o.commit + Math.round(0.3 / DT));
      assert.ok(quick.some((m) => m.d > pressCap), 'bursts within 0.3 s of the commit');
    } else {
      const peakPress = Math.max(0, ...pressMoves.map((m) => m.d));
      const peakBurst = Math.max(...burst.map((m) => m.d));
      assert.ok(peakBurst > peakPress, `peak burst ${peakBurst} > peak press ${peakPress}`);
    }
  }
});

const alignments = [
  [],
  Array(6).fill(['LB', -1]),
  Array(6).fill(['LB', 1]),
  Array(2).fill(['DL', 1]),
  Array(2).fill(['DL', -1]),
  Array(4).fill(['DL', 1]),
  Array(4).fill(['DL', -1]),
];
const alLabel = (al) => (al.length ? `${al[0][0]}${al[0][1] > 0 ? '+' : '-'}${al.length}` : 'none');

// Tackles-on run with per-tick records. Returns a summary used by tests and the report.
function fullPlay(front, al = []) {
  const play = createPlay(LOS, 'insideZone', { front });
  for (const [k, d] of al) (k === 'LB' ? play.shiftLB(d) : play.shiftDL(d));
  play.snap();
  const run = play.run;
  const rb = play.player('RB');
  const info = {
    play, handoff: null, commit: null, lane: null, commitBy: null, laneOpenAtCommit: null,
    engagedBeforeDead: new Set(), pressBad: [], commitState: null,
  };
  for (let n = 1; n <= CAP && play.ball.phase !== 'dead'; n++) {
    const engaged = new Set(defenders(play).filter((d) => engagedOn(play.players, d.id).length > 0).map((d) => d.id));
    const wasLocked = run.locked;
    play.step(DT);
    if (info.handoff === null && run.carried) info.handoff = n;
    if (run.carried && !run.locked) {
      const r0 = play.prev[run.carrier];
      for (const d of defenders(play)) {
        if (engaged.has(d.id)) continue;
        const q = play.prev[d.id];
        if (Math.hypot(q.x - r0.x, q.y - r0.y) <= PRESSURE_DIST) info.pressBad.push(`tick ${n} ${d.id} dist ${Math.hypot(q.x - r0.x, q.y - r0.y).toFixed(2)}`);
      }
    }
    if (run.locked && !wasLocked) {
      info.commit = n;
      info.lane = { ...run.lane };
      info.commitBy = run.commitBy;
      info.commitState = { x: run.x, rb: { x: rb.x, y: rb.y } };
    }
    info.engaged = engaged;
  }
  info.bends = run.bends;
  return info;
}

function nearest(play, id) {
  const p = play.player(id);
  let best = null;
  for (const d of defenders(play)) {
    const dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (!best || dist < best.dist) best = { id: d.id, dist };
  }
  return best;
}

test('F-35 #9: on every front and alignment he commits in time', () => {
  const rows = [];
  const exceptions = [];
  for (const front of Object.keys(FRONTS)) {
    for (const al of alignments) {
      const label = `${front}/${alLabel(al)}`;
      const info = fullPlay(front, al);
      const { play } = info;
      const dead = play.ball.phase === 'dead';
      if (info.commit === null) {
        assert.ok(dead, `${label} neither committed nor ended`);
        const by = play.result.by;
        assert.ok(info.engaged.has(by), `${label} died still waiting, tackler ${by} had no blocker engaged`);
        exceptions.push(`${label} tackler ${by}`);
      } else {
        assert.ok(info.commit - info.handoff <= Math.ceil(play.run.patience / DT) + 1,
          `${label} committed ${info.commit - info.handoff} ticks after handoff`);
      }
      assert.ok(info.bends <= BEND_MAX, `${label} bends ${info.bends} > ${BEND_MAX}`);
      const rb = play.player('RB');
      rows.push({
        label,
        lane: info.lane ? `${info.lane.side}-${info.lane.name}` : '-',
        t: info.commit === null ? '-' : ((info.commit - info.handoff) * DT).toFixed(2),
        by: info.commitBy ?? '-',
        bends: info.bends,
        yards: (rb.y - LOS).toFixed(2),
        reason: play.result ? play.result.reason : 'cap',
        who: play.result ? play.result.by : nearest(play, 'RB').id,
      });
    }
  }
  if (REPORT) {
    console.log('REPORT front/alignment | lane | commit s | by | bends | yards | reason | tackler');
    for (const r of rows) console.log(`REPORT ${r.label} | ${r.lane} | ${r.t} | ${r.by} | ${r.bends} | ${r.yards} | ${r.reason} | ${r.who}`);
    console.log(`REPORT shed-and-tackled exceptions: ${exceptions.join('; ') || 'none'}`);
  }
});

// A breakaway: the carrier is past the second level and past every defender.
const brokeAway = (play, los) => {
  const c = play.player(play.ball.holder ?? play.run.carrier);
  return c.y >= los + LANE_AHEAD && play.players.every((d) => d.team !== 'defense' || d.y < c.y);
};

test('F-35 #13: base front backside edge never keeps him pressing under pressure', () => {
  const info = fullPlay('base');
  const { play } = info;
  assert.ok(play.ball.phase === 'dead' || brokeAway(play, LOS), 'play ended within 4 s or broke away');
  assert.ok(info.commit !== null, `committed before the ball went dead (result ${JSON.stringify(play.result)})`);
  assert.deepEqual(info.pressBad, [], 'unblocked defender within PRESSURE_DIST while still pressing');
  if (REPORT) {
    const rb = play.player('RB');
    const by = play.result?.by;
    const cs = info.commitState;
    if (by) {
      const d = play.player(by);
      console.log(`REPORT backside: tackler ${by}, yards ${(rb.y - LOS).toFixed(2)}, commitBy ${info.commitBy}, commit rb (${cs.rb.x.toFixed(2)}, ${cs.rb.y.toFixed(2)}), final tackler dist ${Math.hypot(d.x - rb.x, d.y - rb.y).toFixed(2)}`);
    } else {
      console.log(`REPORT backside: breakaway, yards ${(rb.y - LOS).toFixed(2)}, commitBy ${info.commitBy}, commit rb (${cs.rb.x.toFixed(2)}, ${cs.rb.y.toFixed(2)})`);
    }
  }
});

// F-46: the RB's patience is a shuffle around his track point with some forward creep.
function pressRun(front, accel = true) {
  const play = createPlay(LOS, 'insideZone', { accel, tackles: false, front });
  play.snap();
  const run = play.run;
  const rb = play.player('RB');
  const ticks = [];
  let start = null;
  let end = null;
  for (let n = 0; n < 2 * 60 && play.ball.phase !== 'dead'; n++) {
    const px = rb.x;
    const py = rb.y;
    play.step(DT);
    if (run.carried && start === null) start = { x: px, y: py };
    if (start && !run.locked) ticks.push({ dx: rb.x - px, dy: rb.y - py, x: rb.x, y: rb.y, px: run.press.x });
    if (run.locked) { end = { x: rb.x, y: rb.y }; break; }
  }
  return { play, ticks, start, end };
}

test('F-46 #4: with accel off every press step stays within the press cap', () => {
  const { play, ticks } = pressRun('base', false);
  const cap = PACES.press.frac * play.player('RB').speed * DT + 1e-9;
  for (const k of ticks) assert.ok(Math.hypot(k.dx, k.dy) <= cap, `step ${Math.hypot(k.dx, k.dy)} > ${cap}`);
});

// ---- F-57: the RB's read, steady press, crease and one cut ----
const FRONT_KEYS = Object.keys(FRONTS);
const SIDES = ['left', 'right'];
const PERSONNEL = ['noTe', 'te'];

// Hand-built run cues.
const dlc = (move, felt = 'none', side = 'play') => ({ side, move, felt });
const lbc = (state, side = 'play', dir = 0) => ({ side, state, dir });
const cue = ({ key = 'K', end = 'E', dl = {}, lbs = {} } = {}) => ({ key, end, dl, lbs });

test('F-57 #3: readCall rows', () => {
  assert.ok(Object.isFrozen(READS) && READS.every((r) => Object.isFrozen(r)));
  const who = (c) => readCall(c) && `${readCall(c).call}:${readCall(c).why}`;
  assert.equal(who(cue({ dl: { K: dlc('driven') } })), 'bang:key driven');
  assert.equal(who(cue({ dl: { K: dlc('widen') } })), 'bang:key widen');
  assert.equal(who(cue({ dl: { K: dlc('squeeze') } })), 'bend:key squeeze');
  assert.equal(who(cue({ dl: { K: dlc('upfield') } })), 'bend:key upfield');
  assert.equal(who(cue({ dl: { K: dlc('held') }, lbs: { M: lbc('filling') } })), 'bend:playside LB fills');
  assert.equal(who(cue({ dl: { K: dlc('held') }, lbs: { M: lbc('filling', 'head') } })), 'bend:playside LB fills');
  assert.equal(who(cue({ dl: { K: dlc('held') }, lbs: { M: lbc('filling', 'back') } })), null);
  // first match wins
  assert.equal(who(cue({ dl: { K: dlc('widen') }, lbs: { M: lbc('filling') } })), 'bang:key widen');
  assert.equal(who(cue({ dl: { K: dlc('driven') }, lbs: { M: lbc('filling') } })), 'bang:key driven');
  // bounce: the end reached, no playside flow
  const edge = (move, endFelt, lbs = {}) => cue({ dl: { K: dlc(move), E: dlc('held', endFelt) }, lbs });
  assert.equal(who(edge('squeeze', 'reach')), 'bounce:edge reached');
  assert.equal(who(edge('upfield', 'reach')), 'bounce:edge reached');
  assert.equal(who(edge('squeeze', 'base')), 'bend:key squeeze');
  assert.equal(who(edge('squeeze', 'reach', { M: lbc('flowing', 'play', 1) })), 'bend:key squeeze');
  assert.equal(who(edge('squeeze', 'reach', { M: lbc('flowing', 'head', 1) })), 'bend:key squeeze');
  assert.equal(who(edge('squeeze', 'reach', { M: lbc('flowing', 'play', -1) })), 'bounce:edge reached');
  assert.equal(who(edge('squeeze', 'reach', { M: lbc('flowing', 'back', 1) })), 'bounce:edge reached');
  assert.equal(who(edge('widen', 'reach')), 'bang:key widen');
  // the end must be a different defender from the key
  assert.equal(who(cue({ key: 'K', end: 'K', dl: { K: dlc('squeeze', 'reach') } })), 'bend:key squeeze');
  // a null key fails every key row
  assert.equal(who(cue({ key: null, end: null, dl: {} })), null);
  assert.equal(who(cue({ key: null, end: null, dl: {}, lbs: { M: lbc('filling') } })), 'bend:playside LB fills');
  assert.equal(readCall(null), null);
  assert.equal(readCall(undefined), null);
  assert.equal(who(cue({ dl: { K: dlc('held'), E: dlc('held') }, lbs: { M: lbc('sitting'), N: lbc('covering') } })), null);
});

test('F-57 #5: pickCrease', () => {
  const L = (side, name, open, score, width = open ? 1 : 0, extra = {}) => ({ side, name, open, score, width, x: 0, seg: 0, ...extra });
  const all = (o = {}) => [
    L('play', 'A', o.pA ?? true, o.sA ?? 0), L('play', 'B', o.pB ?? true, o.sB ?? 0), L('play', 'C', o.pC ?? true, o.sC ?? 0),
    L('back', 'A', o.bA ?? true, o.tA ?? 0), L('back', 'B', o.bB ?? true, o.tB ?? 0),
  ];
  const id = (l) => `${l.side}-${l.name}`;
  assert.deepEqual(Object.keys(CALL_LANES), ['bang', 'bend', 'bounce']);
  assert.deepEqual(CALL_FALLBACK, { bang: 'bend', bend: 'bang', bounce: 'bang' });
  // call lanes first, best score
  assert.equal(id(pickCrease(all({ sA: 1, sB: 2, tA: 9 }), 'bang')), 'play-B');
  assert.equal(id(pickCrease(all({ sA: 3, sB: 2, sC: 9 }), 'bang')), 'play-A');
  assert.equal(id(pickCrease(all({ tA: 1, tB: 2, sA: 9 }), 'bend')), 'back-B');
  assert.equal(id(pickCrease(all({ sC: 0, sA: 9 }), 'bounce')), 'play-C');
  // closed call lanes are skipped
  assert.equal(id(pickCrease(all({ pA: false, sA: 9, sB: 1 }), 'bang')), 'play-B');
  // fallback when none of the call's lanes is open
  assert.equal(id(pickCrease(all({ pA: false, pB: false, tA: 1, tB: 2 }), 'bang')), 'back-B');
  assert.equal(id(pickCrease(all({ bA: false, bB: false, sA: 2, sB: 1 }), 'bend')), 'play-A');
  assert.equal(id(pickCrease(all({ pC: false, sA: 1, sB: 2 }), 'bounce')), 'play-B');
  // nothing open: the call's widest lane, first in CALL_LANES order on a tie
  const closed = (wA, wB) => [
    L('play', 'A', false, 0, wA), L('play', 'B', false, 0, wB), L('play', 'C', false, 0, 0),
    L('back', 'A', false, 0, 0), L('back', 'B', false, 0, 0),
  ];
  assert.equal(id(pickCrease(closed(0.05, 0.1), 'bang')), 'play-B');
  assert.equal(id(pickCrease(closed(0.1, 0.05), 'bang')), 'play-A');
  assert.equal(id(pickCrease(closed(0.1, 0.1), 'bang')), 'play-A');
  assert.equal(id(pickCrease(closed(0, 0), 'bang')), 'play-A');
  assert.equal(id(pickCrease(closed(0.3, 0.3), 'bounce')), 'play-C');
  assert.equal(pickCrease([], 'bang'), null);
  // the aim of a closed lane is its seg, never the window middle
  const play = createPlay(LOS, 'insideZone', { tackles: false });
  play.snap();
  const run = play.run;
  const rb = play.player('RB');
  park(play);
  const w = laneWindows(play.players, run.line, run.side).find((e) => e.side === 'play' && e.name === 'A');
  const d = defenders(play)[0];
  d.x = (w.lo + w.hi) / 2; d.y = LOS + 0.3;
  const lane = scoreLanes(play.players, run, rb, LOS).find((l) => l.side === 'play' && l.name === 'A');
  assert.equal(lane.open, false);
  assert.ok(Number.isFinite(lane.seg));
  assert.ok(Math.abs(lane.seg - d.x) > 1e-6, `seg ${lane.seg} sits on the body at ${d.x}`);
});

test('F-57 #2: steady press', () => {
  for (const front of FRONT_KEYS) for (const playside of SIDES) for (const personnel of PERSONNEL) {
    const tag = `${front} ${playside} ${personnel}`;
    const play = createPlay(LOS, 'insideZone', { front, playside, personnel });
    play.snap();
    const run = play.run;
    const rb = play.player('RB');
    const guard = lineNo(play, run.track);
    const lane0 = { ...run.lane };
    let prevDx = 0;
    let flips = 0;
    let pressTicks = 0;
    for (let n = 1; n <= CAP && play.ball.phase !== 'dead' && !run.locked; n++) {
      const gx = guard.x;
      const rx = rb.x;
      const was = run.carried;
      play.step(DT);
      if (!was || run.locked) continue;
      pressTicks++;
      assert.ok(Math.abs(run.press.x - (gx + run.side * AIM_LEG)) < 1e-9, `${tag} tick ${n} press.x ${run.press.x} guard ${gx}`);
      assert.deepEqual(run.lane, lane0, `${tag} tick ${n} lane changed while pressing`);
      const dx = rb.x - rx;
      if (Math.abs(dx) < 1e-3) continue;
      if (prevDx !== 0 && Math.sign(dx) !== Math.sign(prevDx)) flips++;
      prevDx = dx;
    }
    assert.ok(flips <= 1, `${tag} lateral step changed sign ${flips} times in ${pressTicks} press ticks`);
  }
});

test('F-57 #3/#4: commit on the read', (t) => {
  const tally = {};
  for (const front of FRONT_KEYS) for (const playside of SIDES) for (const personnel of PERSONNEL) {
    const tag = `${front} ${playside} ${personnel}`;
    const play = createPlay(LOS, 'insideZone', { front, playside, personnel });
    play.snap();
    const run = play.run;
    for (let n = 1; n <= CAP && play.ball.phase !== 'dead' && !run.locked; n++) play.step(DT);
    if (!run.locked) continue;
    assert.ok(['read', 'window', 'line', 'pressure'].includes(run.commitBy), `${tag} commitBy ${run.commitBy}`);
    if (run.commitBy === 'read') {
      assert.ok(Object.hasOwn(CALL_LANES, run.call), `${tag} call ${run.call}`);
      const ok = [...CALL_LANES[run.call], ...CALL_LANES[CALL_FALLBACK[run.call]]].some((l) => l.side === run.lane.side && l.name === run.lane.name);
      assert.ok(ok, `${tag} call ${run.call} lane ${JSON.stringify(run.lane)}`);
    }
    const k = `${front}: ${run.commitBy}/${run.call}/${run.why}`;
    tally[k] = (tally[k] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(tally)) t.diagnostic(`call ${k} x${v}`);
});

test('F-57 #3/#4: commit on the read, scripted key', (t) => {
  for (const [script, want] of [['dtSlantBack', 'bend'], ['dtSlant', 'bang']]) {
    let judged = 0;
    for (const front of FRONT_KEYS) for (const playside of SIDES) {
      const tag = `${script} ${front} ${playside}`;
      const play = createPlay(LOS, 'insideZone', { front, playside, script });
      play.snap();
      const fr = readFront(play.players, play.numbers, LOS);
      const dtId = fr.defenders.find((f) => WHO.playDT(play.player(f.id), f, fr, play.players))?.id;
      const run = play.run;
      const rb = play.player('RB');
      let key = null;
      for (let n = 1; n <= CAP && play.ball.phase !== 'dead' && !run.locked; n++) {
        play.step(DT);
        if (run.locked) key = play.cuesOf('RB')?.run?.key ?? null;
      }
      if (!run.locked || run.commitBy !== 'read' || key !== dtId) {
        t.diagnostic(`${tag}: skipped (key ${key}, DT ${dtId}, commitBy ${run.commitBy}, call ${run.call})`);
        continue;
      }
      if (run.call === 'bounce') { t.diagnostic(`${tag}: skipped (the end also reached, the table calls bounce first)`); continue; }
      judged++;
      assert.equal(run.call, want, `${tag} call ${run.call} (${run.why})`);
    }
    assert.ok(judged >= 1, `${script}: no combo judged`);
    t.diagnostic(`${script}: judged ${judged}`);
  }
});

// Decision moments: the commit tick and every lane change.
test('F-57 #5 (R-15): the aim never sits on a DL at a decision', (t) => {
  const hc = hardCore(BODY_RADIUS);
  let r15 = false;
  let noSeg = 0;
  const combos = [['base', 'right', 'te']];
  for (const front of FRONT_KEYS) for (const playside of SIDES) for (const personnel of PERSONNEL) combos.push([front, playside, personnel]);
  for (const [front, playside, personnel] of combos) {
    const tag = `${front} ${playside} ${personnel}`;
    const play = createPlay(25, 'insideZone', { front, personnel, playside });
    play.snap();
    const run = play.run;
    const rb = play.player('RB');
    const snapY = Object.fromEntries(defenders(play).map((d) => [d.id, d.y]));
    let lane = run.lane;
    let x = run.x;
    let committed = false;
    for (let n = 1; n <= CAP && play.ball.phase !== 'dead'; n++) {
      const pre = defenders(play).map((d) => ({ id: d.id, x: d.x, y: d.y }));
      play.step(DT);
      if (!run.locked) continue;
      const decided = !committed || run.lane.side !== lane.side || run.lane.name !== lane.name || run.x !== x;
      committed = true;
      lane = { ...run.lane };
      x = run.x;
      if (!decided) continue;
      const entry = run.lanes.find((l) => l.side === run.lane.side && l.name === run.lane.name);
      if (entry && entry.width === 0) { noSeg++; t.diagnostic(`${tag} tick ${n}: lane ${run.lane.side}-${run.lane.name} has no free segment`); continue; }
      for (const d of pre) {
        if (snapY[d.id] - LOS > LINE_DEPTH || d.y < LOS - GAP_BACK || d.y > LOS + LANE_AHEAD) continue;
        assert.ok(Math.abs(d.x - run.x) >= hc - 1e-9, `${tag} tick ${n}: aim x ${run.x.toFixed(3)} on ${d.id} at ${d.x.toFixed(3)}`);
      }
      if (front === 'base' && playside === 'right' && personnel === 'te') r15 = true;
    }
    if (!committed) t.diagnostic(`${tag}: no commit`);
  }
  assert.ok(r15, 'the base/te/right combo was judged');
  t.diagnostic(`decisions with no free segment: ${noSeg}`);
});

test('F-57 #6 (R-16): one cut, no back-out', () => {
  for (const front of FRONT_KEYS) for (const playside of SIDES) for (const personnel of PERSONNEL) {
    const tag = `${front} ${playside} ${personnel}`;
    const play = createPlay(LOS, 'insideZone', { front, playside, personnel });
    play.snap();
    const run = play.run;
    const rb = play.player('RB');
    let lane = null;
    let x = null;
    let fixed = false;
    for (let n = 1; n <= CAP && play.ball.phase !== 'dead'; n++) {
      const y0 = rb.y;
      play.step(DT);
      if (!run.locked) continue;
      assert.ok(run.bends <= 1, `${tag} tick ${n} bends ${run.bends}`);
      if (lane && (run.lane.side !== lane.side || run.lane.name !== lane.name || run.x !== x)) {
        assert.ok(!fixed, `${tag} tick ${n}: lane changed after he was at los - GAP_BACK`);
        assert.ok(y0 < LOS - GAP_BACK, `${tag} tick ${n}: lane changed at y ${y0}`);
      }
      lane = { ...run.lane };
      x = run.x;
      if (rb.y >= LOS - GAP_BACK) fixed = true;
    }
  }
});
