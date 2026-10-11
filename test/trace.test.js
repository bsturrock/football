import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { FRONTS, FORMATIONS } from '../src/dots/roster.js';
import { cuesFor } from '../src/dots/perceive.js';
import { TRACE_MAX_TICKS, createTrace, recordTick, entriesOf } from '../src/dots/trace.js';

const make = (opts = {}) => {
  const play = createPlay(25, 'insideZone', opts);
  play.snap();
  return play;
};
const isBlocker = (p) => p.team === 'offense' && ['OL', 'TE'].includes(p.role);

test('identity: tracing changes no position on any tick', () => {
  const cases = [
    ...Object.keys(FRONTS).map((front) => ({ front })),
    ...Object.keys(FORMATIONS).map((formation) => ({ formation })),
    { front: 'base', script: 'lbBlitz' },
  ];
  for (const opts of cases) {
    const a = make({ ...opts, trace: true });
    const b = make(opts);
    for (let k = 0; k < 240; k++) {
      a.step(FIXED_DT);
      b.step(FIXED_DT);
      a.players.forEach((p, i) => {
        assert.equal(p.x, b.players[i].x, `${JSON.stringify(opts)} ${p.id} x tick ${k}`);
        assert.equal(p.y, b.players[i].y, `${JSON.stringify(opts)} ${p.id} y tick ${k}`);
      });
    }
    assert.deepEqual(a.result, b.result);
  }
});

test('coverage: one record per live tick, none once dead', () => {
  const play = make({ trace: true });
  for (let k = 1; k <= 30; k++) {
    play.step(FIXED_DT);
    assert.equal(play.trace.ticks.length, k);
    const tick = play.trace.ticks[k - 1];
    assert.equal(tick.t, k * FIXED_DT);
    for (const p of play.players) assert.ok(tick.players[p.id], p.id);
  }
  for (let k = 0; k < 1200 && play.ball.phase !== 'dead'; k++) play.step(FIXED_DT);
  assert.equal(play.ball.phase, 'dead');
  const n = play.trace.ticks.length;
  assert.equal(n, play.ticks);
  for (let k = 0; k < 10; k++) play.step(FIXED_DT);
  assert.equal(play.trace.ticks.length, n);
});

test('trace is bounded', () => {
  const trace = createTrace();
  const play = make({ trace: true });
  for (let i = 0; i < TRACE_MAX_TICKS + 5; i++) recordTick(trace, play.perception, play.players, { t: i, defense: play.defense, run: play.run });
  assert.equal(trace.ticks.length, TRACE_MAX_TICKS);
  assert.equal(trace.ticks[0].t, 5);
  assert.equal(entriesOf(trace, 'RB').length, TRACE_MAX_TICKS);
});

test('reads match perception cues', () => {
  const play = make({ trace: true });
  for (let k = 0; k < 40; k++) play.step(FIXED_DT);
  const last = play.trace.ticks[play.trace.ticks.length - 1];
  for (const p of play.players) assert.deepEqual(last.players[p.id].read, cuesFor(play.perception, p.id));
});

test('decisions mirror sim state', () => {
  const play = make({ trace: true });
  for (let k = 0; k < 40; k++) play.step(FIXED_DT);
  const last = play.trace.ticks[play.trace.ticks.length - 1].players;
  for (const p of play.players) {
    if (p.block) assert.equal(last[p.id].decision.target, p.block.target);
    if (isBlocker(p)) assert.equal(last[p.id].decision.kind, 'block');
    const agent = play.defense.agents[p.id];
    if (agent) assert.equal(last[p.id].decision.state, agent.state);
  }
  assert.equal(last.RB.decision.kind, 'carry');
  const f = make({ trace: true, formation: '11' });
  for (let k = 0; k < 10; k++) f.step(FIXED_DT);
  const fl = f.trace.ticks[f.trace.ticks.length - 1].players;
  for (const id of ['X', 'H', 'Z']) assert.equal(fl[id].decision.kind, 'none');
});

test('reasons: script trigger and combo switch', () => {
  const s = make({ trace: true, front: 'base', script: 'lbFills' });
  for (let k = 0; k < 2; k++) s.step(FIXED_DT);
  assert.equal(s.traceOf('WLB')[1].reason, 'trigger: scriptAt');

  const play = make({ trace: true, front: 'base' });
  let found = null;
  const dlIds = new Set(play.players.filter((p) => p.team === 'defense').map((p) => p.id));
  for (let k = 0; k < 120 && !found; k++) {
    play.step(FIXED_DT);
    const tick = play.trace.ticks[play.trace.ticks.length - 1];
    for (const [id, e] of Object.entries(tick.players)) {
      if (e.decision.kind === 'block' && /^switched from /.test(e.reason)) {
        found = { id, e, t: tick.t };
        break;
      }
    }
  }
  assert.ok(found, 'some blocker switched within 2 s');
  assert.match(found.e.reason, /^switched from \w+ at \d+\.\d\d s$/);
  const from = found.e.reason.split(' ')[2];
  assert.ok(dlIds.has(from));
  const entries = play.traceOf(found.id);
  const i = entries.findIndex((e) => e.t === found.t);
  assert.notEqual(entries[i - 1].decision.target, entries[i].decision.target);
  assert.equal(entries[i - 1].decision.target, from);
});

test('play.box before the snap', () => {
  const base = createPlay(25, 'insideZone', {});
  assert.equal(base.box.count, 7);
  assert.equal(base.box.blockers.length, 6);
  const f = createPlay(25, 'insideZone', { formation: '11' });
  assert.equal(f.box.count, 6);
  assert.equal(f.box.blockers.length, 6);
});

test('untraced play records nothing', () => {
  const play = make();
  play.step(FIXED_DT);
  assert.equal(play.trace, null);
  assert.notEqual(play.perception, null); // F-54 #6: perception runs on every play with a run, trace or not
  assert.deepEqual(play.traceOf('RB'), []);
});
