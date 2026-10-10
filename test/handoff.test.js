import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { LANES, MESH_AHEAD, HANDOFF_DIST, CUT_ALLOW, BEND_MAX } from '../src/dots/carrier.js';

const DT = 1 / 60;
const near = (a, b, m = '') => assert.ok(Math.abs(a - b) < 1e-9, `${m} ${a} !~ ${b}`);

test('F-13 #4: QB hands the ball to the RB at the mesh point', () => {
  const play = createPlay(25, 'insideZone', { accel: true });
  play.snap();
  let carriedAt = false;
  let t = 0;
  // handoff measured about 0.6 s with accel
  while (t < 1.0 - 1e-9) {
    play.step(DT);
    t += DT;
    const rb = play.player('RB');
    if (play.ball.phase === 'snapping') assert.notEqual(play.ball.holder, 'RB');
    if (play.ball.phase === 'carried' && !carriedAt) {
      carriedAt = true;
      const qb = play.player('QB');
      assert.ok(Math.hypot(rb.x - play.run.mesh.x, rb.y - play.run.mesh.y) <= HANDOFF_DIST + 1e-9);
      near(play.run.mesh.x, qb.x);
      near(play.run.mesh.y, qb.y + MESH_AHEAD);
    } else if (carriedAt) {
      assert.deepEqual(play.ballPosition(), { x: rb.x, y: rb.y });
    }
  }
  assert.equal(play.ball.phase, 'carried');
  assert.equal(play.ball.holder, 'RB');

  const base = createPlay(25);
  const rb0 = { ...base.player('RB') };
  base.snap();
  for (let i = 0; i < 60; i++) base.step(DT);
  assert.equal(base.run, null);
  assert.equal(base.ball.phase, 'held');
  assert.equal(base.player('RB').x, rb0.x);
  assert.equal(base.player('RB').y, rb0.y);

  play.reset();
  assert.equal(play.run, null);
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

test('F-13 #5: lane read invariants hold across alignments', () => {
  for (const al of alignments) {
    // tackles off: on base the backside end ends the play at about 1.1 s, before the RB reaches the line.
    const play = createPlay(25, 'insideZone', { tackles: false });
    for (const [k, d] of al) (k === 'LB' ? play.shiftLB(d) : play.shiftDL(d));
    play.snap();
    const run = play.run;
    let lockedLane = null;
    let lockedX = null;
    let bends = 0;
    for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
      play.step(DT);
      const label = JSON.stringify(al.length) + ' step ' + i;
      if (run.carried && !run.locked) {
        assert.ok(LANES.some((l) => l.side === run.lane.side && l.name === run.lane.name), label);
        const l = run.lanes.find((e) => e.side === run.lane.side && e.name === run.lane.name);
        assert.ok(l, label);
        near(run.aim.x, l.x, label);
      }
      if (run.locked) {
        if (lockedLane === null) { lockedLane = { ...run.lane }; lockedX = run.x; bends = run.bends; }
        if (run.bends > bends) {
          // a bend: only while the RB was behind the los at the start of the tick
          assert.ok(play.prev.RB.y < 25, label + ' bend at/past the los');
          lockedLane = { ...run.lane };
          lockedX = run.x;
          bends = run.bends;
        }
        assert.ok(run.bends <= BEND_MAX, label);
        assert.deepEqual(run.lane, lockedLane, label);
        assert.equal(run.x, lockedX, label);
        if (play.prev.RB.y < 25 && !run.pastLos) assert.ok(Math.abs(run.aim.x - run.x) <= CUT_ALLOW + 1e-9, label);
        else assert.ok(run.aim.y > play.player('RB').y, label);
      }
    }
    assert.ok(run.locked || play.ball.phase === 'dead', 'locked or dead within 4 s');
  }
});

test('F-35: insideZone RB presses then commits within the patience window', () => {
  const play = createPlay(25, 'insideZone', { tackles: false });
  play.snap();
  let steps = 0;
  let handoff = null;
  while (handoff === null && steps < 240) {
    play.step(DT);
    steps++;
    if (play.run.carried) handoff = steps;
  }
  assert.ok(handoff !== null, 'handed off within 4 s');
  let commit = null;
  while (commit === null && steps < handoff + 240) {
    play.step(DT);
    steps++;
    if (play.run.locked) commit = steps;
  }
  assert.ok(commit !== null, 'RB committed within 4 s of the handoff');
  assert.ok(commit - handoff <= Math.ceil(play.run.patience / DT) + 1,
    `committed ${((commit - handoff) * DT).toFixed(3)} s after the handoff (window ${play.run.patience} s)`);
  near(play.run.patience, 0.5, 'patience');
  assert.ok(['window', 'clear', 'line', 'pressure'].includes(play.run.commitBy), `commitBy ${play.run.commitBy}`);
});

test('F-35 determinism: two fresh plays give identical RB positions every tick', () => {
  const a = createPlay(25, 'insideZone', { tackles: false });
  const b = createPlay(25, 'insideZone', { tackles: false });
  a.snap();
  b.snap();
  for (let i = 0; i < 120; i++) {
    a.step(DT);
    b.step(DT);
    const ra = a.player('RB');
    const rb = b.player('RB');
    assert.equal(ra.x, rb.x, 'x step ' + i);
    assert.equal(ra.y, rb.y, 'y step ' + i);
  }
});
