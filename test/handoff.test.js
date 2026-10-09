import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { READS, MESH_AHEAD, HANDOFF_DIST, gapWindows, gapCenter } from '../src/dots/carrier.js';

const DT = 1 / 60;
const near = (a, b, m = '') => assert.ok(Math.abs(a - b) < 1e-9, `${m} ${a} !~ ${b}`);

test('F-13 #4: QB hands the ball to the RB at the mesh point', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  let carriedAt = false;
  let t = 0;
  while (t < 0.5 - 1e-9) {
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

const defIdx = (id) =>
  createPlay(25, 'insideZone').players.filter((p) => p.team === 'defense').findIndex((p) => p.id === id);

function forced(pins) {
  const play = createPlay(25, 'insideZone');
  play.snap();
  const W = play.run.windows;
  const defs = play.players.filter((p) => p.team === 'defense');
  const place = () => {
    defs.forEach((d, i) => {
      if (pins[i]) {
        d.x = gapCenter(W[pins[i]]);
        d.y = 25 + 2 * BODY_RADIUS;
      } else {
        d.x = 15 + i;
        d.y = 45;
      }
    });
  };
  let t = 0;
  while (!play.run.locked) {
    assert.ok(t < 1.5, 'lock within cap');
    place();
    play.step(DT);
    t += DT;
  }
  return { play, place, t, W };
}

test('F-13 #5: forced reads A, B, C and A default when nothing opens', () => {
  const iT = defIdx('RDT'), iE = defIdx('RDE'), iL = defIdx('LDT');
  assert.ok(iT >= 0 && iE >= 0 && iL >= 0);

  const a = forced({});
  assert.equal(a.play.run.gap, 'A');
  let t = a.t;
  while (a.play.player('RB').y < 25) {
    assert.ok(t < 1.5, 'RB reaches los within cap');
    a.place();
    a.play.step(DT);
    t += DT;
  }
  assert.ok(Math.abs(a.play.player('RB').x - a.play.run.x) <= (a.W.A.hi - a.W.A.lo) / 2 + BODY_RADIUS);

  assert.equal(forced({ [iT]: 'A' }).play.run.gap, 'B');
  assert.equal(forced({ [iT]: 'A', [iE]: 'B' }).play.run.gap, 'C');
  const d = forced({ [iT]: 'A', [iE]: 'B', [iL]: 'C' });
  assert.equal(d.play.run.gap, 'A');
  near(d.play.run.x, gapCenter(d.W.A));
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

test('F-13 #6: read invariants hold across alignments', () => {
  for (const al of alignments) {
    const play = createPlay(25, 'insideZone');
    for (const [k, d] of al) (k === 'LB' ? play.shiftLB(d) : play.shiftDL(d));
    play.snap();
    const run = play.run;
    assert.deepEqual(run.windows, gapWindows(play.players, play.numbers, run.side));
    let lockedGap = null;
    let lockedX = null;
    for (let i = 0; i < 90; i++) {
      const track = run.carried && !run.locked;
      const prev = run.read;
      play.step(DT);
      if (track) {
        const label = JSON.stringify(al.length) + ' step ' + i;
        assert.ok(run.read >= prev, label);
        assert.ok(
          run.gap === READS[run.read] || (run.read === READS.length - 1 && run.gap === 'A'),
          label,
        );
        const ax = run.locked ? run.x : run.aim.x;
        near(ax, gapCenter(run.windows[run.gap]), label);
        assert.ok(ax >= run.windows.C.lo - 1e-9, label);
      }
      if (run.locked) {
        if (lockedGap === null) { lockedGap = run.gap; lockedX = run.x; }
        assert.equal(run.gap, lockedGap);
        assert.equal(run.x, lockedX);
      }
    }
    assert.ok(run.locked, 'locked within 1.5 s');
  }
});
