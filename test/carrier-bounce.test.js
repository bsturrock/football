import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  laneWindows, startRun, stepCarrier,
  GAP_BACK, GAP_DEPTH, CUT_ALLOW, BEND_MAX, HOLE_EXIT, BOUNCE_MAX, BOUNCE_REACH,
} from '../src/dots/carrier.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup } from '../src/dots/roster.js';
import { createPlay } from '../src/dots/play.js';

const LOS = 25;
const mk = () => buildLineup(LOS, 'insideZone').map((p) => ({ ...p }));
const by = (pl, id) => pl.find((p) => p.id === id);
const parked = (pl) => { pl.filter((p) => p.team === 'defense').forEach((d, i) => { d.x = 15 + i; d.y = 45; }); return pl; };
const setup = (patience) => {
  const pl = parked(mk());
  const numbers = numberPlay(pl, { los: LOS, centerId: 'C', playside: 'left' });
  const run = startRun(pl, { carrier: 'RB', patience }, { snapToId: 'QB', playside: 'left', numbers });
  return { pl, run, rb: by(pl, 'RB') };
};
const go = (pl, run, dt = 1 / 60) => stepCarrier(pl, run, { los: LOS, ballHeld: true, holdId: 'QB' }, dt);
const atMesh = (patience) => {
  const e = setup(patience);
  e.run.carried = true;
  e.rb.x = e.run.mesh.x; e.rb.y = e.run.mesh.y;
  return e;
};
// A hand-placed defender is a man standing there: tell the carrier's memory he was already at his spot.
const place = (run, d, x, y) => { d.x = x; d.y = y; run.seen[d.id] = { x: d.x, y: d.y }; };
const ds = (pl) => pl.filter((p) => p.team === 'defense');
// Locked on his lane, standing at its x at depth `y`, with that lane plugged by a free defender.
const lockedPlugged = (y) => {
  const e = atMesh(0);
  go(e.pl, e.run);
  assert.equal(e.run.locked, true);
  e.rb.x = e.run.x;
  e.rb.y = y;
  place(e.run, ds(e.pl)[0], e.run.x, LOS + 0.3);
  return e;
};
const HOLE_Y = LOS - GAP_BACK / 2;

test('bounce (a): a closed lane in the hole with an open lane in reach moves to it', () => {
  const e = lockedPlugged(HOLE_Y);
  const { pl, run, rb } = e;
  const lane = { ...run.lane };
  go(pl, run);
  const l = run.lanes.find((q) => q.side === run.lane.side && q.name === run.lane.name);
  assert.notDeepEqual(run.lane, lane);
  assert.ok(l.open);
  assert.ok(Math.abs(l.x - rb.x) <= BOUNCE_REACH + 0.2);
  assert.equal(run.x, l.x);
  assert.equal(run.gap, run.lane.name);
  assert.equal(run.bounces, 1);
  assert.equal(run.bends, 0);
  assert.ok(run.why.startsWith('bounce:'));
  assert.equal(run.cut, 0);
});

test('bounce (b): a closed lane with no open lane in reach is kept and committed to', () => {
  const e = lockedPlugged(HOLE_Y);
  const { pl, run } = e;
  const ws = laneWindows(pl, run.line, run.side);
  const d = ds(pl);
  ws.forEach((w, i) => place(run, d[i], (w.lo + w.hi) / 2, LOS + BODY_RADIUS));
  const lane = { ...run.lane };
  const x = run.x;
  go(pl, run);
  assert.deepEqual(run.lane, lane);
  assert.equal(run.x, x);
  assert.equal(run.bounces, 0);
  assert.ok(Math.abs(run.aim.x - run.x) <= CUT_ALLOW + 1e-9);
  assert.equal(run.why, 'commit: hole closed');
  go(pl, run);
  assert.equal(run.why, 'commit: hole closed');
});

test('bounce (c): at BOUNCE_MAX the lane does not change', () => {
  const e = lockedPlugged(HOLE_Y);
  const { pl, run } = e;
  run.bounces = BOUNCE_MAX;
  const lane = { ...run.lane };
  const x = run.x;
  go(pl, run);
  assert.deepEqual(run.lane, lane);
  assert.equal(run.x, x);
  assert.equal(run.bounces, BOUNCE_MAX);
  assert.equal(run.why, 'commit: hole closed');
});

test('bounce (d): the hole ends at HOLE_EXIT past the los', () => {
  const a = lockedPlugged(LOS + 0.5);
  a.run.bounces = BOUNCE_MAX;
  go(a.pl, a.run);
  assert.equal(a.run.pastLos, false);
  assert.equal(a.run.aim.y, LOS + GAP_DEPTH);
  assert.ok(HOLE_EXIT < GAP_DEPTH);
  const b = lockedPlugged(LOS + HOLE_EXIT);
  go(b.pl, b.run);
  assert.equal(b.run.pastLos, true);
});

test('bounce (e): before the hole a closed lane takes the existing cut, not a bounce', () => {
  const e = lockedPlugged(LOS - 2 * GAP_BACK);
  const { pl, run } = e;
  assert.ok(run.bends < BEND_MAX);
  go(pl, run);
  assert.equal(run.bends, 1);
  assert.equal(run.bounces, 0);
  assert.ok(run.why.startsWith('cut:'));
});

test('bounce scenario: the hole aim stays ahead of him and he bounces at most BOUNCE_MAX', (t) => {
  const setups = [['bear', 'noTe'], ['over43', 'noTe'], ['backedOff', 'te']];
  for (const [front, personnel] of setups) {
    const play = createPlay(25, 'insideZone', { accel: true, tackles: false, fightBlocks: true, seed: 1, moves: false, playside: 'left', front, personnel });
    play.snap();
    const rb = play.player(play.run.carrier);
    const hist = [];
    for (let i = 0; i < 300; i++) {
      play.step(1 / 60);
      hist.push({ x: rb.x, y: rb.y });
      if (play.run.locked && !play.run.pastLos) {
        assert.equal(play.run.aim.y, 25 + GAP_DEPTH, `${front}/${personnel} tick ${i}`);
        assert.ok(play.run.aim.y > rb.y, `${front}/${personnel} tick ${i}`);
        assert.ok(play.run.bounces <= BOUNCE_MAX, `${front}/${personnel} tick ${i}`);
      }
    }
    let longest = 0;
    let streak = 0;
    for (let i = 6; i < hist.length; i++) {
      const slow = Math.hypot(hist[i].x - hist[i - 6].x, hist[i].y - hist[i - 6].y) / (6 / 60) < 1;
      streak = slow ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    }
    t.diagnostic(`${front}/${personnel}: longest net speed under 1 yd/s ${longest} ticks (${(longest / 60).toFixed(2)} s), final why: ${play.run.why}`);
  }
});
