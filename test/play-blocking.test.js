import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { POSITIONS, FRONTS } from '../src/dots/roster.js';
import {
  BODY_RADIUS, CONTACT_DIST, ENGAGED_MAX_SPEED, ENGAGE_TOL, ENGAGE_SLACK, SHED_TIME, RELEASE_PAST, REENGAGE_DELAY,
  contactSpot, canEngage, canRelease, assignBlocks, setBlock,
} from '../src/dots/blocking.js';
import { hardCore } from '../src/dots/steering.js';
import { GAP_DEPTH } from '../src/dots/carrier.js';

const DT = 1 / 60;
const H = hardCore(BODY_RADIUS);
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
      if (play.players.some((o) => o !== p && Math.hypot(o.x - p.x, o.y - p.y) <= 2 * BODY_RADIUS + 1e-6)) continue;
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

test('6. double-teamed LDT is driven back more than single-blocked RDT', () => {
  const play = started();
  play.retargetRule = null;
  const l0 = play.player('LDT').y;
  const r0 = play.player('RDT').y;
  run(play, 2.5);
  const lg = play.player('LDT').y - l0;
  const rg = play.player('RDT').y - r0;
  assert.ok(lg > 0 && rg > 0, `${lg} ${rg}`);
  assert.ok(lg >= 2 * rg, `${lg} ${rg}`);
});

test('7. WLB pursues QB and stops at contact distance', () => {
  const play = started();
  play.retargetRule = null;
  run(play, 3, {
    post: () => {
      const d = Math.hypot(play.player('WLB').x - play.player('QB').x, play.player('WLB').y - play.player('QB').y);
      assert.ok(d >= 2 * BODY_RADIUS - 0.02, `too close ${d}`);
    },
  });
  const w = play.player('WLB');
  const q = play.player('QB');
  assert.ok(Math.hypot(w.x - q.x, w.y - q.y) <= CONTACT_DIST + 0.05);
});

// F-6: with the DTs inside the guards, RG (not C) engages LDT first, so C peels to MLB.
test('8. double-team peel hands C to a LB; custom rule honored', () => {
  const play = started();
  let handoff = null;
  const t = { v: 0 };
  let stayTarget = null;
  let lb = null;
  run(play, 3, {
    post: () => {
      t.v += DT;
      const c = play.player('C');
      const rg = play.player('RG');
      if (handoff === null && (c.block.target === 'MLB' || c.block.target === 'WLB')) {
        handoff = t.v;
        lb = c.block.target;
        stayTarget = rg.block.target;
      }
      if (handoff !== null) {
        assert.deepEqual(play.blockersOf('LDT'), ['RG']);
        assert.equal(rg.block.target, 'LDT');
      }
    },
  });
  assert.ok(handoff !== null && handoff <= 3.0, 'C never retargeted');
  assert.equal(stayTarget, 'LDT');
  assert.deepEqual(play.blockersOf(lb), ['C']);

  // RG engages before C
  const p2 = started();
  let cSeq = null;
  let rgSeq = null;
  run(p2, 3, {
    post: () => {
      rgSeq ??= p2.player('RG').block.seq;
      if (cSeq === null && p2.player('C').block.target === 'LDT') cSeq = p2.player('C').block.seq;
    },
  });
  assert.ok(cSeq !== null && rgSeq !== null && rgSeq < cSeq, `${rgSeq} ${cSeq}`);

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
  run(play, 0.5, {
    post: () => {
      const c = play.player('C');
      const still = c.x === c0.x && c.y === c0.y;
      const bumped = play.players.some((o) => o !== c && Math.hypot(o.x - c.x, o.y - c.y) <= 2 * BODY_RADIUS + 1e-6);
      assert.ok(still || bumped, 'C moved with nobody touching');
      c0.x = c.x; c0.y = c.y;
    },
  });
  assert.equal(play.disengage('LDT'), false);

  // after C and RG both leave LDT, LDT moves toward the ball
  assert.equal(play.disengage('RG'), true);
  const ldt = play.player('LDT');
  const before = { x: ldt.x, y: ldt.y };
  const ball = play.ballPosition();
  const dBefore = Math.hypot(ball.x - before.x, ball.y - before.y);
  run(play, 10 * DT);
  const ball2 = play.ballPosition();
  assert.ok(Math.hypot(ball2.x - ldt.x, ball2.y - ldt.y) < dBefore);

  assert.equal(play.engage('C', 'LDT'), true);
  run(play, 3);
  assert.equal(play.player('C').block.engaged, true);
  assert.ok(play.blockersOf('LDT').includes('C'));
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

for (const retarget of [undefined, null]) {
  test(`R-4: LG meets RDT at the line`, () => {
    const play = createPlay(25, 'base', { accel: true });
    if (retarget !== undefined) play.retargetRule = retarget;
    play.snap();
    let t = 0;
    let engagedAt = null;
    let rdtYAtEngage = null;
    let allOlAt = null;
    let minDist = Infinity;
    run(play, 5, {
      post: () => {
        t += DT;
        const lg = play.player('LG');
        const rdt = play.player('RDT');
        if (engagedAt === null && lg.block?.engaged) {
          engagedAt = t;
          rdtYAtEngage = rdt.y;
        }
        if (allOlAt === null && OL.every((id) => play.player(id).block?.engaged)) allOlAt = t;
        minDist = Math.min(minDist, Math.hypot(lg.x - rdt.x, lg.y - rdt.y));
      },
    });
    // accel: LG engages at 0.283 s measured; 0.283 * 1.25 = 0.354, rounded up to 0.05 s
    assert.ok(engagedAt !== null && engagedAt <= 0.4 + EPS, `LG engaged at ${engagedAt}`);
    assert.equal(lgTarget(play), 'RDT');
    assert.ok(rdtYAtEngage >= 25, `RDT y at engage ${rdtYAtEngage}`);
    assert.ok(allOlAt !== null && allOlAt <= 0.5 + EPS, `all OL engaged at ${allOlAt}`);
    assert.ok(minDist >= CONTACT_DIST - 0.05, `LG-RDT min distance ${minDist}`);
    assert.ok(play.player('RDT').y > 26, `RDT y at 5s ${play.player('RDT').y}`);
  });
}
const lgTarget = (play) => play.player('LG').block.target;

for (const retarget of [undefined, null]) {
  test(`F-7: no two players overlap (retarget ${retarget === null ? 'null' : 'default'})`, () => {
    const play = createPlay(25);
    if (retarget !== undefined) play.retargetRule = retarget;
    play.snap();
    let step = 0;
    run(play, 5, {
      post: () => {
        step++;
        const ps = play.players;
        for (let i = 0; i < ps.length; i++) {
          for (let j = i + 1; j < ps.length; j++) {
            const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
            assert.ok(d >= H - 0.02, `${ps[i].id}-${ps[j].id} ${d} at step ${step}`);
          }
        }
      },
    });
  });
}

// ---- F-10 steering ----
const RUNS = [];
for (const rule of ['default', null]) for (const timeScale of [1, 0.35]) RUNS.push({ rule, timeScale });
const runName = (r) => `rule=${r.rule === null ? 'null' : 'default'} timeScale=${r.timeScale}`;
const mkRun = (r) => {
  const play = createPlay(25, 'base', { timeScale: r.timeScale });
  if (r.rule === null) play.retargetRule = null;
  play.snap();
  return play;
};

test('F10-7. no flip-flopping of route sides', () => {
  for (const r of RUNS) {
    const play = mkRun(r);
    const steps = Math.round(5 / (r.timeScale / 60));
    const st = new Map(play.players.map((p) => [p.id, { last: 0, times: [], side: 0, key: null, flips: 0 }]));
    let t = 0;
    for (let i = 0; i < steps; i++) {
      play.step(DT);
      t += r.timeScale / 60;
      for (const p of play.players) {
        const s = st.get(p.id);
        const sd = p.steer ? p.steer.side : 0;
        const key = p.steer ? p.steer.key : null;
        const flips = p.steer ? p.steer.flips : 0;
        const ball = play.ballPosition();
        const atBall = Math.hypot(p.x - ball.x, p.y - ball.y) <= 2 * BODY_RADIUS + 0.05;
        if (sd !== 0 && s.last && sd !== s.last && !atBall) s.times.push(t);
        if (sd !== 0 && s.side === -sd && s.key === key) {
          assert.ok(flips > s.flips, `${p.id} side flipped without flips++ at t=${t.toFixed(3)} (${runName(r)})`);
        }
        if (sd !== 0) s.last = sd;
        s.side = sd;
        s.key = key;
        s.flips = flips;
      }
    }
    for (const [id, s] of st) {
      assert.ok(s.times.length <= 2, `${id} changed side ${s.times.length}x at ${s.times} (${runName(r)})`);
      for (let k = 1; k < s.times.length; k++) {
        assert.ok(s.times[k] - s.times[k - 1] >= 0.5, `${id} changes too close at t=${s.times[k].toFixed(3)} (${runName(r)})`);
      }
    }
  }
});

test('F10-8. collision is rarely needed', () => {
  for (const r of RUNS) {
    const play = mkRun(r);
    assert.equal(play.separation, 0);
    const steps = Math.round(5 / (r.timeScale / 60));
    for (let i = 0; i < steps; i++) play.step(DT);
    assert.ok(play.separation <= 12, `separation ${play.separation} (${runName(r)})`);
    play.reset();
    assert.equal(play.separation, 0);
  }
  assert.equal(createPlay(25).separation, 0);
});

test('F10-6. engaged players do not path', () => {
  const play = started();
  run(play, 3, {
    post: () => {
      for (const p of play.players) {
        const engagedBlocker = p.block && p.block.engaged;
        if (engagedBlocker || play.blockersOf(p.id).length > 0) {
          assert.ok(!p.steer, `${p.id} has steer while engaged`);
        }
      }
    },
  });
});

test('F10-9. deterministic', () => {
  const a = started();
  const b = started();
  for (let i = 0; i < 300; i++) {
    a.step(DT);
    b.step(DT);
  }
  a.players.forEach((p, i) => {
    assert.equal(p.x, b.players[i].x);
    assert.equal(p.y, b.players[i].y);
  });
});

test('F10-10. null rule: LBs reach the QB', () => {
  const play = createPlay(25, 'base', { accel: true });
  play.snap();
  play.retargetRule = null;
  run(play, 5);
  const qb = play.player('QB');
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= CONTACT_DIST + 0.05;
  // Arrived: touching the QB, or touching another defender who is (crowding; the line is no wedge).
  const arrived = (p, seen = new Set([p.id])) =>
    near(p, qb) ||
    play.players.some((o) => {
      if (o.team !== 'defense' || seen.has(o.id) || !near(p, o)) return false;
      seen.add(o.id);
      return arrived(o, seen);
    });
  for (const id of ['WLB', 'MLB']) {
    const p = play.player(id);
    assert.ok(arrived(p), `${id} dist ${Math.hypot(p.x - qb.x, p.y - qb.y)}`);
    assert.ok(p.y < 25, `${id} stuck at the line (y ${p.y})`);
  }
});

test('F-15 #8: RB slips the lane', () => {
  // tackles off: the lane crossing is a running rule; a tackle before the crossing must not hide it.
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false });
  play.snap();
  let crossed = false;
  // measured 2.15 s with tackles off since F-33 #6 (engaged DL lean to their gap goal, the RB takes the A gap
  // and is held at the line about 0.5 s); 1.25x margin; F-35 (RB live gap read) is expected to bring it back down.
  for (let t = 0; t < 2.7; t += DT) {
    play.step(DT);
    const rb = play.player('RB');
    if (rb.y >= 25 + GAP_DEPTH) {
      const W = play.run.windows[play.run.gap];
      assert.ok(rb.x >= W.lo - BODY_RADIUS && rb.x <= W.hi + BODY_RADIUS, `rb.x ${rb.x} window [${W.lo}, ${W.hi}]`);
      crossed = true;
      break;
    }
  }
  assert.ok(crossed, 'RB crossed within 2.7 s');
});

// ---- F-32: smooth engage, engage clock, release ----
const mkPair = (over = {}) => {
  const T = { id: 'D', team: 'defense', x: 0, y: 10, react: null };
  const b = {
    id: 'B', team: 'offense', role: 'OL', x: 0, y: 10 - CONTACT_DIST, speed: 4, strength: 3,
    block: { target: 'D', angle: 'straight', engaged: true, seq: 1, held: 0, winT: 0, ...over },
  };
  return { T, b };
};
const BALL = { x: 0, y: 5 };

test('F-32 canRelease: shed, past, lost, null (first match in that order)', () => {
  const { T, b } = mkPair();
  assert.equal(canRelease(b, T, BALL), null);
  b.block.winT = SHED_TIME;
  assert.equal(canRelease(b, T, BALL), 'shed');
  b.block.winT = SHED_TIME - 0.01;
  assert.equal(canRelease(b, T, BALL), null);
  assert.equal(canRelease(b, T, { x: 0, y: T.y + RELEASE_PAST }), 'past');
  assert.equal(canRelease(b, T, { x: 0, y: T.y + RELEASE_PAST - 0.01 }), null);
  b.y = T.y - (CONTACT_DIST + ENGAGE_TOL) - 0.01;
  assert.equal(canRelease(b, T, BALL), 'lost');
  b.y = T.y - (CONTACT_DIST + ENGAGE_TOL) + 0.01;
  assert.equal(canRelease(b, T, BALL), null);
  b.y = T.y - (CONTACT_DIST + ENGAGE_TOL) - 0.01;
  assert.equal(canRelease(b, T, { x: 0, y: T.y + RELEASE_PAST }), 'past');
  b.block.winT = SHED_TIME;
  assert.equal(canRelease(b, T, { x: 0, y: T.y + RELEASE_PAST }), 'shed');
});

test('F-32 canEngage returns null while cool > 0', () => {
  const { T, b } = mkPair({ engaged: false });
  const spot = { x: 0, y: T.y - CONTACT_DIST };
  assert.equal(canEngage(b, T, spot), 'spot');
  b.block.cool = 0.1;
  assert.equal(canEngage(b, T, spot), null);
  b.block.cool = 0;
  assert.equal(canEngage(b, T, spot), 'spot');
});

test('F-32 held is 0 on the engage tick and grows by dt after', () => {
  const play = started();
  play.retargetRule = null;
  const held = new Map();
  let checked = 0;
  for (let i = 0; i < 90; i++) {
    play.step(DT);
    for (const id of OL) {
      const b = play.player(id).block;
      if (!b.engaged) continue;
      if (!held.has(id)) {
        assert.equal(b.held, 0, `${id} held on engage tick`);
      } else {
        assert.ok(Math.abs(b.held - (held.get(id) + DT)) < EPS, `${id} held ${b.held}`);
        checked++;
      }
      held.set(id, b.held);
    }
  }
  assert.ok(held.size === OL.length && checked > 50);
});

test('F-32 assignBlocks/setBlock keep the plain block shape', () => {
  const play = createPlay(25);
  play.snap();
  for (const id of OL) assert.deepEqual(Object.keys(play.player(id).block).sort(), ['angle', 'engaged', 'seq', 'target']);
  assignBlocks(play.players, null, null);
  for (const id of OL) assert.deepEqual(Object.keys(play.player(id).block).sort(), ['angle', 'engaged', 'seq', 'target']);
  setBlock(play.players, 'C', 'MLB', 'left');
  assert.deepEqual(play.player('C').block, { target: 'MLB', angle: 'left', engaged: false, seq: null });
});

test('F-32 smooth engage: no OL jumps more than speed * dt + ENGAGE_SLACK in a tick', () => {
  const plays = [createPlay(25, 'base')];
  for (const front of Object.keys(FRONTS)) plays.push(createPlay(25, 'insideZone', { front }));
  for (const play of plays) {
    play.snap();
    let prev = snapshot(play);
    for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
      play.step(DT);
      for (const id of OL) {
        const p = play.player(id);
        assert.ok(moved(p, prev.get(id)) <= p.speed * DT + ENGAGE_SLACK + EPS, `${id} moved ${moved(p, prev.get(id))} at tick ${i}`);
      }
      prev = snapshot(play);
    }
  }
});

test('F-32 shed: a defender who wins for SHED_TIME is released, then reacts as free', () => {
  const play = started();
  play.retargetRule = null;
  const d = play.player('RDT');
  d.strength *= 3;
  let winStart = null;
  let shedAt = null;
  let nextReact;
  for (let i = 0; i < 300 && nextReact === undefined; i++) {
    play.step(DT);
    if (shedAt !== null) {
      nextReact = d.react;
      break;
    }
    if (winStart === null && d.react?.state === 'winning') winStart = i;
    const blk = play.player('LG').block;
    if (blk.released === 'shed') {
      shedAt = i;
      assert.equal(blk.engaged, false);
      assert.equal(blk.seq, null);
      assert.equal(blk.cool, REENGAGE_DELAY);
    }
  }
  assert.ok(winStart !== null, 'RDT never winning');
  assert.ok(shedAt !== null, 'block never shed');
  assert.ok(shedAt - winStart <= Math.round(SHED_TIME / DT) + 2, `shed ${shedAt - winStart} ticks after winning`);
  assert.equal(nextReact, null);
});

test('F-32 past: once the ball is RELEASE_PAST upfield of a defender, nobody is engaged on him', () => {
  // tackles off: the 'past' release is a blocking rule; a tackle before the release must not hide it.
  const play = createPlay(25, 'insideZone', { tackles: false });
  play.snap();
  let seen = 0;
  for (let i = 0; i < 360 && play.ball.phase !== 'dead'; i++) {
    play.step(DT);
    const ball = play.ballPosition();
    for (const d of play.players) {
      if (d.team !== 'defense' || ball.y < d.y + RELEASE_PAST) continue;
      seen++;
      assert.equal(play.blockersOf(d.id).length, 0, `${d.id} still blocked at tick ${i}`);
    }
  }
  assert.ok(seen > 0, 'ball never passed a defender');
});

test('F-32 smooth engage: a blocker leaving an engaged block never jumps more than speed * dt + ENGAGE_SLACK', () => {
  for (const variant of ['other', 'first']) {
    let switchedAny = false;
    const plays = [createPlay(25, 'base')];
    for (const front of Object.keys(FRONTS)) plays.push(createPlay(25, 'insideZone', { front }));
    for (const play of plays) {
      const done = new Set();
      play.retargetRule = (players) => {
        const out = [];
        for (const c of play.combos) {
          if (done.has(c.owner)) continue;
          const o = players.find((p) => p.id === c.owner);
          const q = players.find((p) => p.id === c.partner);
          const eng = (p) => p.block?.engaged && p.block.target === c.target;
          if (!eng(o) || !eng(q)) continue;
          const first = o.block.held >= q.block.held ? o : q;
          const second = first === o ? q : o;
          if (first.block.held < 0.5) continue;
          done.add(c.owner);
          out.push({ blocker: variant === 'first' ? first.id : second.id, target: c.watch });
        }
        return out;
      };
      play.snap();
      let prev = snapshot(play);
      for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
        play.step(DT);
        for (const id of OL) {
          const p = play.player(id);
          assert.ok(moved(p, prev.get(id)) <= p.speed * DT + ENGAGE_SLACK + EPS, `${variant} ${id} moved ${moved(p, prev.get(id))} at tick ${i}`);
        }
        prev = snapshot(play);
      }
      if (done.size) switchedAny = true;
    }
    assert.ok(switchedAny, `${variant}: no combo switched`);
  }
});
