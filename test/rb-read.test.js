import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { engagedOn, BODY_RADIUS } from '../src/dots/blocking.js';
import { hardCore, PACES } from '../src/dots/steering.js';
import {
  LANES, GAP_BACK, LANE_AHEAD, PRESSURE_DIST, CLEAR_HOLD, BEND_MAX, laneWindows,
} from '../src/dots/carrier.js';

const DT = 1 / 60;
const HOLD_TICKS = Math.ceil(CLEAR_HOLD / FIXED_DT) - 1;
const LOS = 25;
const CAP = 240; // 4 s
const H = hardCore(BODY_RADIUS);
const REPORT = process.env.RB_READ_REPORT === '1';

const defenders = (play) => play.players.filter((p) => p.team === 'defense');
const lineNo = (play, n) => play.players.find((p) => play.numbers[p.id] === n);

// Park every defender far from the play.
function park(play) {
  defenders(play).forEach((d, i) => { d.x = 15 + i; d.y = 45; });
}

test('F-35 #9: with the box empty he commits to the playside A gap between the tackles', () => {
  const play = createPlay(LOS, 'insideZone', { tackles: false });
  play.snap();
  const run = play.run;
  let handoff = null;
  let commit = null;
  for (let n = 1; n <= CAP && !run.locked && play.ball.phase !== 'dead'; n++) {
    park(play);
    play.step(DT);
    if (handoff === null && run.carried) handoff = n;
    if (commit === null && run.locked) commit = n;
  }
  assert.ok(run.locked, 'committed within 4 s');
  assert.ok(handoff !== null, 'handed off before the commit');
  assert.equal(run.commitBy, 'clear', `commitBy ${run.commitBy}`);
  assert.ok(commit - handoff >= HOLD_TICKS,
    `commit ${commit} only ${commit - handoff} ticks after handoff ${handoff}, need ${HOLD_TICKS}`);
  assert.ok(commit - handoff <= Math.ceil(run.patience / DT) + 1,
    `committed ${commit - handoff} ticks after the handoff`);
  assert.deepEqual({ ...run.lane }, { side: 'play', name: 'A' });
  const g1 = lineNo(play, 1);
  const gm1 = lineNo(play, -1);
  const lo = Math.min(g1.x, gm1.x);
  const hi = Math.max(g1.x, gm1.x);
  assert.ok(run.x > lo && run.x < hi, `run.x ${run.x} not between ${lo} and ${hi}`);
});

test('F-35 #9: with the playside A, B, C filled he cuts back to the backside', () => {
  const play = createPlay(LOS, 'insideZone', { tackles: false });
  play.snap();
  const run = play.run;
  for (let i = 0; i < CAP && !run.locked && play.ball.phase !== 'dead'; i++) {
    park(play);
    const wins = laneWindows(play.players, run.line, run.side).filter((w) => w.side === 'play').slice(0, 3);
    const ds = defenders(play);
    wins.forEach((w, k) => { ds[k].x = (w.lo + w.hi) / 2; ds[k].y = LOS + BODY_RADIUS; });
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
    assert.ok(o.commit - o.handoff >= HOLD_TICKS,
      `accel ${accel} committed ${o.commit - o.handoff} ticks after the handoff, need ${HOLD_TICKS}`);
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
    engagedBeforeDead: new Set(), bad: [], pressBad: [], commitState: null,
  };
  for (let n = 1; n <= CAP && play.ball.phase !== 'dead'; n++) {
    const engaged = new Set(defenders(play).filter((d) => engagedOn(play.players, d.id).length > 0).map((d) => d.id));
    const wasLocked = run.locked;
    play.step(DT);
    if (info.handoff === null && run.carried) info.handoff = n;
    if (run.carried && !run.locked) {
      const e = run.lanes.find((l) => l.side === run.lane.side && l.name === run.lane.name);
      if (e && e.open) {
        for (const p of play.players) {
          if (p.id === run.carrier) continue;
          const q = play.prev[p.id];
          if (q.y < LOS - GAP_BACK || q.y > LOS + LANE_AHEAD) continue;
          if (Math.abs(q.x - run.aim.x) < H - 1e-9) info.bad.push(`tick ${n} ${p.id} at ${q.x.toFixed(2)} aim ${run.aim.x.toFixed(2)}`);
        }
      }
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

test('F-35 #9: on every front and alignment he commits in time and never aims at a body in an open lane', () => {
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
        if (info.commitBy === 'clear') {
          assert.ok(info.commit - info.handoff >= HOLD_TICKS,
            `${label} cleared ${info.commit - info.handoff} ticks after handoff, need ${HOLD_TICKS}`);
        }
      }
      assert.ok(info.bends <= BEND_MAX, `${label} bends ${info.bends} > ${BEND_MAX}`);
      assert.deepEqual(info.bad, [], `${label} aimed at a body in an open lane`);
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
