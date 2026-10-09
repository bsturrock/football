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

function forced(pins) {
  const play = createPlay(25, 'insideZone');
  play.snap();
  const defs = play.players.filter((p) => p.team === 'defense');
  const place = () => {
    const W = play.run ? gapWindows(play.players, play.numbers, play.run.side) : {};
    defs.forEach((d, i) => {
      const g = pins[i];
      if (g) {
        d.x = gapCenter(W[g]);
        d.y = 25 + 2 * BODY_RADIUS;
      } else {
        d.x = 15 + i;
        d.y = 45;
      }
    });
    return W;
  };
  let t = 0;
  let lockedA = null;
  while (!play.run.locked) {
    assert.ok(t < 1.5, 'lock within cap');
    const W = place();
    play.step(DT);
    t += DT;
    if (play.run.locked) lockedA = W.A;
  }
  return { play, place, t, lockedA };
}

test('F-13 #5: forced reads A, B, C and last read taken when closed', () => {
  const rdt = (def) => def;
  void rdt;
  const idx = (id) => createPlay(25, 'insideZone').players.filter((p) => p.team === 'defense').findIndex((p) => p.id === id);
  const iT = idx('RDT'), iE = idx('RDE'), iL = idx('LDT');
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
  assert.ok(Math.abs(a.play.player('RB').x - a.play.run.x) <= (a.lockedA.hi - a.lockedA.lo) / 2 + BODY_RADIUS);

  assert.equal(forced({ [iT]: 'A' }).play.run.gap, 'B');
  assert.equal(forced({ [iT]: 'A', [iE]: 'B' }).play.run.gap, 'C');
  assert.equal(forced({ [iT]: 'A', [iE]: 'B', [iL]: 'C' }).play.run.gap, 'C');
});

const alignments = [
  [],
  ...[-1, 1].map((d) => Array(6).fill(['LB', d])),
  [['DL', 1], ['DL', 1]],
  [['DL', -1], ['DL', -1]],
  Array(4).fill(['DL', 1]),
  Array(4).fill(['DL', -1]),
];

test('F-13 #6: read invariants hold across alignments', () => {
  for (const al of alignments) {
    const play = createPlay(25, 'insideZone');
    for (const [k, d] of al) (k === 'LB' ? play.shiftLB(d) : play.shiftDL(d));
    play.snap();
    const run = play.run;
    let lockedGap = null;
    let lockedX = null;
    for (let i = 0; i < 90; i++) {
      let W = null;
      let prev = null;
      if (run.carried && !run.locked) {
        W = gapWindows(play.players, play.numbers, run.side);
        prev = run.read;
      }
      play.step(DT);
      if (W) {
        assert.ok(run.read >= prev);
        assert.equal(run.gap, READS[run.read]);
        if (!run.locked || true) {
          near(run.aim.x, gapCenter(W[run.gap]));
          assert.ok(run.aim.x >= W.C.lo - 1e-9);
        }
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
