import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { POSITIONS } from '../src/dots/roster.js';
import { CONTACT_DIST, ENGAGED_MAX_SPEED, contactSpot } from '../src/dots/blocking.js';

const DT = 1 / 60;
const EPS = 1e-9;
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
const FRESH = { angle: 'straight', engaged: false, seq: null };

const run = (play, seconds, each) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.pre?.();
    play.step(DT);
    each?.post?.();
  }
};
const snapshot = (play) => new Map(play.players.map((p) => [p.id, { x: p.x, y: p.y, b: p.block && { ...p.block } }]));
const engagedIds = (snap) => new Set([...snap.values()].filter((v) => v.b?.engaged).map((v) => v.b.target));
const moved = (p, s) => Math.hypot(p.x - s.x, p.y - s.y);
const started = () => {
  const play = createPlay(25);
  play.snap();
  return play;
};

test('1. presnap blocks null; snap assigns nearest defenders', () => {
  const play = createPlay(25);
  assert.ok(play.players.every((p) => p.block === null));
  assert.deepEqual(play.blockersOf('LDT'), []);
  play.snap();
  const want = { LT: 'RDE', LG: 'RDT', C: 'LDT', RG: 'LDT', RT: 'LDE' };
  for (const p of play.players) {
    if (want[p.id]) assert.deepEqual(p.block, { target: want[p.id], ...FRESH }, p.id);
    else assert.equal(p.block, null, p.id);
  }
  assert.deepEqual(play.blockersOf('LDT'), []);
});

test('2. roster stats, engagement by 1s, speed limits', () => {
  const play = started();
  for (const row of POSITIONS) {
    const p = play.player(row.id);
    assert.equal(p.speed, row.speed);
    assert.equal(p.strength, row.strength);
  }
  play.retargetRule = null;
  let prev = snapshot(play);
  let wasEng = engagedIds(prev);
  const check = () => {
    for (const p of play.players) {
      const s = prev.get(p.id);
      if (p.team === 'defense' ? wasEng.has(p.id) || play.blockersOf(p.id).length : p.block?.engaged || s.b?.engaged) continue;
      assert.ok(moved(p, s) <= p.speed * DT + EPS, `${p.id} moved too fast`);
    }
    prev = snapshot(play);
    wasEng = engagedIds(prev);
  };
  run(play, 1.0, { post: check });
  for (const id of OL) assert.equal(play.player(id).block.engaged, true, id);
});

test('4. engaged defenders never retreat and are slow', () => {
  const play = started();
  let prev = snapshot(play);
  let wasEng = engagedIds(prev);
  run(play, 3, {
    post: () => {
      for (const p of play.players) {
        const s = prev.get(p.id);
        if (p.team === 'defense' && wasEng.has(p.id) && play.blockersOf(p.id).length) {
          assert.ok(p.y >= s.y - EPS, `${p.id} y decreased`);
          assert.ok(moved(p, s) <= ENGAGED_MAX_SPEED * DT + EPS, `${p.id} too fast`);
        }
      }
      prev = snapshot(play);
    },
  });
});
test('5. no retarget: engaged blockers hold contact spot', () => {
  const play = started();
  play.retargetRule = null;
  run(play, 1.0);
  let prev = snapshot(play);
  run(play, 5.0, {
    post: () => {
      for (const id of OL) {
        const b = play.player(id);
        assert.ok(b.block?.engaged, `${id} block ended`);
        const spot = contactSpot(play.players, b);
        assert.ok(Math.hypot(spot.x - b.x, spot.y - b.y) <= 0.05, `${id} off spot`);
        assert.ok(moved(b, prev.get(id)) < b.speed * DT, `${id} moved too fast`);
      }
      prev = snapshot(play);
    },
  });
});

test('6. double-teamed LDT is driven back less than single-blocked RDT', () => {
  const play = started();
  play.retargetRule = null;
  run(play, 1.5);
  const l0 = play.player('LDT').y;
  const r0 = play.player('RDT').y;
  run(play, 1.0);
  const lg = play.player('LDT').y - l0;
  const rg = play.player('RDT').y - r0;
  assert.ok(lg > 0 && rg > 0, `${lg} ${rg}`);
  assert.ok(lg >= 2 * rg, `${lg} ${rg}`);
});

test('7. WLB pursues QB and stops at contact distance', () => {
  const play = started();
  run(play, 3, {
    post: () => {
      const d = Math.hypot(play.player('WLB').x - play.player('QB').x, play.player('WLB').y - play.player('QB').y);
      assert.ok(d >= CONTACT_DIST - 1e-6, `too close ${d}`);
    },
  });
  const w = play.player('WLB');
  const q = play.player('QB');
  assert.ok(Math.hypot(w.x - q.x, w.y - q.y) <= CONTACT_DIST + 0.05);
});

test('8. double-team peel hands RG to MLB; custom rule honored', () => {
  const play = started();
  let handoff = null;
  const t = { v: 0 };
  let cTarget = null;
  run(play, 3, {
    post: () => {
      t.v += DT;
      const c = play.player('C');
      const rg = play.player('RG');
      if (c.block.engaged && rg.block.engaged === false && !play.player('RG').block.seq) {
        // nothing
      }
      if (handoff === null && rg.block.target === 'MLB') {
        handoff = t.v;
        cTarget = c.block.target;
      }
      if (handoff !== null) {
        assert.deepEqual(play.blockersOf('LDT'), ['C']);
        assert.equal(c.block.target, 'LDT');
      }
    },
  });
  assert.ok(handoff !== null && handoff <= 3.0, 'RG never retargeted');
  assert.equal(cTarget, 'LDT');
  assert.deepEqual(play.blockersOf('MLB'), ['RG']);

  // C engages before RG
  const p2 = started();
  let cSeq = null;
  let rgSeq = null;
  run(p2, 3, {
    post: () => {
      cSeq ??= p2.player('C').block.seq;
      if (rgSeq === null && p2.player('RG').block.target === 'LDT') rgSeq = p2.player('RG').block.seq;
    },
  });
  assert.ok(cSeq !== null && rgSeq !== null && cSeq < rgSeq, `${cSeq} ${rgSeq}`);

  const p3 = started();
  p3.retargetRule = null;
  run(p3, 3);
  assert.equal(p3.player('RG').block.target, 'LDT');

  const p4 = started();
  p4.retargetRule = () => [{ blocker: 'LT', target: 'WLB' }];
  p4.step(DT);
  assert.equal(p4.player('LT').block.target, 'WLB');
});

test('9. API behavior', () => {
  const pre = createPlay(25);
  assert.equal(pre.engage('RT', 'LDE'), false);
  assert.equal(pre.join('C', 'RT'), false);
  assert.equal(pre.disengage('C'), false);

  const play = started();
  play.retargetRule = null;
  assert.equal(play.engage('QB', 'LDE'), false);
  assert.equal(play.engage('RT', 'LT'), false);
  assert.equal(play.engage('RT', 'LDE', 'up'), false);
  run(play, 1.0);
  const seq = play.player('RT').block.seq;
  assert.equal(play.engage('RT', 'LDE', 'left'), true);
  assert.equal(play.player('RT').block.angle, 'left');
  assert.equal(play.player('RT').block.engaged, true);
  assert.equal(play.player('RT').block.seq, seq);

  assert.equal(play.join('QB', 'RT'), false);
  assert.equal(play.join('C', 'QB'), false);
  assert.equal(play.join('C', 'RT'), true);
  assert.equal(play.player('C').block.target, 'LDE');
  assert.equal(play.player('C').block.angle, 'left');

  assert.equal(play.disengage('C'), true);
  assert.equal(play.player('C').block, null);
  const c0 = { x: play.player('C').x, y: play.player('C').y };
  run(play, 0.5);
  assert.deepEqual({ x: play.player('C').x, y: play.player('C').y }, c0);
  assert.equal(play.disengage('LDT'), false);

  // after C and RG both leave LDT, LDT moves toward the ball
  assert.equal(play.disengage('RG'), true);
  const ldt = play.player('LDT');
  const before = { x: ldt.x, y: ldt.y };
  const ball = play.ballPosition();
  const dBefore = Math.hypot(ball.x - before.x, ball.y - before.y);
  play.step(DT);
  const ball2 = play.ballPosition();
  assert.ok(Math.hypot(ball2.x - ldt.x, ball2.y - ldt.y) < dBefore);

  assert.equal(play.engage('C', 'MLB'), true);
  run(play, 3);
  assert.equal(play.player('C').block.engaged, true);
  assert.ok(play.blockersOf('MLB').includes('C'));
});

test('10. reset mid-play clears blocks, keeps rule, restarts seq', () => {
  const play = started();
  const rule = play.retargetRule;
  run(play, 1.0);
  play.reset();
  assert.ok(play.players.every((p) => p.block === null));
  assert.equal(play.retargetRule, rule);
  play.snap();
  assert.equal(play.player('C').block.target, 'LDT');
  assert.equal(play.player('LT').block.target, 'RDE');
  let first = null;
  for (let i = 0; i < 120 && first === null; i++) {
    play.step(DT);
    for (const p of play.players) if (p.block?.engaged && (first === null || p.block.seq < first)) first = p.block.seq;
  }
  assert.equal(first, 1);
  play.retargetRule = null;
  play.reset();
  assert.equal(play.retargetRule, null);
});
